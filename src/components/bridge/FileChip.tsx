// FileChip — file-format colored tag.
// Colors match the prototype: PDF red / XLSX green / cXML violet /
// EDI amber / CSV slate / EMAIL grey / API green / JSON gold

type FileFormat = "PDF" | "XLSX" | "CSV" | "XML" | "cXML" | "EDI" | "JSON" | "EMAIL" | "API" | string;

const CHIP_COLORS: Record<string, { bg: string; color: string }> = {
  PDF:   { bg: "#FBE3E3", color: "#C53A3A" },
  XLSX:  { bg: "#E2F1E2", color: "#1E6D29" },
  CSV:   { bg: "#EFF2F7", color: "#56627A" },
  XML:   { bg: "#EEE7FB", color: "#6F4FCE" },
  cXML:  { bg: "#EEE7FB", color: "#6F4FCE" },
  EDI:   { bg: "#FAEFD6", color: "#C97A14" },
  JSON:  { bg: "#FFF4D6", color: "#A06200" },
  EMAIL: { bg: "#F0F0F0", color: "#56627A" },
  API:   { bg: "#E2F1E2", color: "#1E6D29" },
};

interface FileChipProps {
  type: FileFormat;
  className?: string;
}

export function FileChip({ type, className }: FileChipProps) {
  const colors = CHIP_COLORS[type] ?? { bg: "#EFF2F7", color: "#56627A" };
  return (
    <span
      className={`inline-flex items-center rounded text-[10px] font-bold uppercase tracking-[0.05em] px-1.5 py-0.5 ${className ?? ""}`}
      style={{ background: colors.bg, color: colors.color }}
    >
      {type}
    </span>
  );
}
