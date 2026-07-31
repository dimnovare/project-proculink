import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * WP-28 — emoji may never be used as an icon inside the product UI.
 *
 * The Bridge Layer's construction language is SVG glyphs and CSS shapes with a
 * shared geometry (MarkSystem, CheckGlyph, WarnGlyph, the 6px badge dot). An
 * emoji renders in the platform's font, at the platform's size, in the
 * platform's colour — it cannot participate in that language, it cannot be
 * recoloured for a state, and it reads as a different product on Windows vs
 * macOS vs Android. CLAUDE.md §12 and the Wave-4 constraints both ban it.
 *
 * The one that shipped: OrderWorkshop's practice-order banner used U+1F7E2
 * (a green circle) where InvoiceBadge — FOURTEEN LINES ABOVE IT, in the same
 * file, for the same kind of badge — already drew a 6px CSS dot.
 *
 * WHY `Emoji_Presentation` AND NOT `Extended_Pictographic`.
 * The codebase deliberately uses text-presentation symbols as typographic
 * marks: U+2713, U+26A0, U+2726, U+2715, U+22EF, U+24D8, U+2192, U+25C9/U+25CB,
 * U+2039/U+203A. Every one of those is `Extended_Pictographic=Yes` but
 * `Emoji_Presentation=No` — they render as glyphs in the page's own font at the
 * page's own colour, which IS the construction language. A guard written
 * against `\p{Extended_Pictographic}` would fail on shipped, correct code.
 *
 * `Emoji_Presentation=Yes` is the precise property for "this codepoint renders
 * as a colour emoji by default", which is the thing that is banned. U+FE0F
 * (VARIATION SELECTOR-16) is caught too: it FORCES emoji presentation onto an
 * otherwise-text symbol, so a variation-selected warning sign is banned while
 * the bare U+26A0 stays legal.
 *
 * This file lives in src/test, which is NOT scanned, so the codepoints above
 * are named rather than written.
 */

const ROOT = join(process.cwd(), "src", "components");

/** Colour-by-default emoji, plus the selector that forces emoji presentation. */
const EMOJI_ICON = new RegExp("\\p{Emoji_Presentation}|\\uFE0F", "u");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no emoji used as an icon in src/components", () => {
  it("finds no colour-by-default emoji in any component source", () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const hit = line.match(EMOJI_ICON);
          if (!hit) return;
          const cp = hit[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
          offenders.push(
            `${relative(process.cwd(), file).replace(/\\/g, "/")}:${i + 1}  U+${cp}  ${line.trim().slice(0, 100)}`,
          );
        });
    }

    expect(
      offenders,
      "Emoji used as an icon. Use an SVG glyph or a CSS shape from the system's " +
        "construction language instead (MarkSystem / CheckGlyph / WarnGlyph / the 6px badge dot):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
