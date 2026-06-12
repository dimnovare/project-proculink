import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

/**
 * Shared helpers for the per-tool walkthrough captures.
 *
 * The recordings are FOOTAGE, not verification: every action is fail-soft so a
 * take never aborts, and the visible cursor + eased glides make the take read
 * like a calm human demo instead of a Playwright test.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface ToolBeat {
  id: string;
  shot: string;
  vo: string;
  /** Wait this long after the beat marker before starting the beat's actions. */
  actionLeadMs?: number;
  /** Extra dwell after the VO budget (action-heavy beats). */
  extraMs?: number;
}

export interface ToolSpec {
  id: string;
  toolName: string;
  route: string;
  kicker: string;
  outroLine: string;
  beats: ToolBeat[];
}

export function loadToolSpec(toolId: string): ToolSpec {
  return JSON.parse(readFileSync(resolve(here, `${toolId}.json`), "utf8")) as ToolSpec;
}

/**
 * Per-beat hold budget = measured VO duration (out/tools/<id>/vo/manifest.json,
 * written by generate-tool-vo.mjs) + a reading pad. Falls back to a word-count
 * estimate (~2.5 words/sec) when the VO hasn't been generated yet, so the
 * capture can be rehearsed before any ElevenLabs call.
 */
export function holdBudgets(spec: ToolSpec, padMs = 1100): Record<string, number> {
  const manifestPath = resolve(here, "out", spec.id, "vo", "manifest.json");
  const measured: Record<string, number> = {};
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ id: string; durationSec: number }>;
    for (const m of manifest) measured[m.id] = m.durationSec * 1000;
  }
  const holds: Record<string, number> = {};
  for (const b of spec.beats) {
    const voMs = measured[b.id] ?? (b.vo.trim().split(/\s+/).length / 2.5) * 1000;
    holds[b.id] = Math.round(voMs + padMs + (b.extraMs ?? 0));
  }
  return holds;
}

/** Marker clock — written to out/tools/<id>/markers.json for the assembler. */
export class MarkerClock {
  private t0 = Date.now();
  readonly markers: Record<string, number> = {};
  mark(id: string) {
    this.markers[id] = (Date.now() - this.t0) / 1000;
    console.log(`[tool-demo] ${id} @ ${this.markers[id].toFixed(1)}s`);
  }
  /** ms elapsed since the given marker. */
  since(id: string) {
    return Date.now() - (this.t0 + (this.markers[id] ?? 0) * 1000);
  }
  save(toolId: string) {
    const dir = resolve(here, "out", toolId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "markers.json"), JSON.stringify(this.markers, null, 2), "utf8");
    console.log("[tool-demo] markers:", JSON.stringify(this.markers));
  }
}

/**
 * Pre-page setup: seed cookie consent (no banner on camera), hide the mock-data
 * badge + Next dev overlays, and inject a visible demo cursor that follows the
 * real mouse events (Playwright recordings have no OS cursor).
 */
export async function prepareDemoPage(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* ignore */
    }

    const css =
      'span[title^="You are viewing mock data"]{display:none!important;}' +
      "nextjs-portal,[data-next-badge-root],[data-nextjs-toast]," +
      "[data-nextjs-dev-tools-button],#__next-build-watcher," +
      "[data-nextjs-dialog-overlay]{display:none!important;}" +
      "*{caret-color:transparent}"; // no blinking caret jitter in inputs on camera
    const addCss = () => {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) addCss();
    else document.addEventListener("DOMContentLoaded", addCss);

    // Hide the mock-mode-only "(Demo: click anywhere …)" dropzone hint — mock
    // furniture, not product. visibility (not display) so the layout is stable.
    const hideDemoHints = () => {
      for (const el of Array.from(document.querySelectorAll("p,span,div,em,i"))) {
        if (el.children.length === 0 && (el.textContent ?? "").trim().startsWith("(Demo:")) {
          (el as HTMLElement).style.visibility = "hidden";
        }
      }
    };
    const startHintWatch = () => {
      hideDemoHints();
      new MutationObserver(hideDemoHints).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) startHintWatch();
    else document.addEventListener("DOMContentLoaded", startHintWatch);

    // Visible demo cursor — a soft green dot with a navy ring. Tracks real
    // mousemove events (page.mouse.move emits them), shrinks on mousedown.
    const addCursor = () => {
      if (document.getElementById("plk-demo-cursor") || !document.body) return;
      const c = document.createElement("div");
      c.id = "plk-demo-cursor";
      Object.assign(c.style, {
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
        transition: "width .12s ease, height .12s ease, background .12s ease",
        opacity: "0",
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(c);
      window.addEventListener(
        "mousemove",
        (e) => {
          c.style.opacity = "1";
          c.style.left = `${e.clientX}px`;
          c.style.top = `${e.clientY}px`;
        },
        true,
      );
      window.addEventListener(
        "mousedown",
        () => {
          c.style.width = "16px";
          c.style.height = "16px";
          c.style.background = "rgba(61,190,107,0.65)";
        },
        true,
      );
      window.addEventListener(
        "mouseup",
        () => {
          c.style.width = "26px";
          c.style.height = "26px";
          c.style.background = "rgba(61,190,107,0.30)";
        },
        true,
      );
    };
    if (document.body) addCursor();
    else document.addEventListener("DOMContentLoaded", addCursor);
  });
}

/** Eased, deliberate cursor glide — feels human, not teleporting. */
export class DemoCursor {
  private x = 960;
  private y = 620;
  constructor(private page: Page) {}

  async glideToPoint(tx: number, ty: number, ms = 700) {
    const frames = Math.max(8, Math.round(ms / 16));
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      await this.page.mouse.move(x0 + (tx - x0) * e, y0 + (ty - y0) * e);
      await this.page.waitForTimeout(14);
    }
    this.x = tx;
    this.y = ty;
  }

  async glideTo(loc: Locator, ms = 700, offset?: { dx?: number; dy?: number }) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    await this.glideToPoint(
      box.x + box.width / 2 + (offset?.dx ?? 0),
      box.y + box.height / 2 + (offset?.dy ?? 0),
      ms,
    );
    return true;
  }

  /** Glide to the element, settle briefly, then click — all fail-soft. */
  async click(loc: Locator, ms = 700, settleMs = 350) {
    const ok = await this.glideTo(loc, ms);
    if (!ok) return false;
    await this.page.waitForTimeout(settleMs);
    await this.page.mouse.down();
    await this.page.waitForTimeout(110);
    await this.page.mouse.up();
    return true;
  }
}

/** Fail-soft wrapper: a missed selector logs and moves on — a take never aborts. */
export async function soft(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.log(`[tool-demo] soft-skip ${label}: ${(e as Error).message}`);
  }
}
