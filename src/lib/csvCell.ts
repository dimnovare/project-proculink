/**
 * One CSV cell, quoted. A value starting with a spreadsheet formula trigger
 * (`= + - @`, tab, CR) gets a leading `'` so Excel/Sheets read it as text — filenames
 * and PO numbers come from outside, and a cell like `=HYPERLINK(...)` would otherwise run.
 */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
