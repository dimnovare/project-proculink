import type { LookupCandidate, LookupEntry } from "@/lib/api/documents";
import { detectDelimiter, parseCsvRows } from "@/lib/sheetPreview";

const key = (from: string) => from.trim().toLowerCase();
// A leading = + - @ tab or CR makes a spreadsheet read the cell as a formula: export prefixes one "'"
// (also before quotes already there, so "'=x" survives), import strips exactly one.
const FORMULA = /^'*[=+@\t\r-]/;
const unprefix = (v: string) => (v[0] === "'" && FORMULA.test(v.slice(1)) ? v.slice(1) : v);

const readRows = (text: string, firstRowIsHeadings: boolean) => {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parseCsvRows(body, detectDelimiter(body), Infinity).slice(firstRowIsHeadings ? 1 : 0);
};

/** Columns 1 and 2 are From and To. A later row with the same From replaces the earlier entry in place. */
export function importLookupCsv(text: string, existing: LookupEntry[], firstRowIsHeadings: boolean) {
  const entries = existing.map((e) => ({ ...e }));
  const at = new Map(entries.map((e, i) => [key(e.from), i]));
  let added = 0;
  let changed = 0;
  const rows = readRows(text, firstRowIsHeadings);
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

/** Column 1 is the value; the other non-empty cells, joined, describe it. A later row with the same value replaces the earlier one in place. */
export function importCandidateCsv(text: string, firstRowIsHeadings: boolean): LookupCandidate[] {
  const out: LookupCandidate[] = [];
  const at = new Map<string, number>();
  for (const [first = "", ...rest] of readRows(text, firstRowIsHeadings)) {
    if (!first.trim()) continue;
    const description = rest.map((c) => unprefix(c.trim())).filter(Boolean).join(" · ") || null;
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
