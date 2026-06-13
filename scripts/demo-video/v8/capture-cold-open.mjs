#!/usr/bin/env node
/**
 * Capture the v8 COLD OPEN motion scene deterministically.
 *
 * Loads v8/cold-open.html in a headed-size 1920×1080 Chromium (via the
 * Playwright Node API — no test runner, no Next dev server) and records the
 * all-CSS-keyframe animation to a webm. The scene is 100% keyframe-driven (no
 * rAF / no Math.random), so successive captures are frame-stable.
 *
 *   node scripts/demo-video/v8/capture-cold-open.mjs
 *
 * Output: v8/out/cold-open.webm  (then assemble-v8.mjs transcodes → mp4 head).
 *
 * We deliberately use chromium (full, not headless-shell) at a real window
 * size so the GPU-less software compositor still renders the gradients/blur
 * crisply, and record for SCENE_SEC seconds.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCENE_SEC = parseFloat(process.env.V8_SCENE_SEC ?? "12.6");
const outDir = resolve(here, "out");
mkdirSync(outDir, { recursive: true });

const htmlUrl = pathToFileURL(resolve(here, "cold-open.html")).href;

const browser = await chromium.launch({
  args: [
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--disable-gpu", // software path renders the blur/gradient deterministically
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  reducedMotion: "no-preference",
});
const page = await context.newPage();

console.log(`[v8 cold-open] ▶ loading ${htmlUrl}`);
await page.goto(htmlUrl, { waitUntil: "load" });
// Let the keyframes run their full course (clock starts at page load).
await page.waitForTimeout(Math.round(SCENE_SEC * 1000));

const video = page.video();
await page.close();
await context.close();
await browser.close();

const raw = await video.path();
// Saved under a random name by Playwright; rename deterministically.
const dest = resolve(outDir, "cold-open.webm");
const { renameSync, existsSync, rmSync } = await import("node:fs");
if (existsSync(dest)) rmSync(dest);
renameSync(raw, dest);
console.log(`[v8 cold-open] ✅ ${dest}`);
