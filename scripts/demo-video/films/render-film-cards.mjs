#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveProcessTimeoutMs,
  runFilmProcess,
} from "./film-process.mjs";
import { loadFilmSpec, validateFilmSpec } from "./film-spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..", "..");

const WIDTH = 1920;
const HEIGHT = 1080;
const NAVY = "#0B1A2F";
const BUYER_BLUE = "#2773D2";
const SUPPLIER_GREEN = "#299447";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapHeadline(value, maximumCharacters = 34) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maximumCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 3) {
    throw new Error("Film card headline must fit in at most three lines.");
  }
  return lines;
}

function headlineMarkup(lines) {
  const lineHeight = 92;
  const firstY = 510 - ((lines.length - 1) * lineHeight) / 2;
  const longest = Math.max(...lines.map((line) => line.length));
  const fontSize = Math.max(58, Math.min(82, Math.floor(2200 / longest)));
  return lines
    .map(
      (line, index) =>
        `<text x="960" y="${firstY + index * lineHeight}" ` +
        `text-anchor="middle" font-family="Arial" ` +
        `font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

export function buildCardSvg(specInput, variant) {
  const spec = validateFilmSpec(specInput);
  if (variant !== "intro" && variant !== "outro") {
    throw new Error(`Unknown film card variant: ${variant}.`);
  }
  const isIntro = variant === "intro";
  const kicker = isIntro ? spec.intro.kicker : "PROCULINK / DELIVERY BRIDGE";
  const headline = isIntro ? spec.intro.headline : spec.outro.headline;
  const footer = isIntro
    ? "BUYER PO  /  NORMALIZE  /  VALIDATE  /  SUPPLIER READY"
    : "proculink.eu";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bridge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BUYER_BLUE}"/>
      <stop offset="1" stop-color="${SUPPLIER_GREEN}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${NAVY}"/>
  <rect x="0" y="0" width="10" height="${HEIGHT}" fill="${BUYER_BLUE}"/>
  <rect x="1910" y="0" width="10" height="${HEIGHT}" fill="${SUPPLIER_GREEN}"/>
  <path d="M180 820 C620 820 620 905 960 905 S1300 820 1740 820" fill="none" stroke="url(#bridge)" stroke-width="5" stroke-linecap="round"/>
  <circle cx="180" cy="820" r="9" fill="${BUYER_BLUE}"/>
  <circle cx="1740" cy="820" r="9" fill="${SUPPLIER_GREEN}"/>
  <text x="960" y="350" text-anchor="middle" font-family="Consolas" font-size="24" font-weight="600" fill="#B8C6D9">${escapeXml(kicker)}</text>
  ${headlineMarkup(wrapHeadline(headline))}
  <text x="960" y="985" text-anchor="middle" font-family="Consolas" font-size="${isIntro ? 20 : 30}" font-weight="600" fill="${isIntro ? "#B8C6D9" : "#FFFFFF"}">${escapeXml(footer)}</text>
</svg>
`;
}

export function buildCardRenderArgs({
  svgPath,
  outputPath,
  markPath,
  lockupPath,
}) {
  return [
    svgPath,
    "(",
    "-background",
    "none",
    "-density",
    "384",
    lockupPath,
    "-resize",
    "712x160",
    "-alpha",
    "on",
    "-channel",
    "RGB",
    "-fill",
    "#FFFFFF",
    "-colorize",
    "100",
    "+channel",
    ")",
    "-geometry",
    "+604+115",
    "-composite",
    "(",
    "-background",
    "none",
    "-density",
    "384",
    markPath,
    "-resize",
    "160x160",
    ")",
    "-geometry",
    "+604+115",
    "-composite",
    "-resize",
    "1920x1080!",
    "-strip",
    outputPath,
  ];
}

export function renderFilmCards(specInput, outputDirectory, options = {}) {
  const spec = validateFilmSpec(specInput);
  const cardsDirectory = resolve(outputDirectory, "cards");
  const intro = resolve(cardsDirectory, "intro.png");
  const outro = resolve(cardsDirectory, "outro.png");
  const markPath =
    options.markPath ?? resolve(projectRoot, "public", "mark-primary.svg");
  const lockupPath =
    options.lockupPath ?? resolve(projectRoot, "public", "lockup-mono.svg");
  const magick = options.magick ?? process.env.MAGICK ?? "magick";
  const runProcess = options.runProcess ?? runFilmProcess;
  const timeoutMs =
    options.timeoutMs ?? resolveProcessTimeoutMs(options.env ?? process.env);
  mkdirSync(cardsDirectory, { recursive: true });

  for (const [variant, outputPath] of [
    ["intro", intro],
    ["outro", outro],
  ]) {
    const svgPath = resolve(cardsDirectory, `.${variant}.svg`);
    writeFileSync(svgPath, buildCardSvg(spec, variant), "utf8");
    try {
      runProcess(
        magick,
        buildCardRenderArgs({ svgPath, outputPath, markPath, lockupPath }),
        { timeoutMs },
      );
    } finally {
      rmSync(svgPath, { force: true });
    }
  }

  return { intro, outro };
}

function main() {
  const filmIds = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (filmIds.length !== 1) {
    throw new Error("Usage: node render-film-cards.mjs <film-id>");
  }
  const spec = loadFilmSpec(filmIds[0]);
  const result = renderFilmCards(spec, resolve(here, "out", filmIds[0]));
  console.log(`[${filmIds[0]}] cards: ${result.intro} + ${result.outro}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
