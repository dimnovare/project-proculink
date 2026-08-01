/**
 * FileChip — one format chip, one palette, and every pair provably AA.
 *
 * The four implementations that preceded it each carried their own copy of the
 * colours and had already diverged on contrast: SrcChip drew XLSX and API at
 * 3.61:1 and EDI at 3.65:1, FileChip drew the same EDI failure, and the
 * marketing pipeline page drew XLSX and CSV at 3.55:1 — all under the 4.5:1 AA
 * floor for the ~10px text these chips are.
 *
 * The contrast test computes the WCAG 2.1 ratio here rather than asserting hex
 * values, so it fails on ANY future palette edit that regresses legibility, not
 * only on the ones somebody remembered to re-check.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FileChip,
  FORMAT_CHIP_COLORS,
  FORMAT_CHIP_FALLBACK,
  formatChipColors,
} from "./FileChip";

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast — the chip is 10.5px text, so the floor is 4.5:1", () => {
  it.each(Object.entries(FORMAT_CHIP_COLORS))(
    "%s passes WCAG AA for normal text",
    (format, { bg, color }) => {
      const ratio = contrast(color, bg);
      expect(
        ratio,
        `${format}: ${color} on ${bg} is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("the fallback tone passes too", () => {
    expect(
      contrast(FORMAT_CHIP_FALLBACK.color, FORMAT_CHIP_FALLBACK.bg),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the specific pairs that used to fail", () => {
    // Each of these was a measured AA failure in one of the four old copies.
    expect(contrast(FORMAT_CHIP_COLORS.XLSX.color, FORMAT_CHIP_COLORS.XLSX.bg))
      .toBeGreaterThanOrEqual(4.5); // was 3.61:1 in SrcChip, 3.55:1 on /how-it-works
    expect(contrast(FORMAT_CHIP_COLORS.API.color, FORMAT_CHIP_COLORS.API.bg))
      .toBeGreaterThanOrEqual(4.5); // was 3.61:1 in SrcChip
    expect(contrast(FORMAT_CHIP_COLORS.EDI.color, FORMAT_CHIP_COLORS.EDI.bg))
      .toBeGreaterThanOrEqual(4.5); // was 3.65:1 in SrcChip AND in FileChip
  });
});

describe("formatChipColors", () => {
  it("matches a format regardless of case", () => {
    expect(formatChipColors("cXML")).toEqual(FORMAT_CHIP_COLORS.cXML);
    expect(formatChipColors("CXML")).toEqual(FORMAT_CHIP_COLORS.cXML);
    expect(formatChipColors("xlsx")).toEqual(FORMAT_CHIP_COLORS.XLSX);
  });

  it("falls back for a format with no entry", () => {
    expect(formatChipColors("IDOC")).toEqual(FORMAT_CHIP_FALLBACK);
  });
});

describe("<FileChip>", () => {
  it("renders the format label", () => {
    render(<FileChip type="cXML" />);
    expect(screen.getByText("cXML")).toBeInTheDocument();
  });

  it("applies the format's palette entry", () => {
    render(<FileChip type="EDI" />);
    expect(screen.getByText("EDI")).toHaveStyle({
      color: FORMAT_CHIP_COLORS.EDI.color,
      background: FORMAT_CHIP_COLORS.EDI.bg,
    });
  });
});
