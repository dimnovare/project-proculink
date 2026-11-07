import type { LookupEntry } from "@/lib/api/documents";
import { parseCsvTable } from "@/lib/sheetPreview";

const key = (from: string) => from.trim().toLowerCase();

/** Columns 1 and 2 are From and To. A later row with the same From replaces the earlier entry in place. */
export function importLookupCsv(text: string, existing: LookupEntry[], firstRowIsHeadings: boolean) {
  const entries = existing.map((e) => ({ ...e }));
  const at = new Map(entries.map((e, i) => [key(e.from), i]));
  let added = 0;
  let changed = 0;
  for (const [from = "", to = ""] of parseCsvTable(text).rows.slice(firstRowIsHeadings ? 1 : 0)) {
    if (!from.trim()) continue;
    const entry = { from: from.trim(), to: to.trim() };
    const i = at.get(key(from));
    if (i === undefined) {
      at.set(key(from), entries.push(entry) - 1);
      added++;
    } else {
      entries[i] = entry;
      changed++;
    }
  }
  return { entries, added, changed };
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const exportLookupCsv = (entries: LookupEntry[]) =>
  ["From,To", ...entries.map((e) => `${cell(e.from)},${cell(e.to)}`)].join("\n") + "\n";
