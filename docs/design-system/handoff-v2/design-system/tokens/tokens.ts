/**
 * ProcuLink design tokens — typed TS exports.
 *
 * Import in any TS file:
 *   import { color, font, size } from "@/design-system/tokens/tokens";
 *
 * Source of truth: tokens.json. Keep this file in sync if you edit JSON.
 */

export const color = {
  brand: {
    blue:      "#1E66C9",
    blueDeep:  "#0F4FA8",
    blueSoft:  "#EAF0F8",
    green:     "#2E8E3A",
    greenDeep: "#1E6D29",
    greenSoft: "#E9F1EA",
  },
  navy: {
    DEFAULT: "#0B1A2F",
    surface: "#14253D",
    border:  "#1F3252",
    text:    "#C8D1E0",
    muted:   "#7C8DA6",
  },
  bg:       "#F6F7FA",
  bgWarm:   "#F8F6F1",
  surface:  "#FFFFFF",
  surface2: "#F1F3F7",
  border:   "#E5E8EE",
  borderStrong: "#CBD0DA",
  ink:      "#0B1A2F",
  inkMuted: "#5E6779",
  inkFaint: "#98A0AE",
  amber:    "#B36D14",
  amberSoft:"#FAF1DD",
  danger:   "#B43838",
  dangerSoft:"#FAE6E6",
  ai:       "#6F4FCE",
  aiSoft:   "#F0EAFB",
} as const;

export const gradient = {
  linkSpine:    "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
  bridgeDeck:   "linear-gradient(90deg, #1E66C9, #2E8E3A)",
  /**
   * `railBuyer` was RENAMED `lineBuyer` on 2026-08-13 when the edge-rail
   * signature was struck. It survived the strike because one real consumer
   * draws with it: the vertical connector running through a help guide's
   * numbered step badges (src/components/help/guide/Step.tsx). It is a step
   * connector, not a rail — do not use it to frame a work area.
   * `railSupplier` was deleted outright: its only consumer was the
   * `.rail.supplier` class, which went with the signature.
   */
  lineBuyer:    "linear-gradient(180deg, rgba(30,102,201,0.15), #1E66C9 50%, rgba(30,102,201,0.15))",
} as const;

export const font = {
  sans:    '"Inter", system-ui, -apple-system, sans-serif',
  display: '"Bricolage Grotesque", "Inter", system-ui, sans-serif',
  mono:    '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const size = {
  xs: 10, sm: 11.5,
  bodyS: 12.5, body: 13, bodyL: 14,
  h4: 16, h3: 18, h2: 24, h1: 32,
  displayS: 36, display: 48, displayL: 78,
} as const;

export const space = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24,
  8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96,
} as const;

export const radius = {
  sm: 4, DEFAULT: 6, md: 8, lg: 10, xl: 12, full: 9999,
} as const;

export const shadow = {
  card: "0 1px 2px rgba(11,26,47,0.04)",
  pop:  "0 8px 24px rgba(11,26,47,0.10)",
  hero: "0 50px 120px rgba(11,26,47,0.10), 0 8px 24px rgba(11,26,47,0.06)",
} as const;

export const motion = {
  easeOut:    "cubic-bezier(0.16, 1, 0.3, 1)",
  easeInOut:  "cubic-bezier(0.65, 0, 0.35, 1)",
  durationFast:    150,
  duration:        250,
  durationSlow:    400,
  durationSpine:  1200,
  durationWireLoop: 6000,
} as const;

/** `rails: 1` was STRUCK 2026-08-13 with the edge-rail signature (zero consumers). */
export const z = {
  base: 0, sticky: 10, drawer: 20,
  topbar: 30, popover: 40, modal: 50, toast: 60,
} as const;

/**
 * Confidence threshold helper — used by ConfidenceChip.
 *
 * It no longer feeds "spine-node field backgrounds" (the canonical spine was
 * DELETED 2026-08-13) or per-zone anatomy overlays (the document pane ships,
 * the per-zone confidence overlay does not — it needs backend provenance
 * first). See CLAUDE.md §2.
 */
export function confidenceTier(pct: number): "ok" | "warn" | "danger" {
  if (pct >= 90) return "ok";
  if (pct >= 75) return "warn";
  return "danger";
}

export function confidenceColors(pct: number) {
  const tier = confidenceTier(pct);
  if (tier === "ok")   return { fg: color.brand.greenDeep, bg: color.brand.greenSoft };
  if (tier === "warn") return { fg: color.amber, bg: color.amberSoft };
  return { fg: color.danger, bg: color.dangerSoft };
}
