import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import type { FlowFieldList, SendWhen } from "@/lib/api/documents";

export type SimpleRow = {
  name: string;
  source: { field: string } | { fixed: string };
  lookup?: { id: string; ifMissing: "keep" | "blank" };
};
export type SimpleOutput = { fields: SimpleRow[]; table: { key: string; columns: SimpleRow[] } | null };

// Mirrors the backend's DefaultOutputTemplate: a "document" object of bound leaves, plus at most one
// array named for its table whose single "row" object holds the column leaves.
const leaf = (n: OutputNode): SimpleRow | null => {
  const r = n.rule;
  if (n.nodeType !== "field" || n.children?.length || n.namespace || n.prefix || n.includeWhen || n.valueType || n.emptyValue) return null;
  // A disconnected field (Advanced view) has no rule; the backend emits it as an empty fixed value.
  if (!r) return { name: n.name, source: { fixed: "" } };
  if (r.outputPath !== n.name || r.expression || r.sourceToken) return null;
  const steps = r.fieldManipulators ?? [];
  const [step] = steps;
  const ifMissing = step?.params?.[1];
  if (steps.length > 1 || (step && (step.type !== "Lookup" || !step.params?.[0] || (ifMissing !== "keep" && ifMissing !== "blank")))) return null;
  if ((r.canonicalField != null) === (r.fixedValue != null)) return null;
  const source = r.canonicalField != null ? { field: r.canonicalField } : { fixed: r.fixedValue! };
  return { name: n.name, source, ...(step ? { lookup: { id: step.params![0], ifMissing: ifMissing as "keep" | "blank" } } : {}) };
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

const toNode = ({ name, source, lookup }: SimpleRow): OutputNode => ({
  name,
  nodeType: "field",
  children: [],
  rule: {
    outputPath: name,
    ...("field" in source ? { canonicalField: source.field } : { fixedValue: source.fixed }),
    fieldManipulators: lookup ? [{ type: "Lookup", params: [lookup.id, lookup.ifMissing] }] : [],
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

export const OP_LABEL = { is: "is", is_not: "is not", contains: "contains" } as const;

export function describeSendWhen(sendWhen: SendWhen | null, fields?: FlowFieldList): string | null {
  if (!sendWhen) return null;
  const label = fields?.fields.find((f) => f.key === sendWhen.field)?.label ?? sendWhen.field;
  return `Only when ${label} ${OP_LABEL[sendWhen.op] ?? sendWhen.op} “${sendWhen.value}”`;
}
