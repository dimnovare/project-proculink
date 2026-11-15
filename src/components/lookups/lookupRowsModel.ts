import type { LookupEntry } from "@/lib/api/documents";

/** `key` is stable for the visit, so an edit on a filtered or later page reaches the right row. */
export type LookupRow = { key: number; from: string; to: string };
export const ROWS_PER_PAGE = 50;

export const toRows = (entries: LookupEntry[]): LookupRow[] => entries.map((e, key) => ({ key, from: e.from, to: e.to }));

/** What a save sends, and the sentence for each row held back (R2). Rows with neither value are left out silently. */
export function savable(rows: LookupRow[]): { entries: LookupEntry[]; held: Map<number, string> } {
  const entries: LookupEntry[] = [];
  const held = new Map<number, string>();
  const seen = new Set<string>();
  for (const r of rows) {
    const from = r.from.trim();
    if (!from && !r.to.trim()) continue;
    if (!from) held.set(r.key, "Add the value on the document to save this row.");
    else if (seen.has(from.toLowerCase())) held.set(r.key, `Not saved: ${from} is already in this lookup.`);
    else {
      seen.add(from.toLowerCase());
      entries.push({ from: r.from, to: r.to });
    }
  }
  return { entries, held };
}

/** Rows whose From or To contains the term (capital letters ignored), and the page of them; the page is clamped. */
export function rowsPage(rows: LookupRow[], term: string, page: number) {
  const t = term.trim().toLowerCase();
  const found = t ? rows.filter((r) => r.from.toLowerCase().includes(t) || r.to.toLowerCase().includes(t)) : rows;
  const pages = Math.max(1, Math.ceil(found.length / ROWS_PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  return { shown: found.slice((p - 1) * ROWS_PER_PAGE, p * ROWS_PER_PAGE), total: found.length, page: p, pages };
}

/** "Rows 1 to 50 of 248", or "Rows 1 to 12 of 12 that match" while searching. */
export function rowsLine(page: number, shown: number, total: number, searching: boolean): string {
  const first = (page - 1) * ROWS_PER_PAGE + 1;
  return `Rows ${first} to ${first + shown - 1} of ${total}${searching ? " that match" : ""}`;
}
