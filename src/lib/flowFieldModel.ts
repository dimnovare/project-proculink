import type { FieldCheckOp, FlowField, FlowFieldList, ReadColumn, ReadField, ReadResult } from "@/lib/api/documents";

const toField = ({ key, label, type, meaning }: ReadField | ReadColumn): FlowField => ({ key, label, type, meaning, required: false });

/** The field list a first read suggests: every field and table column, none required. */
export const fieldListFromRead = (read: ReadResult): FlowFieldList => ({
  fields: read.fields.map(toField),
  tables: read.tables.map((t) => ({ key: t.key, label: t.label, columns: t.columns.map(toField) })),
});

/** The flow's fields plus whatever the read has that the flow lacks, appended and marked off (editor ids: `key`, `table/column`). */
export function withReadExtras(fields: FlowFieldList, read: ReadResult | undefined): { list: FlowFieldList; off: Set<string> } {
  const off = new Set<string>();
  const extra = read ? fieldListFromRead(read) : { fields: [], tables: [] };
  const list: FlowFieldList = {
    fields: [...fields.fields, ...extra.fields.filter((f) => !fields.fields.some((x) => x.key === f.key) && !fields.tables.some((x) => x.key === f.key))],
    tables: [
      ...fields.tables.map((t) => ({ ...t, columns: [...t.columns, ...(extra.tables.find((x) => x.key === t.key)?.columns ?? []).filter((c) => !t.columns.some((x) => x.key === c.key))] })),
      ...extra.tables.filter((t) => !fields.tables.some((x) => x.key === t.key) && !fields.fields.some((x) => x.key === t.key)),
    ],
  };
  for (const f of list.fields) if (!fields.fields.some((x) => x.key === f.key)) off.add(f.key);
  for (const t of list.tables) {
    const own = fields.tables.find((x) => x.key === t.key);
    if (!own) off.add(t.key);
    else for (const c of t.columns) if (!own.columns.some((x) => x.key === c.key)) off.add(`${t.key}/${c.key}`);
  }
  return { list, off };
}

/** The flow's fields plus exactly one thing the read noticed. `id` is a field key, a table key, or `table/column`. */
export function addReadExtra(fields: FlowFieldList, read: ReadResult, id: string): FlowFieldList {
  const { list, off } = withReadExtras(fields, read);
  const keep = (k: string) => !off.has(k) || k === id;
  return {
    fields: list.fields.filter((f) => keep(f.key)),
    tables: list.tables.filter((t) => keep(t.key)).map((t) => ({ ...t, columns: t.columns.filter((c) => keep(`${t.key}/${c.key}`)) })),
  };
}

/** Row `i` becomes `f`. A meaning belongs to one field (for columns, one column per table): choosing it clears it from the old holder. */
export const replaceField = (rows: FlowField[], i: number, f: FlowField) =>
  rows.map((x, j) => (j === i ? f : f.meaning && f.meaning !== rows[i].meaning && x.meaning === f.meaning ? { ...x, meaning: null } : x));

/** Field types the server accepts (`FieldTypes.All`), in words. */
export const FIELD_TYPES: Record<string, string> = {
  text: "Text", number: "Number", money: "Amount", currency: "Currency", date: "Date",
  iban: "IBAN", vat_id: "VAT number", email: "Email", code: "Code",
};

/** The checks a person can add to a single value (`FieldCheckOps`), in words. */
export const FIELD_CHECK_OPS: Record<FieldCheckOp, string> = {
  one_of: "Is one of", between: "Is a number between", in_lookup: "Is in a lookup", not_after_today: "Is a date no later than today",
};

const LIMIT = /^-?\d+(\.\d+)?$/;
const blank = (s?: string | null) => !s?.trim();

/** The same refusals as the server's `FieldChecks.Problem` for a single value, in the same words; null when fine or no check. */
export function fieldCheckProblem({ label, check }: FlowField): string | null {
  if (!check) return null;
  switch (check.op) {
    case "one_of": return (check.values ?? []).some((v) => v.trim()) ? null : `Add at least one allowed value for ${label}.`;
    case "between": {
      if (blank(check.min) && blank(check.max)) return `Add a lowest or highest number for ${label}.`;
      if ([check.min, check.max].some((v) => !blank(v) && !LIMIT.test(v!.trim()))) return `For ${label}, write the numbers with digits only, like 1000 or 12.5.`;
      return !blank(check.min) && !blank(check.max) && Number(check.min) > Number(check.max) ? `For ${label}, the lowest number is above the highest.` : null;
    }
    case "in_lookup": return check.lookupId ? null : `Choose a lookup for ${label}.`;
    default: return null;
  }
}
