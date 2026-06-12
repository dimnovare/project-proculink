#!/usr/bin/env node
/**
 * Per-tool intro / outro cards (1920×1080 PNG) — same brand language as the
 * main walkthrough's make-cards.mjs (navy backdrop, blue→green bridge mark,
 * white wordmark, Segoe UI), but the intro names the TOOL and the outro closes
 * with proculink.eu.
 *
 *   node scripts/demo-video/tools/make-tool-cards.mjs upload [review …]
 *
 * Output: tools/out/<tool>/cards/intro.png + outro.png.
 * Requires ImageMagick (`magick`) on PATH; no node image dependency.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const MAGICK = process.env.MAGICK ?? "magick";

// Brand tokens (mirroring src/app/globals.css, same as ../make-cards.mjs).
const NAVY = "#0B1A2F";
const NAVY_BORDER = "#1C2F49";
const NAVY_TEXT = "#C5D2E4";
const NAVY_MUTED = "#7C8DA6";
const BLUE = "#1E66C9";
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
        <stop offset="0%" stop-color="${BLUE}"/><stop offset="100%" stop-color="${GREEN}"/>
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
      <stop offset="0%" stop-color="${BLUE}"/><stop offset="100%" stop-color="${GREEN}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${NAVY}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#deck)"/>`;

// Intro: lockup + kicker + the tool's name as the headline.
function introCard(spec) {
  const sc = 3.2;
  const lw = 178 * sc;
  const lx = (W - lw) / 2, ly = 300;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(lx, ly, sc)}
    <text x="${W / 2}" y="620" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="3" fill="${GREEN_CTA}">${esc((spec.kicker ?? "Tool guide").toUpperCase())}</text>
    <text x="${W / 2}" y="724" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="88" letter-spacing="-1.5" fill="#FFFFFF">${esc(spec.toolName)}</text>
    <text x="${W / 2}" y="${H - 70}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="26" fill="${NAVY_MUTED}">proculink.eu</text>
  </svg>`;
}

// Outro: lockup + closing line + domain.
function outroCard(spec) {
  const sc = 3.6;
  const lw = 178 * sc;
  const lx = (W - lw) / 2, ly = 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(lx, ly, sc)}
    ${spec.outroLine ? `<text x="${W / 2}" y="660" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="44" letter-spacing="-0.5" fill="${NAVY_TEXT}">${esc(spec.outroLine)}</text>` : ""}
    <rect x="${W / 2 - 230}" y="716" width="460" height="78" rx="39" fill="${GREEN_CTA}"/>
    <text x="${W / 2}" y="767" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="34" letter-spacing="-0.3" fill="#06210F">proculink.eu</text>
  </svg>`;
}

function rasterise(svg, outPng) {
  const tmp = outPng.replace(/\.png$/, ".svg");
  writeFileSync(tmp, svg, "utf8");
  execFileSync(
    MAGICK,
    ["-background", "none", "-density", "144", tmp, "-resize", `${W}x${H}`, "-quality", "100", outPng],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  rmSync(tmp, { force: true });
}

export function makeToolCards(tool) {
  const spec = JSON.parse(readFileSync(resolve(here, `${tool}.json`), "utf8"));
  const cardsDir = resolve(here, "out", tool, "cards");
  mkdirSync(cardsDir, { recursive: true });
  const intro = resolve(cardsDir, "intro.png");
  const outro = resolve(cardsDir, "outro.png");
  rasterise(introCard(spec), intro);
  rasterise(outroCard(spec), outro);
  return { intro, outro };
}

if (process.argv[1]?.endsWith("make-tool-cards.mjs")) {
  const tools = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (tools.length === 0) {
    console.error("Usage: node make-tool-cards.mjs <tool> [<tool> …]");
    process.exit(1);
  }
  for (const t of tools) {
    const r = makeToolCards(t);
    console.log(`[${t}] ✅ cards → ${r.intro} + ${r.outro}`);
  }
}
