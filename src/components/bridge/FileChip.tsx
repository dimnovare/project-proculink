// FileChip — THE file-format tag. One implementation, one palette.
//
// There used to be four: this file's CHIP_COLORS, `SrcChip`/`SRC_PALETTE` in
// DSPrimitives.tsx (exported but never imported — dead), a second local `SrcChip`
// inside SupplierDockProfile.tsx driving `.src-chip .src-*` CSS classes, and a
// hand-written pill array on the /how-it-works marketing page. Three of the four
// carried their own copy of the colours and they had already diverged on
// contrast: SrcChip drew XLSX and API at #2E8E3A on #E9F1EA (3.61:1) and EDI at
// #B36D14 on #FAF1DD (3.65:1), and this file drew the same EDI failure — all
// below the 4.5:1 AA floor for the ~10px text these chips are.
//
// The palette below is the AA-clean set the `.src-*` CSS layer already used.
// Every pair is >= 4.95:1; the ratios are pinned by FileChip.test.tsx, which does
// the WCAG maths itself so a regression fails rather than merely looking wrong.
//
// The visual spec matches the `.src-chip` CSS this component replaced (mono /
// 10.5px / 600 / uppercase / 0.02em), so the call sites that used the CSS class
// render unchanged.

type FileFormat =
  | "PDF" | "XLSX" | "CSV" | "XML" | "cXML" | "EDI" | "JSON" | "EMAIL" | "API" | "UBL"
  | string;

/**
 * format → { bg, color }. Exported because the marketing pipeline page renders
 * the same formats as larger pills: it reads this map instead of keeping a fifth
 * copy of the colours.
 *
 * Contrast, computed (WCAG 2.1), against the chip's own background:
 *   PDF 4.95 · XLSX 5.57 · CSV 7.10 · XML/cXML 6.45 · EDI 5.62
 *   EMAIL 6.40 · API 5.45 · JSON 5.19 · UBL 7.10
 */
export const FORMAT_CHIP_COLORS: Record<string, { bg: string; color: string }> = {
  PDF:   { bg: "#FBEEEE", color: "#B53F3F" },   // .src-PDF
  XLSX:  { bg: "#E9F1EA", color: "#1E6D29" },   // --brand-green-soft / --brand-green-deep
  CSV:   { bg: "#EEF3F8", color: "#345470" },   // .src-CSV
  XML:   { bg: "#F0EAFB", color: "#5E3DB0" },   // --ai-soft
  cXML:  { bg: "#F0EAFB", color: "#5E3DB0" },
  // --amber-soft / --amber-text. The old #B36D14 here was 3.65:1 — an AA failure.
  EDI:   { bg: "#FAF1DD", color: "#8A5310" },
  EMAIL: { bg: "#E9EDF3", color: "#4A5568" },
  API:   { bg: "#E3F0E3", color: "#1E6D29" },   // --brand-green-deep
  JSON:  { bg: "#FFF4D6", color: "#846100" },
  UBL:   { bg: "#EEF3F8", color: "#345470" },
};

/** Neutral tone for a format with no entry of its own (X12, IDOC, …). */
export const FORMAT_CHIP_FALLBACK = FORMAT_CHIP_COLORS.CSV;

/**
 * Case-insensitive lookup. Call sites spell the same format three ways —
 * "cXML" from the canonical order, "CXML" from marketing copy, "xlsx" from a
 * file extension — and an exact-key lookup silently dropped them to the
 * fallback tone.
 */
export function formatChipColors(type: string): { bg: string; color: string } {
  const exact = FORMAT_CHIP_COLORS[type];
  if (exact) return exact;
  const key = Object.keys(FORMAT_CHIP_COLORS).find(
    (k) => k.toLowerCase() === type.toLowerCase(),
  );
  return key ? FORMAT_CHIP_COLORS[key] : FORMAT_CHIP_FALLBACK;
}

interface FileChipProps {
  type: FileFormat;
  className?: string;
}

export function FileChip({ type, className }: FileChipProps) {
  const colors = formatChipColors(type);
  return (
    <span
      className={`inline-flex items-center rounded-sm font-mono text-[10.5px] font-semibold uppercase tracking-[0.02em] px-1.5 py-px ${className ?? ""}`}
      style={{ background: colors.bg, color: colors.color }}
    >
      {type}
    </span>
  );
}
