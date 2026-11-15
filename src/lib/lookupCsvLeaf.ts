import type { LookupEntry } from "@/lib/api/documents";

// The parts of lookupCsv.ts the Lookups screens need at first load. A leaf module: it does not import the
// spreadsheet reader, which lookupCsv.ts brings in and the screens load only when a file is chosen.

/** A file we read and will not use, with the reason in words. */
export class TableFileRefusal extends Error {}

// A leading = + - @ tab or CR makes a spreadsheet read the cell as a formula: export prefixes one "'"
// (also before quotes already there, so "'=x" survives), import strips exactly one.
export const FORMULA = /^'*[=+@\t\r-]/;

// Quote anything the importer's delimiter detection could mistake for a separator, too.
const cell = (raw: string) => {
  const v = FORMULA.test(raw) ? `'${raw}` : raw;
  return /[",;|\t\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export const exportLookupCsv = (entries: LookupEntry[]) =>
  ["From,To", ...entries.map((e) => `${cell(e.from)},${cell(e.to)}`)].join("\n") + "\n";
