#!/usr/bin/env node
/**
 * Render the v8 OUTRO card (1920×1080 PNG) — the founder-locked close:
 * big lockup + "Connecting procurement." + the green "Start free at
 * proculink.eu" CTA pill. Same brand language as the per-tool cards
 * (tools/make-tool-cards.mjs) so v8's tail matches the rest of the family.
 *
 * (v8's INTRO is the animated cold open, not a static card, so only the outro
 * is rendered here.)
 *
 *   node scripts/demo-video/v8/make-outro-card.mjs
 *
 * Output: v8/out/cards/outro.png. Requires ImageMagick (`magick`) on PATH.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const MAGICK = process.env.MAGICK ?? "magick";

const NAVY = "#0B1A2F";
const BLUE = "#1E66C9";
const VIOLET = "#6E59F2";
const GREEN = "#2E8E3A";
const GREEN_CTA = "#3DBE6B";
const W = 1920, H = 1080;
const FONT = "Segoe UI";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lockup(x, y, scale = 1) {
  return `
  <g transform="translate(${x},${y}) scale(${scale})">
    <defs>
      <linearGradient id="markg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${BLUE}"/><stop offset="52%" stop-color="${VIOLET}"/><stop offset="100%" stop-color="${GREEN}"/>
      </linearGradient>
    </defs>
    <path d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8" stroke="url(#markg)" stroke-width="3.6" stroke-linecap="round" fill="none"/>
    <circle cx="8" cy="10" r="2.6" fill="${BLUE}"/>
    <circle cx="8" cy="30" r="2.6" fill="${GREEN}"/>
    <text x="48" y="28" font-family="${FONT}" font-weight="700" font-size="23" letter-spacing="-0.4" fill="#FFFFFF">ProcuLink</text>
  </g>`;
}

const BACKDROP = `
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.36" r="0.62">
      <stop offset="0%" stop-color="#16365C" stop-opacity="0.85"/>
      <stop offset="60%" stop-color="${NAVY}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="deck" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${BLUE}"/><stop offset="52%" stop-color="${VIOLET}"/><stop offset="100%" stop-color="${GREEN}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${NAVY}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#deck)"/>`;

function outroCard() {
  const sc = 4.4;
  const lw = 178 * sc;
  const lx = (W - lw) / 2, ly = 322;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(lx, ly, sc)}
    <text x="${W / 2}" y="615" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="70" letter-spacing="-1" fill="#FFFFFF">${esc("Connecting procurement.")}</text>
    <rect x="${W / 2 - 300}" y="690" width="600" height="90" rx="45" fill="${GREEN_CTA}"/>
    <text x="${W / 2}" y="749" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="40" letter-spacing="-0.3" fill="#06210F">${esc("Start free at proculink.eu")}</text>
  </svg>`;
}

export function makeOutroCard() {
  const cardsDir = resolve(here, "out", "cards");
  mkdirSync(cardsDir, { recursive: true });
  const outro = resolve(cardsDir, "outro.png");
  const tmp = outro.replace(/\.png$/, ".svg");
  writeFileSync(tmp, outroCard(), "utf8");
  execFileSync(MAGICK, ["-background", "none", "-density", "144", tmp, "-resize", `${W}x${H}`, "-quality", "100", outro], { stdio: ["ignore", "ignore", "inherit"] });
  rmSync(tmp, { force: true });
  return outro;
}

if (process.argv[1]?.endsWith("make-outro-card.mjs")) {
  const r = makeOutroCard();
  console.log(`✅ outro card → ${r}`);
}
