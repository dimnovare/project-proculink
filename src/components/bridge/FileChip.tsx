// FileChip — file-format colored tag.
// Colors match tokens.css .src-* exactly (lines ~347-355).
// Keep in sync with DSPrimitives.tsx SRC_PALETTE.

type FileFormat = "PDF" | "XLSX" | "CSV" | "XML" | "cXML" | "EDI" | "JSON" | "EMAIL" | "API" | "UBL" | string;

// Canonical palette from tokens.css .src-*
const CHIP_COLORS: Record<string, { bg: string; color: string }> = {
  PDF:   { bg: "#FBEEEE", color: "#B53F3F" },        // .src-PDF
  XLSX:  { bg: "#E2F1E2", color: "#1E6D29" },         // .src-XLSX  (brand-green-soft / brand-green-deep)
  CSV:   { bg: "#EEF3F8", color: "#345470" },          // .src-CSV
  XML:   { bg: "#EEE7FB", color: "#5E3DB0" },          // .src-XML   (ai-soft / #5E3DB0)
  cXML:  { bg: "#EEE7FB", color: "#5E3DB0" },          // .src-cXML
  EDI:   { bg: "#FAEFD6", color: "#C97A14" },          // .src-EDI   (amber-soft / amber)
  EMAIL: { bg: "#E9EDF3", color: "#4A5568" },          // .src-EMAIL
  API:   { bg: "#E3F0E3", color: "#1E6D29" },          // .src-API   (brand-green-deep)
  JSON:  { bg: "#FFF4D6", color: "#846100" },          // .src-JSON
  UBL:   { bg: "#EEF3F8", color: "#345470" },          // .src-UBL
};

interface FileChipProps {
  type: FileFormat;
  className?: string;
}

export function FileChip({ type, className }: FileChipProps) {
  const colors = CHIP_COLORS[type] ?? { bg: "#EEF3F8", color: "#345470" };
  return (
    <span
      className={`inline-flex items-center rounded text-[10px] font-bold uppercase tracking-[0.05em] px-1.5 py-0.5 ${className ?? ""}`}
      style={{ background: colors.bg, color: colors.color }}
    >
      {type}
    </span>
  );
}
