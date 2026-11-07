import type { LookupEntry } from "@/lib/api/documents";
import { detectDelimiter, parseCsvRows } from "@/lib/sheetPreview";

const key = (from: string) => from.trim().toLowerCase();
// A leading one of these makes a spreadsheet read the cell as a formula: export prefixes "'", import strips it.
const FORMULA = "=+-@\t\r";
const unprefix = (v: string) => (v[0] === "'" && v.length > 1 && FORMULA.includes(v[1]) ? v.slice(1) : v);

/** Columns 1 and 2 are From and To. A later row with the same From replaces the earlier entry in place. */
export function importLookupCsv(text: string, existing: LookupEntry[], firstRowIsHeadings: boolean) {
  const entries = existing.map((e) => ({ ...e }));
  const at = new Map(entries.map((e, i) => [key(e.from), i]));
  let added = 0;
  let changed = 0;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseCsvRows(body, detectDelimiter(body), Infinity).slice(firstRowIsHeadings ? 1 : 0);
  for (const [from = "", to = ""] of rows) {
    if (!from.trim()) continue;
    const entry = { from: unprefix(from.trim()), to: unprefix(to.trim()) };
    const i = at.get(key(entry.from));
    if (i === undefined) {
      at.set(key(entry.from), entries.push(entry) - 1);
      added++;
    } else {
      entries[i] = entry;
      changed++;
    }
  }
  return { entries, added, changed };
}

// Quote anything the importer's delimiter detection could mistake for a separator, too.
const cell = (raw: string) => {
  const v = /^'?[=+@\t\r-]/.test(raw) ? `'${raw}` : raw;
  return /[",;|\t\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export const exportLookupCsv = (entries: LookupEntry[]) =>
  ["From,To", ...entries.map((e) => `${cell(e.from)},${cell(e.to)}`)].join("\n") + "\n";
