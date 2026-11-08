/**
 * flowMapperModel.ts — converts a flow output's template tree to and from the mapper's
 * `OrderMappingOverride` shape, so the three-pane mapper can edit it. Pure functions only.
 *
 * Table columns are namespaced with `COLUMN_PREFIX` on the way in, because a header field and a
 * table column may share a key (`date`); the prefix is stripped again on the way out.
 */
import type { OrderMappingOverride, OutputFieldRule, OutputNode, OutputNodeTemplate } from "@/lib/api/types";
import type { FlowFieldList, ReadResult } from "@/lib/api/documents";
import type { SourceField } from "@/components/bridge/mapper/types";

export const COLUMN_PREFIX = "col:";

type Scope = "header" | "lines";
export interface Leaf { path: string; node: OutputNode; scope: Scope }

const isLeaf = (n: OutputNode) => n.nodeType === "field" || n.nodeType === "attribute";

/** The output's table. A null `tableKey` means the first table, as the backend reads it. */
export const outputTable = <T extends { key: string }>(tables: T[], tableKey: string | null) =>
  tableKey ? tables.find((t) => t.key === tableKey) : tables[0];

/**
 * Every field/attribute leaf, with its root-excluded path and whether it sits under an array.
 * A repeated path (two siblings with one name) gets `#2`, `#3`… in tree order, so each leaf
 * keeps its own rule; toOverride and toTemplate share this walk, so the suffix maps back.
 */
export function leafPaths(template: OutputNodeTemplate): Leaf[] {
  const out: Leaf[] = [];
  const used = new Set<string>();
  const walk = (node: OutputNode, prefix: string[], scope: Scope) => {
    for (const child of node.children ?? []) {
      const path = [...prefix, child.name];
      if (!isLeaf(child)) { walk(child, path, child.nodeType === "array" ? "lines" : scope); continue; }
      const base = path.join("/");
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}#${n}`;
      used.add(key);
      out.push({ path: key, node: child, scope });
    }
  };
  walk(template.root, [], "header");
  return out;
}

export function toOverride(template: OutputNodeTemplate, columns: string[]): OrderMappingOverride {
  const header: Record<string, OutputFieldRule> = {};
  const lines: Record<string, OutputFieldRule> = {};
  for (const { path, node, scope } of leafPaths(template)) {
    const rule: OutputFieldRule = node.rule ? { ...node.rule, outputPath: path } : { outputPath: path, fieldManipulators: [] };
    if (scope === "lines" && rule.canonicalField && columns.includes(rule.canonicalField)) {
      rule.canonicalField = COLUMN_PREFIX + rule.canonicalField;
    }
    (scope === "lines" ? lines : header)[path] = rule;
  }
  return { customFields: [], output: { header, lines } };
}

const isEmpty = (r: OutputFieldRule) =>
  !r.canonicalField && !r.fixedValue && !r.expression && !r.sourceToken && !(r.fieldManipulators?.length);

export function toTemplate(template: OutputNodeTemplate, override: OrderMappingOverride): OutputNodeTemplate {
  const copy = structuredClone(template);
  const rules = { ...override.output?.header, ...override.output?.lines };
  for (const { path, node } of leafPaths(copy)) {
    const edited = rules[path];
    if (!edited || isEmpty(edited)) {
      delete node.rule;
      continue;
    }
    const field = edited.canonicalField;
    node.rule = {
      ...edited,
      outputPath: node.rule?.outputPath ?? node.name,
      ...(field?.startsWith(COLUMN_PREFIX) ? { canonicalField: field.slice(COLUMN_PREFIX.length) } : {}),
    };
  }
  return copy;
}

export function flowSourceFields(fields: FlowFieldList, tableKey: string | null, read?: ReadResult | null): SourceField[] {
  const base = { mapped: false, suggestedFor: null, suggestionConfidence: null } as const;
  const headerFields: SourceField[] = fields.fields.map((f) => ({
    ...base, id: f.key, label: f.label, group: "header",
    value: read?.fields.find((r) => r.key === f.key)?.value ?? "",
  }));
  const table = outputTable(fields.tables, tableKey);
  const firstRow = outputTable(read?.tables ?? [], tableKey)?.rows[0];
  const columnFields: SourceField[] = (table?.columns ?? []).map((c) => ({
    ...base, id: COLUMN_PREFIX + c.key, label: c.label, group: "line",
    value: firstRow?.cells[c.key]?.value ?? "",
  }));
  return [...headerFields, ...columnFields];
}
