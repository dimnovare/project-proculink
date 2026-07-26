import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { SHOTS, type Shot } from "./shots";

/**
 * `bun run guides:capture`
 *
 * Walks the shot list, writes public/guides/<guide>/<name>.png, then rebuilds
 * src/lib/guide-shots.generated.ts from what is actually on disk.
 *
 * Rebuilding the manifest from disk (rather than from this run's results) keeps
 * a partial run coherent: a shot that failed today keeps yesterday's image and
 * its manifest entry, and deleting a PNG by hand removes it from the manifest on
 * the next run. `<GuideShot>` renders only what the manifest lists, so a guide
 * can never ship a broken image.
 *
 * One failing shot does not abort the rest — every failure is collected and the
 * test fails at the end with the full list, so a run tells you everything that
 * needs attention instead of only the first thing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..");
const PUBLIC_GUIDES = join(ROOT, "public", "guides");
const MANIFEST = join(ROOT, "src", "lib", "guide-shots.generated.ts");

/** Consent + dev-overlay suppression. Mirrors scripts/demo-video/tools/demo-helpers.ts. */
async function prepareGuidePage(page: Page, hideTexts: string[] = []) {
  await page.addInitScript((patterns: string[]) => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* ignore */
    }

    const css =
      // The mock-data badge is dev furniture, not product.
      'span[title^="You are viewing mock data"]{display:none!important;}' +
      // Next.js dev tooling overlays.
      "nextjs-portal,[data-next-badge-root],[data-nextjs-toast]," +
      "[data-nextjs-dev-tools-button],#__next-build-watcher," +
      "[data-nextjs-dialog-overlay]{display:none!important;}" +
      // No blinking caret in a still image.
      "*{caret-color:transparent}";

    const addCss = () => {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) addCss();
    else document.addEventListener("DOMContentLoaded", addCss);

    if (patterns.length === 0) return;
    const hideSmallest = () => {
      for (const pat of patterns) {
        const all = Array.from(
          document.querySelectorAll<HTMLElement>("p,span,div,em,i,td,code"),
        );
        for (const el of all) {
          if (!(el.textContent ?? "").includes(pat)) continue;
          const childHasIt = Array.from(el.children).some((c) =>
            (c.textContent ?? "").includes(pat),
          );
          if (!childHasIt) el.style.visibility = "hidden";
        }
      }
    };
    const start = () => {
      hideSmallest();
      new MutationObserver(hideSmallest).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }, hideTexts);
}

async function captureShot(page: Page, shot: Shot): Promise<void> {
  await prepareGuidePage(page, shot.hideTexts);
  await page.goto(shot.path, { waitUntil: "domcontentloaded" });

  for (const label of shot.clickTexts ?? []) {
    const target = page.getByText(label, { exact: false }).first();
    await target.waitFor({ state: "visible", timeout: 30_000 });
    await target.click();
    await page.waitForTimeout(350);
  }

  const anchor = page.getByText(shot.anchor, { exact: false }).first();
  await anchor.waitFor({ state: "visible", timeout: 30_000 });

  // Frame the shot: put the anchor at the top of the viewport, then pull back by
  // `offset` px so the reader sees the heading and card above it.
  //
  // Neither `scrollIntoViewIfNeeded()` nor `window.scrollBy()` is enough here.
  // In-app pages scroll inside PageShell's overflow container, not the window,
  // so window scrolling is a no-op — and scrollIntoViewIfNeeded does nothing at
  // all when the anchor is already partly visible, which silently produced two
  // byte-identical screenshots of the same page.
  await anchor.evaluate((el, off) => {
    el.scrollIntoView({ block: "start", inline: "nearest" });
    if (!off) return;
    let parent = el.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop -= off;
        return;
      }
      parent = parent.parentElement;
    }
    window.scrollBy(0, -off);
  }, shot.offset ?? 0);

  // Fonts must be swapped in before the shutter or the capture shows fallback
  // metrics — Bricolage/Inter/JetBrains all load as webfonts.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(shot.settle ?? 500);

  const file = join(PUBLIC_GUIDES, shot.guide, `${shot.name}.png`);
  mkdirSync(dirname(file), { recursive: true });

  const viewport = page.viewportSize();
  await page.screenshot({
    path: file,
    animations: "disabled",
    scale: "device",
    ...(shot.clipHeight && viewport
      ? { clip: { x: 0, y: 0, width: viewport.width, height: shot.clipHeight } }
      : {}),
  });
}

/** Read a PNG's intrinsic size straight out of its IHDR chunk. */
function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function collectPngs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectPngs(full, out);
    else if (entry.endsWith(".png")) out.push(full);
  }
  return out;
}

function writeManifest(): number {
  const files = collectPngs(PUBLIC_GUIDES).sort();
  const rows = files.map((file) => {
    const key = relative(PUBLIC_GUIDES, file).replace(/\\/g, "/").replace(/\.png$/, "");
    const { w, h } = pngSize(file);
    return `  "${key}": { w: ${w}, h: ${h} },`;
  });

  const body = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by \`bun run guides:capture\` (scripts/guide-shots/capture.spec.ts).
 * It is the manifest of screenshots that actually exist under public/guides/,
 * with their intrinsic pixel size.
 *
 * \`<GuideShot>\` reads this manifest instead of guessing: a shot listed here
 * renders as a real <img> with correct width/height (no layout shift); a shot
 * NOT listed renders nothing in production and a dashed placeholder in dev.
 * That way a guide can reference a screenshot before the capture has been run
 * without ever shipping a broken image to a customer.
 */

export interface GuideShotMeta {
  /** Intrinsic width in CSS pixels. */
  w: number;
  /** Intrinsic height in CSS pixels. */
  h: number;
}

/** Keyed \`"<guide-slug>/<shot-name>"\`. */
export const GUIDE_SHOTS: Record<string, GuideShotMeta> = {${
    rows.length ? `\n${rows.join("\n")}\n` : ""
  }};
`;

  writeFileSync(MANIFEST, body, "utf8");
  return files.length;
}

test("capture guide screenshots", async ({ page }) => {
  const failures: string[] = [];

  for (const shot of SHOTS) {
    const label = `${shot.guide}/${shot.name}`;
    try {
      await captureShot(page, shot);
      console.log(`  captured  ${label}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
      failures.push(`${label} (${shot.path} — anchor "${shot.anchor}"): ${reason}`);
      console.log(`  FAILED    ${label}: ${reason}`);
    }
  }

  const total = writeManifest();
  console.log(`\nManifest rebuilt from disk: ${total} screenshot(s) in public/guides/`);

  expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
});
