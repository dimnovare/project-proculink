import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";

export type SimpleRow = { name: string; source: { field: string } | { fixed: string } };
export type SimpleOutput = { fields: SimpleRow[]; table: { key: string; columns: SimpleRow[] } | null };

// Mirrors the backend's DefaultOutputTemplate: a "document" object of bound leaves, plus at most one
// array named for its table whose single "row" object holds the column leaves.
const leaf = (n: OutputNode): SimpleRow | null => {
  const r = n.rule;
  if (n.nodeType !== "field" || !r || n.children?.length || n.namespace || n.prefix || n.includeWhen || n.valueType || n.emptyValue) return null;
  if (r.outputPath !== n.name || r.expression || r.sourceToken || r.fieldManipulators?.length) return null;
  if ((r.canonicalField != null) === (r.fixedValue != null)) return null;
  return { name: n.name, source: r.canonicalField != null ? { field: r.canonicalField } : { fixed: r.fixedValue! } };
};

const leaves = (nodes: OutputNode[]) => {
  const rows = nodes.map(leaf);
  return rows.every((r) => r !== null) ? (rows as SimpleRow[]) : null;
};

export function toSimple(t: OutputNodeTemplate): SimpleOutput | null {
  const { root } = t;
  if (t.namespaces || t.envelope || t.csvDialect || root.name !== "document" || root.nodeType !== "object") return null;
  const kids = root.children ?? [];
  const arrays = kids.filter((k) => k.nodeType === "array");
  const fields = leaves(kids.filter((k) => k.nodeType !== "array"));
  if (!fields || arrays.length > 1) return null;
  if (!arrays.length) return { fields, table: null };
  const [a] = arrays;
  const item = a.children?.length === 1 ? a.children[0] : null;
  if (a.collection !== a.name || a.rule || a.namespace || a.prefix || a.includeWhen) return null;
  if (item?.name !== "row" || item.nodeType !== "object" || item.rule) return null;
  const columns = leaves(item.children ?? []);
  return columns ? { fields, table: { key: a.name, columns } } : null;
}

const toNode = ({ name, source }: SimpleRow): OutputNode => ({
  name,
  nodeType: "field",
  children: [],
  rule: {
    outputPath: name,
    ...("field" in source ? { canonicalField: source.field } : { fixedValue: source.fixed }),
    fieldManipulators: [],
  },
});

/** `format` is the output format (csv, xlsx, json, xml); xlsx renders from the csv template, as on the server. */
export const fromSimple = (s: SimpleOutput, format: string): OutputNodeTemplate => ({
  format: format === "json" || format === "xml" ? format : "csv",
  root: {
    name: "document",
    nodeType: "object",
    children: [
      ...s.fields.map(toNode),
      ...(s.table
        ? [{
            name: s.table.key, nodeType: "array" as const, collection: s.table.key,
            children: [{ name: "row", nodeType: "object" as const, children: s.table.columns.map(toNode) }],
          }]
        : []),
    ],
  },
});
