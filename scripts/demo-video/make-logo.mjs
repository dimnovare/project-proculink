#!/usr/bin/env node
/**
 * Rasterize the ProcuLink logo to transparent PNGs for the video title cards.
 *
 * The shipped SVGs can't be dropped straight onto a navy (#0B1A2F) card:
 *   - lockup-primary.svg has DARK-navy wordmark text → invisible on navy.
 *   - lockup-mono.svg is currentColor → rasterizes to black → invisible.
 * So we render a navy-card variant here: the real blue→green gradient MARK
 * (the System Identity glyph) plus a WHITE "ProcuLink" wordmark.
 *
 * Outputs (transparent PNG, high-res for crisp downscaling in ffmpeg):
 *   out/logo-lockup.png   mark + white wordmark  (the logo used on the cards)
 *   out/logo-mark.png     mark only              (accent / fallback)
 *
 *   node scripts/demo-video/make-logo.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1E66C9"/><stop offset="100%" stop-color="#2E8E3A"/>
  </linearGradient>`;
// The arc + the two port dots — pure vector, no font dependency.
const MARK_BODY = `<path d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8" stroke="url(#g)" stroke-width="3.6" stroke-linecap="round" fill="none"/>
  <circle cx="8" cy="10" r="2.5" fill="#1E66C9"/>
  <circle cx="8" cy="30" r="2.5" fill="#2E8E3A"/>`;

const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 178 40" fill="none">
  <defs>${GRAD}</defs>
  ${MARK_BODY}
  <text x="48" y="27" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-weight="700" font-size="22" letter-spacing="-0.015em" fill="#FFFFFF">ProcuLink</text>
</svg>`;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
  <defs>${GRAD}</defs>
  ${MARK_BODY}
</svg>`;

export async function makeLogos(outDir) {
  mkdirSync(outDir, { recursive: true });
  // density high so the rasterised base is larger than the final target → crisp.
  await sharp(Buffer.from(lockupSvg), { density: 900 })
    .resize({ width: 1600 })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, "logo-lockup.png"));
  await sharp(Buffer.from(markSvg), { density: 1600 })
    .resize({ width: 520 })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, "logo-mark.png"));
  return {
    lockup: resolve(outDir, "logo-lockup.png"),
    mark: resolve(outDir, "logo-mark.png"),
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("make-logo.mjs")) {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = await makeLogos(resolve(here, "out"));
  console.log("✅ logos:", files);
}
