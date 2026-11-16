import type { DocumentDetail } from "@/lib/api/documents";
import { editKey } from "@/lib/reviewMarks";

/** "1 303,40", "1,303.40" and "1303.4" are all 1303.4; null when the text is not one number. */
export function parseAmount(text: string | null | undefined): number | null {
  const s = (text ?? "").replace(/[\s']/g, "");
  if (!/^[-+]?\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  // The last separator is the decimal one, unless it is a lone comma followed by exactly three digits (a thousands comma).
  const decimal = comma > dot ? (dot === -1 && s.indexOf(",") === comma && s.length - comma === 4 ? -1 : comma) : dot;
  const whole = (decimal === -1 ? s : s.slice(0, decimal)).replace(/[.,]/g, "");
  const n = Number(decimal === -1 ? whole : `${whole}.${s.slice(decimal + 1)}`);
  return Number.isFinite(n) ? n : null;
}

/** Cells copied from a spreadsheet: rows by line, cells by tab. null when it is one plain value. */
export function pasteGrid(text: string): string[][] | null {
  const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
  if (lines.length === 1 && !lines[0].includes("\t")) return null;
  return lines.map((l) => l.split("\t"));
}

export interface RowsSum {
  /** The table whose amounts were added. */
  table: string;
  /** The sum, with two decimals. */
  sum: string;
  /** The label of the total it equals; null when it equals none. */
  same: string | null;
  /** The first total it does not equal, when it equals none. */
  other: { label: string; value: string } | null;
}

const TOTALS = ["total_net", "total_gross"];

/**
 * The line amounts added up, beside the document's totals. Only said when the read knows which column holds
 * the amounts and which value is a total (their meanings), and every amount is a number. What is being typed counts.
 */
export function rowsSum(read: DocumentDetail["read"], drafts: Readonly<Record<string, string>>): RowsSum | null {
  for (const t of read.tables) {
    const column = t.columns.find((c) => c.meaning === "line_amount");
    if (!column || t.rows.length === 0) continue;
    const amounts = t.rows.map((row, r) => parseAmount(drafts[editKey({ table: t.key, row: r, column: column.key })] ?? row.cells[column.key]?.value));
    if (amounts.some((a) => a === null)) return null;
    const sum = (amounts as number[]).reduce((a, b) => a + b, 0);
    const totals = read.fields.flatMap((f) => {
      const value = parseAmount(drafts[editKey({ field: f.key })] ?? f.value);
      return f.meaning && TOTALS.includes(f.meaning) && value !== null ? [{ label: f.label, value }] : [];
    });
    if (totals.length === 0) return null;
    const same = totals.find((x) => Math.abs(x.value - sum) < 0.005);
    return { table: t.key, sum: sum.toFixed(2), same: same?.label ?? null, other: same ? null : { label: totals[0].label, value: totals[0].value.toFixed(2) } };
  }
  return null;
}
