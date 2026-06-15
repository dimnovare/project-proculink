"use client";

// OutputStructureDesigner — Phase C: the visual editor for the OutputNode tree.
// Build a supplier's exact required STRUCTURE (nesting, repeating line groups, attributes, custom
// names) and see the live output. Self-contained: it previews + saves the order's mapping override
// with `outputTree` set (the backend renders it as the highest-precedence output mode, and the
// preview == the delivered bytes). Functional first version — form-based tree editing; drag/reorder
// polish is a follow-up.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewMappingOverride, upsertMappingOverride } from "@/lib/api-client";
import {
  CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  type OrderMappingOverride, type OutputNode, type OutputNodeTemplate,
  type OutputNodeType, type OutputFormat,
} from "@/lib/api/types";

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: "json", label: "JSON" }, { id: "xml", label: "XML" }, { id: "csv", label: "CSV" },
  { id: "cXml", label: "cXML" }, { id: "ubl", label: "UBL" }, { id: "x12", label: "X12" },
];

// Bridge Layer tokens: navy chrome, green = primary/"supplier out" action, blue = incoming accent.
// Violet is reserved for AI only (design system 09-trust-rules) — not used as decoration here.
const NAVY = "#0B1A2F";
const GREEN = "#1E6D29";
const BLUE = "#2D6BD4";
const BORDER = "#C6CDDA";
const SLATE = "#56627A";

const TYPE_LABEL: Record<OutputNodeType, string> = {
  object: "{ } group", array: "[ ] list", field: "value", attribute: "@attr",
};

function newField(name: string, canonicalField?: string): OutputNode {
  return { name, nodeType: "field", rule: { outputPath: name, canonicalField: canonicalField ?? null, fixedValue: null, fieldManipulators: [] } };
}
function defaultTree(format: OutputFormat): OutputNodeTemplate {
  // A sensible starting shape: a root object with the order number + a repeating "lines" list.
  return {
    format,
    root: {
      name: "order", nodeType: "object", children: [
        newField("orderNumber", "PoNumber"),
        { name: "lines", nodeType: "array", collection: "lines", children: [
          { name: "line", nodeType: "object", children: [
            newField("itemCode", "SupplierItemCode"),
            newField("quantity", "Quantity"),
          ] },
        ] },
      ],
    },
  };
}

/** Immutably update the node at `path` (array of child indices from the root). */
function updateAt(node: OutputNode, path: number[], fn: (n: OutputNode) => OutputNode): OutputNode {
  if (path.length === 0) return fn(node);
  const [i, ...rest] = path;
  const children = (node.children ?? []).map((c, idx) => (idx === i ? updateAt(c, rest, fn) : c));
  return { ...node, children };
}
function removeAt(node: OutputNode, path: number[]): OutputNode {
  if (path.length === 1) return { ...node, children: (node.children ?? []).filter((_, idx) => idx !== path[0]) };
  const [i, ...rest] = path;
  const children = (node.children ?? []).map((c, idx) => (idx === i ? removeAt(c, rest) : c));
  return { ...node, children };
}

export function OutputStructureDesigner({
  orderId, baseOverride, initialTree, onClose, onSaved,
}: {
  orderId: string;
  baseOverride: OrderMappingOverride | null;
  initialTree?: OutputNodeTemplate | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [tree, setTree] = useState<OutputNodeTemplate>(initialTree ?? defaultTree("json"));
  const [preview, setPreview] = useState<{ content: string | null; error?: string; loading: boolean }>({ content: null, loading: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setRoot = useCallback((fn: (n: OutputNode) => OutputNode) => {
    setTree((t) => ({ ...t, root: fn(t.root) }));
    setSaved(false);
  }, []);

  // ── Live preview (debounced) — exactly what will be delivered ───────────────
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setPreview((p) => ({ ...p, loading: true }));
    debounce.current = setTimeout(async () => {
      try {
        const override: OrderMappingOverride = { ...(baseOverride ?? { customFields: [] }), outputTree: tree };
        const res = await previewMappingOverride(orderId, override, tree.format);
        setPreview({ content: res.content ?? null, error: res.error ?? undefined, loading: false });
      } catch (e) {
        setPreview({ content: null, error: e instanceof Error ? e.message : "Preview failed", loading: false });
      }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [tree, orderId, baseOverride]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const override: OrderMappingOverride = { ...(baseOverride ?? { customFields: [] }), outputTree: tree };
      await upsertMappingOverride(orderId, override);
      setSaved(true);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [tree, orderId, baseOverride, onSaved]);

  return (
    <div role="dialog" aria-label="Design output structure"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,16,28,0.55)", display: "flex", justifyContent: "center", alignItems: "stretch", padding: "3vh 2vw" }}>
      <div style={{ background: "#FFFFFF", borderRadius: 12, width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(8,16,28,0.4)" }}>
        {/* Bridge edge (buyer blue → supplier green) — design system signature #5 */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${BLUE}, ${GREEN})` }} />
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, background: NAVY, color: "#FFFFFF" }}>
          <strong style={{ fontSize: 14 }}>Design the output structure</strong>
          <span style={{ fontSize: 11.5, opacity: 0.8 }}>What the supplier receives — live preview on the right</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 11.5, opacity: 0.85 }}>Format</label>
            <select value={tree.format} onChange={(e) => { setTree((t) => ({ ...t, format: e.target.value as OutputFormat })); setSaved(false); }}
              style={{ height: 30, borderRadius: 6, border: "none", padding: "0 8px", fontSize: 12.5 }}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button onClick={onClose} aria-label="Close" style={{ height: 30, width: 30, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.15)", color: "#FFF", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        </div>

        {/* Body: tree | preview */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", minHeight: 0, flex: 1 }}>
          <div style={{ overflow: "auto", padding: 16, borderRight: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: "#5A6B82", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Structure</div>
            <NodeEditor node={tree.root} path={[]} lineScope={false} onUpdate={setRoot} isRoot />
          </div>
          <div style={{ overflow: "auto", padding: 16, background: "#0B1626" }}>
            <div style={{ fontSize: 11, color: "#8FA3BF", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              What the supplier receives {preview.loading ? "· updating…" : "· live"}
            </div>
            {preview.error
              ? <div style={{ color: "#FF9B9B", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{preview.error}</div>
              : <pre style={{ margin: 0, color: "#D7E2F2", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, Menlo, monospace" }}>{preview.content ?? "—"}</pre>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 18px", borderTop: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 11.5, color: "#5A6B82" }}>Bind each value to an incoming field, a fixed value, or leave a list to repeat per order line.</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ height: 34, padding: "0 14px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "#FFF", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => void save()} disabled={saving}
              style={{ height: 34, padding: "0 18px", borderRadius: 7, border: "none", background: GREEN, color: "#FFF", fontSize: 12.5, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : saved ? "✓ Saved" : "Save structure"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recursive node editor ──────────────────────────────────────────────────────

function NodeEditor({
  node, path, lineScope, onUpdate, isRoot,
}: {
  node: OutputNode;
  path: number[];
  lineScope: boolean;
  onUpdate: (fn: (n: OutputNode) => OutputNode) => void;
  isRoot?: boolean;
}) {
  const isContainer = node.nodeType === "object" || node.nodeType === "array";
  const childScope = lineScope || node.nodeType === "array";

  const updateName = (name: string) => onUpdate((n) => updateAt(n, path, (x) => ({ ...x, name })));
  const remove = () => onUpdate((n) => removeAt(n, path));
  const addChild = (child: OutputNode) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, children: [...(x.children ?? []), child] })));
  const updateRuleField = (key: "canonicalField" | "fixedValue", value: string | null) =>
    onUpdate((n) => updateAt(n, path, (x) => ({
      ...x,
      rule: {
        outputPath: x.name,
        canonicalField: key === "canonicalField" ? value : null,
        fixedValue: key === "fixedValue" ? value : null,
        fieldManipulators: x.rule?.fieldManipulators ?? [],
      },
    })));

  const canonicalOptions = childScope ? CANONICAL_LINE_FIELDS : CANONICAL_HEADER_FIELDS;
  const boundCanonical = node.rule?.canonicalField ?? "";
  const usingFixed = node.rule?.fixedValue != null && node.rule?.canonicalField == null;

  return (
    <div style={{ borderLeft: isRoot ? "none" : `2px solid #E5E9F1`, paddingLeft: isRoot ? 0 : 12, marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span title={node.nodeType} style={{ fontSize: 10, fontWeight: 600, color: SLATE, background: "#EEF1F6", borderRadius: 4, padding: "2px 6px", minWidth: 60, textAlign: "center" }}>
          {TYPE_LABEL[node.nodeType]}
        </span>
        <input value={node.name} onChange={(e) => updateName(e.target.value)} aria-label="Node name"
          style={{ flex: "1 1 120px", minWidth: 0, height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12.5, fontWeight: 600 }} />

        {!isContainer && (
          <>
            <select value={usingFixed ? "__fixed__" : boundCanonical}
              onChange={(e) => e.target.value === "__fixed__" ? updateRuleField("fixedValue", "") : updateRuleField("canonicalField", e.target.value)}
              aria-label="Source field"
              style={{ height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 6px", fontSize: 12 }}>
              <option value="">— pick field —</option>
              {canonicalOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              <option value="__fixed__">Fixed value…</option>
            </select>
            {usingFixed && (
              <input value={node.rule?.fixedValue ?? ""} onChange={(e) => updateRuleField("fixedValue", e.target.value)}
                placeholder="value" aria-label="Fixed value"
                style={{ width: 110, height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12 }} />
            )}
          </>
        )}

        {!isRoot && (
          <button onClick={remove} aria-label="Remove node"
            style={{ height: 30, width: 30, borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: "#C53A3A", cursor: "pointer" }}>✕</button>
        )}
      </div>

      {isContainer && (
        <>
          <div style={{ marginTop: 6 }}>
            {(node.children ?? []).map((c, i) => (
              <NodeEditor key={i} node={c} path={[...path, i]} lineScope={childScope} onUpdate={onUpdate} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 4 }}>
            <AddBtn label="+ value" onClick={() => addChild(newField("value"))} />
            <AddBtn label="+ object" onClick={() => addChild({ name: "group", nodeType: "object", children: [] })} />
            <AddBtn label="+ list" onClick={() => addChild({ name: "items", nodeType: "array", collection: "lines", children: [{ name: "item", nodeType: "object", children: [] }] })} />
            {node.nodeType === "object" && <AddBtn label="+ @attr" onClick={() => addChild({ name: "attr", nodeType: "attribute", rule: { outputPath: "attr", fieldManipulators: [] } })} />}
          </div>
        </>
      )}
    </div>
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ height: 26, padding: "0 10px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#F7F9FC", color: "#3A4A60", fontSize: 11.5, cursor: "pointer" }}>{label}</button>
  );
}
