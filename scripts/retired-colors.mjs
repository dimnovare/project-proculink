/**
 * retired-colors.mjs — the one list of banned colour values, and every spelling
 * of them a scanner has to recognise.
 *
 * WHY THIS IS ITS OWN MODULE. It was inlined in check-tokens.mjs as
 * `new RegExp(RETIRED_COLORS.join("|"), "gi")` — a HEX-ONLY pattern. That is the
 * same defect the `color-fn` rule exists to close one layer up: `rgba(30,102,201)`
 * IS `#1E66C9` restated in decimal, and a hex-only matcher walks straight past it.
 * `rgb(40,197,94)` is the retired emerald and it passed the retired-colour rule.
 *
 * It matters more here than anywhere else, because **Tailwind emits decimal**.
 * `ring-[#28C55E]` compiles to `--tw-ring-color: rgb(40 197 94 / …)`. A hex-only
 * grep of the built CSS finds the ESCAPED SELECTOR and would miss the declaration
 * entirely if the class were ever renamed. check-emitted-css.mjs greps the
 * compiler's real output, so it needs both spellings or it is decoration.
 *
 * docs/design-system/11-unified-page-rules.md: "the retired emerald greens
 * #28C55E, #1DAF50, #1AAF50 are banned".
 */

/** The banned values, as the design system writes them. */
export const RETIRED_COLORS = ["#28C55E", "#1DAF50", "#1AAF50"];

/** `#RRGGBB` → `[r, g, b]` decimal. */
export function rgbTriple(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** `#28C55E` → `40 197 94`, for reports. */
export const RETIRED_TRIPLES = RETIRED_COLORS.map(rgbTriple);

/**
 * Every retired value in EITHER spelling:
 *   • the hex literal, case-insensitively (`#28C55E`, `#28c55e`);
 *   • the decimal triple in any separator CSS or JS uses — `rgb(40,197,94)`,
 *     `rgba(40, 197, 94, .5)`, the modern space form `rgb(40 197 94 / 1)`, and a
 *     bare `--rgb-token: 40 197 94` custom property.
 *
 * The decimal branch is bounded by `(?<![\d.])` / `(?![\d.])` so `140 197 94` and
 * `40 197 940` do not match. It deliberately does NOT require an `rgb(` prefix:
 * the bare-triple custom-property spelling is how a token file would restate it.
 */
export function retiredRegex() {
  const hex = RETIRED_COLORS.join("|");
  const decimal = RETIRED_TRIPLES.map(
    ([r, g, b]) => `(?<![\\d.])${r}[\\s,]+${g}[\\s,]+${b}(?![\\d.])`,
  ).join("|");
  return new RegExp(`${hex}|${decimal}`, "gi");
}

/** Human-readable list for a failure message. */
export const RETIRED_DESCRIPTION = RETIRED_COLORS.map(
  (hex, i) => `${hex} (= rgb(${RETIRED_TRIPLES[i].join(" ")}))`,
).join(", ");
