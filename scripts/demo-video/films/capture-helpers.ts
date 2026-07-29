import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FilmSpec } from "./film-spec";

const here = dirname(fileURLToPath(import.meta.url));

export async function required(locator: Locator, label: string): Promise<Locator> {
  await expect(locator, `Required film element missing: ${label}`).toBeVisible({
    timeout: 12_000,
  });
  return locator;
}

export class FilmClock {
  private readonly start = Date.now();
  readonly markers: Record<string, number> = {};

  mark(id: string) {
    this.markers[id] = (Date.now() - this.start) / 1000;
  }

  since(id: string) {
    if (!Object.hasOwn(this.markers, id)) {
      throw new Error(`Unknown film marker: ${id}.`);
    }
    return Date.now() - (this.start + this.markers[id] * 1000);
  }

  save(spec: FilmSpec) {
    const dir = resolve(here, "out", spec.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "markers.json"),
      JSON.stringify(this.markers, null, 2),
      "utf8",
    );
  }
}

export function narrationBudgets(spec: FilmSpec, padMs = 300) {
  if (!Number.isFinite(padMs) || padMs < 0) {
    throw new Error("Invalid narration pad.");
  }

  const manifestPath = resolve(here, "out", spec.id, "vo", "manifest.json");
  const measured: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(measured)) {
    throw new Error("Narration manifest must be an array.");
  }

  const expectedIds = new Set(spec.beats.map((beat) => beat.id));
  const durationById = new Map<string, number>();
  for (const item of measured) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Invalid narration manifest entry.");
    }

    const { id, durationSec } = item as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Invalid manifest beat id.");
    }
    if (!expectedIds.has(id)) {
      throw new Error(`Unknown manifest beat id: ${id}.`);
    }
    if (durationById.has(id)) {
      throw new Error(`Duplicate manifest beat id: ${id}.`);
    }
    if (
      typeof durationSec !== "number" ||
      !Number.isFinite(durationSec) ||
      durationSec <= 0
    ) {
      throw new Error(`Invalid narration duration for beat ${id}.`);
    }

    durationById.set(id, durationSec * 1000);
  }

  for (const beat of spec.beats) {
    if (!durationById.has(beat.id)) {
      throw new Error(`Missing manifest beat id: ${beat.id}.`);
    }
  }

  return Object.fromEntries(
    spec.beats.map((beat) => [
      beat.id,
      Math.round(durationById.get(beat.id)! + padMs + (beat.extraMs ?? 0)),
    ]),
  );
}

export async function prepareFilmPage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "proculink_cookie_consent_v1",
      "functional-only",
    );

    const style = document.createElement("style");
    style.textContent =
      'span[title^="You are viewing mock data"],nextjs-portal,' +
      "[data-next-badge-root],[data-nextjs-toast]," +
      "[data-nextjs-dev-tools-button]{display:none!important;}" +
      "*{caret-color:transparent}";
    document.documentElement.appendChild(style);

    const installCursor = () => {
      if (!document.body || document.getElementById("plk-film-cursor")) return;

      const cursor = document.createElement("div");
      cursor.id = "plk-film-cursor";
      Object.assign(cursor.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "26px",
        height: "26px",
        border: "2.5px solid rgba(11,26,47,0.8)",
        borderRadius: "50%",
        background: "rgba(61,190,107,0.30)",
        boxShadow: "0 1px 8px rgba(11,26,47,0.35)",
        zIndex: "2147483647",
        pointerEvents: "none",
        transform: "translate(-50%,-50%)",
        transition: "width .12s ease, height .12s ease, background .12s ease, opacity .12s ease",
        opacity: "0",
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(cursor);

      const syncVisibility = () => {
        cursor.style.opacity = document.body.dataset.plkCursor === "on" ? "1" : "0";
      };
      syncVisibility();
      new MutationObserver(syncVisibility).observe(document.body, {
        attributes: true,
        attributeFilter: ["data-plk-cursor"],
      });

      window.addEventListener(
        "mousemove",
        (event) => {
          if (document.body.dataset.plkCursor !== "on") return;
          cursor.style.left = `${event.clientX}px`;
          cursor.style.top = `${event.clientY}px`;
        },
        true,
      );
      window.addEventListener(
        "mousedown",
        () => {
          cursor.style.width = "16px";
          cursor.style.height = "16px";
          cursor.style.background = "rgba(61,190,107,0.65)";
        },
        true,
      );
      window.addEventListener(
        "mouseup",
        () => {
          cursor.style.width = "26px";
          cursor.style.height = "26px";
          cursor.style.background = "rgba(61,190,107,0.30)";
        },
        true,
      );
    };

    if (document.body) installCursor();
    else document.addEventListener("DOMContentLoaded", installCursor);
  });
}

export async function saveFilmVideo(page: Page, filmId: string) {
  const outputDirectory = resolve(here, "out", filmId);
  mkdirSync(outputDirectory, { recursive: true });
  const video = page.video();
  if (!video) {
    throw new Error(`Playwright did not create a video for ${filmId}.`);
  }
  const destination = resolve(outputDirectory, "capture.webm");
  await page.close();
  await video.saveAs(destination);
  return destination;
}

export class FilmCursor {
  private x = 960;
  private y = 620;

  constructor(private readonly page: Page) {}

  private async setVisible(visible: boolean) {
    await this.page.evaluate((show) => {
      document.body.dataset.plkCursor = show ? "on" : "off";
    }, visible);
  }

  private async glideTo(locator: Locator, durationMs = 520) {
    await required(locator, "cursor target");
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("Required cursor target has no bounding box.");
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    const frames = Math.max(8, Math.round(durationMs / 16));
    const startX = this.x;
    const startY = this.y;
    for (let index = 1; index <= frames; index += 1) {
      const raw = index / frames;
      const eased =
        raw < 0.5
          ? 2 * raw * raw
          : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      await this.page.mouse.move(
        startX + (targetX - startX) * eased,
        startY + (targetY - startY) * eased,
      );
      await this.page.waitForTimeout(14);
    }
    this.x = targetX;
    this.y = targetY;
  }

  async click(locator: Locator) {
    await this.setVisible(true);
    await this.glideTo(locator);
    await this.page.waitForTimeout(160);
    await this.page.mouse.down();
    await this.page.waitForTimeout(90);
    await this.page.mouse.up();
    await this.page.waitForTimeout(220);
    await this.hide();
  }

  async type(locator: Locator, value: string) {
    await required(locator, "typing target");
    await this.setVisible(true);
    await this.glideTo(locator);
    await locator.click();
    await this.page.keyboard.press("Control+a");
    await this.page.keyboard.press("Delete");
    await this.page.keyboard.type(value, { delay: 52 });
    await this.hide();
  }

  async hide() {
    await this.setVisible(false);
  }
}
