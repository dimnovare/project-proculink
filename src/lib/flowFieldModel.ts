import type { FlowField, FlowFieldList, ReadColumn, ReadField, ReadResult } from "@/lib/api/documents";

const toField = ({ key, label, type, meaning }: ReadField | ReadColumn): FlowField => ({ key, label, type, meaning, required: false });

/** The field list a first read suggests: every field and table column, none required. */
export const fieldListFromRead = (read: ReadResult): FlowFieldList => ({
  fields: read.fields.map(toField),
  tables: read.tables.map((t) => ({ key: t.key, label: t.label, columns: t.columns.map(toField) })),
});

/** Field types the server accepts (`FieldTypes.All`), in words. */
export const FIELD_TYPES: Record<string, string> = {
  text: "Text", number: "Number", money: "Amount", currency: "Currency", date: "Date",
  iban: "IBAN", vat_id: "VAT number", email: "Email", code: "Code",
};
