import type { OutputFieldRule, OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import type { FlowFieldList, SendWhen } from "@/lib/api/documents";

export type SimpleRow = {
  name: string;
  source: { field: string } | { fixed: string };
  lookup?: { id: string; ifMissing: "keep" | "blank" };
  width?: number;
};
export type SimpleOutput = { fields: SimpleRow[]; table: { key: string; columns: SimpleRow[] } | null; delimiter?: string };

/** Same rule as the backend's DefaultOutputTemplate: the name's length, from 40 to 1000. */
export const defaultWidth = (name: string) => Math.min(Math.max(name.length, 40), 1000);

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
  return { name: n.name, source, ...(r.width ? { width: r.width } : {}), ...(step ? { lookup: { id: step.params![0], ifMissing: ifMissing as "keep" | "blank" } } : {}) };
};

const leaves = (nodes: OutputNode[]) => {
  const rows = nodes.map(leaf);
  return rows.every((r) => r !== null) ? (rows as SimpleRow[]) : null;
};

export function toSimple(t: OutputNodeTemplate): SimpleOutput | null {
  const { root } = t;
  const { delimiter, ...otherDialect } = t.csvDialect ?? {};
  if (t.namespaces || t.envelope || Object.values(otherDialect).some((v) => v != null) || root.name !== "document" || root.nodeType !== "object") return null;
  const kids = root.children ?? [];
  const arrays = kids.filter((k) => k.nodeType === "array");
  const fields = leaves(kids.filter((k) => k.nodeType !== "array"));
  if (!fields || arrays.length > 1) return null;
  const dialect = delimiter ? { delimiter } : {};
  if (!arrays.length) return { fields, table: null, ...dialect };
  const [a] = arrays;
  const item = a.children?.length === 1 ? a.children[0] : null;
  if (a.collection !== a.name || a.rule || a.namespace || a.prefix || a.includeWhen) return null;
  if (item?.name !== "row" || item.nodeType !== "object" || item.rule) return null;
  const columns = leaves(item.children ?? []);
  return columns ? { fields, table: { key: a.name, columns }, ...dialect } : null;
}

const toNode = (fixed: boolean) => ({ name, source, lookup, width }: SimpleRow): OutputNode => ({
  name,
  nodeType: "field",
  children: [],
  rule: {
    outputPath: name,
    ...("field" in source ? { canonicalField: source.field } : { fixedValue: source.fixed }),
    ...(fixed && width ? { width } : {}),
    fieldManipulators: lookup ? [{ type: "Lookup", params: [lookup.id, lookup.ifMissing] }] : [],
  },
});

/** `format` is the output format; everything but json and xml renders from the csv template, as on the server. */
export const fromSimple = (s: SimpleOutput, format: string): OutputNodeTemplate => ({
  format: format === "json" || format === "xml" ? format : "csv",
  ...(format === "csv" && s.delimiter && s.delimiter !== "," ? { csvDialect: { delimiter: s.delimiter } } : {}),
  root: {
    name: "document",
    nodeType: "object",
    children: [
      ...s.fields.map(toNode(format === "fixed")),
      ...(s.table
        ? [{
            name: s.table.key, nodeType: "array" as const, collection: s.table.key,
            children: [{ name: "row", nodeType: "object" as const, children: s.table.columns.map(toNode(format === "fixed")) }],
          }]
        : []),
    ],
  },
});

/** Same rule as the backend's OutputLeafPaths: field and attribute nodes depth-first, the path is the names below the root joined by "/". */
export function leafPaths(t: OutputNodeTemplate): { path: string; node: OutputNode; inTable: boolean }[] {
  const out: { path: string; node: OutputNode; inTable: boolean }[] = [];
  const walk = (parent: OutputNode, prefix: string, inTable: boolean) => {
    for (const c of parent.children ?? []) {
      const path = prefix ? `${prefix}/${c.name}` : c.name;
      if (c.nodeType === "field" || c.nodeType === "attribute") out.push({ path, node: c, inTable });
      else walk(c, path, inTable || c.nodeType === "array");
    }
  };
  walk(t.root, "", t.root.nodeType === "array");
  return out;
}

/** A copy of the template with the leaf at `path` changed; the original is untouched. */
function editLeaf(t: OutputNodeTemplate, path: string, edit: (rule: OutputFieldRule) => OutputFieldRule): OutputNodeTemplate {
  const go = (n: OutputNode, prefix: string): OutputNode => ({
    ...n,
    children: n.children?.map((c) => {
      const p = prefix ? `${prefix}/${c.name}` : c.name;
      if (c.nodeType === "field" || c.nodeType === "attribute") return p === path ? { ...c, rule: edit(c.rule ?? { outputPath: c.name, fieldManipulators: [] }) } : c;
      return go(c, p);
    }),
  });
  return { ...t, root: go(t.root, "") };
}

/** Binds the leaf to a flow field, or (null) leaves it as an empty fixed value, which is how the server emits a leaf nothing feeds. */
export const bindLeaf = (t: OutputNodeTemplate, path: string, fieldKey: string | null) =>
  editLeaf(t, path, ({ canonicalField: _c, fixedValue: _f, ...rule }) => (fieldKey ? { ...rule, canonicalField: fieldKey } : { ...rule, fixedValue: "" }));

export const setLeafWidth = (t: OutputNodeTemplate, path: string, width: number | undefined) =>
  editLeaf(t, path, ({ width: _w, ...rule }) => (width ? { ...rule, width } : rule));

export const OP_LABEL = { is: "is", is_not: "is not", contains: "contains" } as const;

export function describeSendWhen(sendWhen: SendWhen | null, fields?: FlowFieldList): string | null {
  if (!sendWhen) return null;
  const label = fields?.fields.find((f) => f.key === sendWhen.field)?.label ?? sendWhen.field;
  return `Only when ${label} ${OP_LABEL[sendWhen.op] ?? sendWhen.op} “${sendWhen.value}”`;
}
