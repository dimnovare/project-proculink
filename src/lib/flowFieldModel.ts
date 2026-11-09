import type { FlowField, FlowFieldList, ReadColumn, ReadField, ReadResult } from "@/lib/api/documents";

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

/** Field types the server accepts (`FieldTypes.All`), in words. */
export const FIELD_TYPES: Record<string, string> = {
  text: "Text", number: "Number", money: "Amount", currency: "Currency", date: "Date",
  iban: "IBAN", vat_id: "VAT number", email: "Email", code: "Code",
};
