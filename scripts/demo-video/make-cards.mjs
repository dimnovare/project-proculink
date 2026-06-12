#!/usr/bin/env node
/**
 * Render the walkthrough's title cards as on-brand 1920x1080 PNGs.
 *
 * No screen-recording: this is a clean, card-based walkthrough. Each scene in
 * scenes.json becomes one navy card with the brand lockup, a step kicker, a
 * headline and a supporting line. Plus a branded intro and outro card.
 *
 * SVG is composed here (full control over typography + the blue->green brand
 * mark) and rasterised with ImageMagick (`magick`) — so this needs NO node
 * image dependency (no sharp). ffmpeg then animates each PNG (fade + slow zoom)
 * in assemble.mjs.
 *
 *   node scripts/demo-video/make-cards.mjs        # renders every card to out/cards/
 *
 * Brand tokens mirror src/app/globals.css.
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const MAGICK = process.env.MAGICK ?? "magick";

// --- Brand tokens (from globals.css) ---------------------------------------
const NAVY = "#0B1A2F";
const NAVY_SURFACE = "#10243E";
const NAVY_BORDER = "#1C2F49";
const NAVY_TEXT = "#C5D2E4";
const NAVY_MUTED = "#7C8DA6";
const BLUE = "#1E66C9";
const GREEN = "#2E8E3A";
const GREEN_CTA = "#3DBE6B";
const W = 1920, H = 1080;
// Pango (ImageMagick's SVG text engine) wants a single resolvable family, not a
// quoted CSS stack. Segoe UI is the brand's documented UI fallback and ships on
// Windows — clean, professional, and matches the app's typography closely.
const FONT = "Segoe UI";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The blue->green "bridge" mark + white "ProcuLink" wordmark (navy-card variant).
function lockup(x, y, scale = 1) {
  const s = (n) => (n * scale).toFixed(2);
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

// Multi-line headline (body uses literal "\n" from scenes.json).
function lines(text, x, y, lh, attrs) {
  return text
    .split("\\n")
    .map((ln, i) => `<text x="${x}" y="${y + i * lh}" ${attrs}>${esc(ln)}</text>`)
    .join("");
}

// Soft brand glow behind the card (subtle, enterprise — not flashy).
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

// Step-progress dots along the bottom (filled up to `active`).
function stepStrip(active, total) {
  if (active < 0) return "";
  const gap = 34, r = 6;
  const totalW = (total - 1) * gap;
  const x0 = W / 2 - totalW / 2;
  let out = "";
  for (let i = 0; i < total; i++) {
    const cx = x0 + i * gap;
    const on = i <= active;
    out += `<circle cx="${cx}" cy="${H - 78}" r="${on ? r : r - 1.5}" fill="${on ? GREEN_CTA : NAVY_BORDER}"/>`;
  }
  return out;
}

// A standard content scene card.
function sceneCard(s, idx, total) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(150, 120, 2.0)}
    <text x="160" y="430" font-family="${FONT}" font-weight="700" font-size="34" letter-spacing="2" fill="${GREEN_CTA}" opacity="0.95">${esc(s.kicker.toUpperCase())}</text>
    <text x="158" y="540" font-family="${FONT}" font-weight="800" font-size="92" letter-spacing="-1.5" fill="#FFFFFF">${esc(s.title)}</text>
    ${lines(s.body, 160, 690, 84, `font-family="${FONT}" font-weight="500" font-size="64" letter-spacing="-0.5" fill="${NAVY_TEXT}"`)}
    ${stepStrip(idx, total)}
    <text x="${W - 150}" y="${H - 70}" text-anchor="end" font-family="${FONT}" font-weight="600" font-size="26" fill="${NAVY_MUTED}">proculink.eu</text>
  </svg>`;
}

// Intro: centered logo + tagline. Lockup is ~178*scale wide, ~40*scale tall;
// origin is the mark's top-left, so offset to truly centre it on the card.
function introCard() {
  const sc = 5.0;
  const lw = 178 * sc, lh = 40 * sc;
  const lx = (W - lw) / 2, ly = 392;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(lx, ly, sc)}
    <text x="${W / 2}" y="${ly + lh + 96}" text-anchor="middle" font-family="${FONT}" font-weight="500" font-size="54" letter-spacing="-0.5" fill="${NAVY_TEXT}">The missing link between buyers and suppliers.</text>
  </svg>`;
}

// Outro: logo + statement + green CTA.
function outroCard() {
  const sc = 4.4;
  const lw = 178 * sc;
  const lx = (W - lw) / 2, ly = 322;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BACKDROP}
    ${lockup(lx, ly, sc)}
    <text x="${W / 2}" y="615" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="70" letter-spacing="-1" fill="#FFFFFF">Connecting procurement.</text>
    <rect x="${W / 2 - 300}" y="690" width="600" height="90" rx="45" fill="${GREEN_CTA}"/>
    <text x="${W / 2}" y="749" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="40" letter-spacing="-0.3" fill="#06210F">Start free at proculink.eu</text>
  </svg>`;
}

function rasterise(svg, outPng) {
  const tmp = outPng.replace(/\.png$/, ".svg");
  writeFileSync(tmp, svg, "utf8");
  // -density high + supersample for crisp text, then exact 1920x1080.
  execFileSync(
    MAGICK,
    ["-background", "none", "-density", "144", tmp, "-resize", `${W}x${H}`, "-quality", "100", outPng],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  rmSync(tmp, { force: true });
}

export function makeCards(outDir) {
  const scenes = JSON.parse(readFileSync(resolve(here, "scenes.json"), "utf8"));
  const cardsDir = resolve(outDir, "cards");
  mkdirSync(cardsDir, { recursive: true });

  const intro = resolve(cardsDir, "intro.png");
  const outro = resolve(cardsDir, "outro.png");
  rasterise(introCard(), intro);
  rasterise(outroCard(), outro);

  const scenePngs = {};
  scenes.forEach((s, i) => {
    const p = resolve(cardsDir, `${s.id}.png`);
    rasterise(sceneCard(s, i, scenes.length), p);
    scenePngs[s.id] = p;
  });
  return { intro, outro, scenePngs, scenes };
}

if (process.argv[1]?.endsWith("make-cards.mjs")) {
  const out = resolve(here, "out");
  const r = makeCards(out);
  console.log("✅ cards →", resolve(out, "cards"));
  console.log("   intro:", r.intro);
  console.log("   outro:", r.outro);
  console.log("   scenes:", Object.keys(r.scenePngs).join(", "));
}
