import type { DocumentDetail, Flow } from "@/lib/api/documents";
import { editKey } from "@/lib/reviewMarks";

// An optional currency symbol or upper-case ISO code on either side of the digits, as the backend's NumberShape.
const SHAPE = /^(?:[A-Z]{3}|[€$£])?(-?[\d.,]+)(?:[A-Z]{3}|[€$£])?$/;

/**
 * The backend's `FieldValueParser.Number`, rule for rule: the one reading of a number, or null when the text has
 * none or has two. The right-most separator is the decimal one; a separator that repeats can only be a thousands
 * mark; a lone separator followed by exactly three digits ("1,500", "1.500") is either, so it is not read.
 */
export function numberOf(text: string | null | undefined): number | null {
  const body = SHAPE.exec((text ?? "").replace(/\s/g, ""))?.[1];
  if (!body || !/\d/.test(body) || /^-?\d{1,3}[.,]\d{3}$/.test(body)) return null;
  let at = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
  if (at >= 0 && body.split(body[at]).length > 2) at = -1;
  const plain = (s: string) => s.replace(/[.,]/g, "");
  const n = Number(at < 0 ? plain(body) : `${plain(body.slice(0, at))}.${body.slice(at + 1)}`);
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
  /** The sum, with the currency's decimals. */
  sum: string;
  /** It equals the net total, within one of the currency's smallest unit. */
  same: boolean;
  /** The net total's label and value. */
  label: string;
  value: string;
}

/** ISO 4217 minor units, as the backend's `DecimalPlaces`; absent or unknown means 2. */
const DECIMALS: Record<string, number> = { JPY: 0, KRW: 0, CLP: 0, ISK: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3 };

/**
 * The backend's "The lines don't add up to the net total." check (`DocumentChecks.Arithmetic`), on what is on screen:
 * the line amounts added up beside the NET total, never the gross one. Meanings are the flow's once it lists fields
 * (`FieldMeanings.Of`), the read's own before that. Says nothing when the flow is not known yet, when there is no
 * net total or amount column, or when a number has no single reading. What is being typed counts.
 */
export function rowsSum(read: DocumentDetail["read"], flow: Pick<Flow, "fields"> | undefined, drafts: Readonly<Record<string, string>>): RowsSum | null {
  if (!flow) return null;
  const listed = flow.fields?.fields ?? [];
  const listedTables = flow.fields?.tables ?? [];
  const meaning = (f: { key: string; meaning: string | null }) => (listed.length === 0 ? f.meaning : listed.find((x) => x.key === f.key)?.meaning ?? null);
  const amountColumn = (t: DocumentDetail["read"]["tables"][number]) =>
    t.columns.find((c) => (listedTables.length === 0 ? c.meaning : listedTables.find((x) => x.key === t.key)?.columns.find((x) => x.key === c.key)?.meaning) === "line_amount");
  const now = (f: { key: string; value: string | null } | undefined) => (f ? drafts[editKey({ field: f.key })] ?? f.value : null);
  const find = (m: string) => read.fields.find((f) => meaning(f) === m);

  const netField = find("total_net");
  const net = numberOf(now(netField));
  const table = read.tables.find(amountColumn);
  if (!netField || net === null || !table || table.rows.length === 0) return null;
  const column = amountColumn(table)!;
  const scale = 10 ** (DECIMALS[(now(find("currency")) ?? "").trim().toUpperCase()] ?? 2);
  // Whole smallest units, rounded away from zero as the backend rounds, so sums never drift.
  const units = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * scale + 1e-7);
  let sum = 0;
  for (let r = 0; r < table.rows.length; r++) {
    const amount = numberOf(drafts[editKey({ table: table.key, row: r, column: column.key })] ?? table.rows[r].cells[column.key]?.value);
    if (amount === null) return null;
    sum += units(amount);
  }
  const show = (u: number) => (u / scale).toFixed(Math.log10(scale));
  return { table: table.key, sum: show(sum), same: Math.abs(sum - units(net)) <= 1, label: netField.label, value: show(units(net)) };
}
