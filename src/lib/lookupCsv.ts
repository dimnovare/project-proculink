import type { LookupCandidate, LookupEntry } from "@/lib/api/documents";
import { detectDelimiter, parseCsvRows, parseXlsxWorkbook } from "@/lib/sheetPreview";

import { LOOKUP_LIMITS } from "./lookupLimits";

export { LOOKUP_LIMITS };

const key = (from: string) => from.trim().toLowerCase();
// A leading = + - @ tab or CR makes a spreadsheet read the cell as a formula: export prefixes one "'"
// (also before quotes already there, so "'=x" survives), import strips exactly one.
const FORMULA = /^'*[=+@\t\r-]/;
const unprefix = (v: string) => (v[0] === "'" && FORMULA.test(v.slice(1)) ? v.slice(1) : v);

/** CSV text to cells: byte-order mark dropped, delimiter detected, no row cap. */
export function csvCells(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parseCsvRows(body, detectDelimiter(body), Infinity);
}

const readRows = (text: string, firstRowIsHeadings: boolean) => csvCells(text).slice(firstRowIsHeadings ? 1 : 0);

/** Row 1 is headings and is skipped. Column 1 is From, column 2 is To, both trimmed and with one formula
 *  guard quote removed. A row with no From is skipped. A later row whose From matches an earlier one
 *  (spaces at the ends and capital letters ignored) replaces it in place. */
export function lookupEntries(cells: string[][]): LookupEntry[] {
  const entries: LookupEntry[] = [];
  const at = new Map<string, number>();
  for (const [from = "", to = ""] of cells.slice(1)) {
    if (!from.trim()) continue;
    const entry = { from: unprefix(from.trim()), to: unprefix(to.trim()) };
    const i = at.get(key(entry.from));
    if (i === undefined) at.set(key(entry.from), entries.push(entry) - 1);
    else entries[i] = entry;
  }
  return entries;
}

/** A zip header (bytes 50 4B 03 04) is read as a workbook, first sheet, capped at LOOKUP_LIMITS.rows + 2 rows;
 *  anything else as UTF-8 text. `cut` is true when the sheet had more rows than that. Throws when a
 *  workbook cannot be read. */
export async function readTableFile(file: File): Promise<{ cells: string[][]; cut: boolean }> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const sheet = parseXlsxWorkbook(bytes, LOOKUP_LIMITS.rows + 2).tables[0];
    return { cells: sheet?.rows ?? [], cut: sheet?.truncatedRows ?? false };
  }
  return { cells: csvCells(new TextDecoder("utf-8").decode(bytes)), cut: false };
}

/** A file we read and will not use, with the reason in words. */
export class TableFileRefusal extends Error {}

/** A file's rows for a lookup; throws a `TableFileRefusal` when it is unreadable, too long or has no rows. */
export async function lookupFileEntries(file: File): Promise<LookupEntry[]> {
  const table = await readTableFile(file).catch(() => {
    throw new TableFileRefusal("We can read CSV files and Excel .xlsx files.");
  });
  const entries = lookupEntries(table.cells);
  if (table.cut || entries.length > LOOKUP_LIMITS.rows)
    throw new TableFileRefusal("It has more than 20,000 rows, and a lookup holds at most 20,000.");
  if (!entries.length) throw new TableFileRefusal("It has no rows with a value in the first column.");
  return entries;
}

/** The file name without its last extension, trimmed and cut to 120 characters; "Imported table" when empty. */
export const tableName = (fileName: string) =>
  fileName.replace(/\.[^.]*$/, "").trim().slice(0, LOOKUP_LIMITS.nameLength) || "Imported table";

/** Column 1 is the value; the other non-empty cells, joined, describe it. A later row with the same value replaces the earlier one in place. */
export function importCandidateCsv(text: string, firstRowIsHeadings: boolean): LookupCandidate[] {
  const out: LookupCandidate[] = [];
  const at = new Map<string, number>();
  for (const [first = "", ...rest] of readRows(text, firstRowIsHeadings)) {
    if (!first.trim()) continue;
    const description = rest.map((c) => unprefix(c.trim())).filter(Boolean).join(" · ").slice(0, 500) || null;
    const candidate = { value: unprefix(first.trim()), description };
    const i = at.get(key(candidate.value));
    if (i === undefined) at.set(key(candidate.value), out.push(candidate) - 1);
    else out[i] = candidate;
  }
  return out;
}

// Quote anything the importer's delimiter detection could mistake for a separator, too.
const cell = (raw: string) => {
  const v = FORMULA.test(raw) ? `'${raw}` : raw;
  return /[",;|\t\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export const exportLookupCsv = (entries: LookupEntry[]) =>
  ["From,To", ...entries.map((e) => `${cell(e.from)},${cell(e.to)}`)].join("\n") + "\n";
