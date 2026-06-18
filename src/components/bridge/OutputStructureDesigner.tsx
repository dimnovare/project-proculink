"use client";

// OutputStructureDesigner — Phase C: the visual editor for the OutputNode tree.
// Build a supplier's exact required STRUCTURE (nesting, repeating line groups, attributes, custom
// names) and see the live output. Self-contained: it previews + saves the order's mapping override
// with `outputTree` set (the backend renders it as the highest-precedence output mode, and the
// preview == the delivered bytes). Functional first version — form-based tree editing; drag/reorder
// polish is a follow-up.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewMappingOverride, upsertMappingOverride, inferOutputStructure } from "@/lib/api-client";
import {
  CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  type OrderMappingOverride, type OutputNode, type OutputNodeTemplate,
  type OutputNodeType, type OutputFormat,
} from "@/lib/api/types";

// Only the formats the backend OutputTemplateEmitter produces VALIDLY from a generic node tree
// (offer⇔works). JSON / XML / CSV are first-class. cXML, UBL, and X12 are intentionally NOT offered:
// cXML needs its DOCTYPE + From/To/Sender envelope, Peppol UBL needs mandatory UBLVersionID/
// CustomizationID/ProfileID, and X12 is positional segments — none expressible as a generic tree, so
// a tree-emitted document would be well-formed but receiver-REJECTED. Those formats deliver through
// their dedicated, valid transforms (CxmlTransformService / UblOrderTransformService / X12TransformService).
// A namespaced XML supplier is served by "XML" here (the emitter binds cbc:/cac: prefixes).
const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: "json", label: "JSON" }, { id: "xml", label: "XML" }, { id: "csv", label: "CSV" },
];

/**
 * Coerce a tree's format to one the designer can OFFER + emit (json/xml/csv). A saved override or
 * an inferred tree may carry a format outside that set (cXml / ubl / x12, or a casing variant like
 * "JSON"/"cXml"); without this the `<select value={tree.format}>` matches no `<option>` and the
 * Format control renders BLANK (founder bug 6). cXML/UBL/X12 are namespaced/positional documents
 * the generic node tree serializes as XML, so they collapse to "xml" here; anything unknown → json.
 */
function designerFormat(raw: OutputFormat | string | null | undefined): OutputFormat {
  const v = (raw ?? "").toString().trim().toLowerCase();
  if (v === "json") return "json";
  if (v === "csv") return "csv";
  // xml + the XML-family standards (cxml/cXml, ubl, x12) all author as a generic XML tree here.
  if (v === "xml" || v === "cxml" || v === "ubl" || v === "x12") return "xml";
  return "json";
}

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

// Value-format presets — append a DateFormat / NumberFormat manipulator so a non-technical user gets
// "Date" / "Number" / "Currency" formatting without hand-writing Scriban. The canonical date fields
// arrive as ISO ("yyyy-MM-dd"), so DateFormat's input is fixed to that. NumberFormat parses the
// invariant machine decimal and renders with a .NET format + culture.
type Preset = { key: string; label: string; mani: { type: string; params: string[] } | null };
const FORMAT_PRESETS: Preset[] = [
  { key: "",        label: "No formatting",        mani: null },
  { key: "date-iso", label: "Date · 2026-06-15",   mani: { type: "DateFormat",   params: ["yyyy-MM-dd", "yyyy-MM-dd"] } },
  { key: "date-eu",  label: "Date · 15/06/2026",   mani: { type: "DateFormat",   params: ["yyyy-MM-dd", "dd/MM/yyyy"] } },
  { key: "date-us",  label: "Date · 06/15/2026",   mani: { type: "DateFormat",   params: ["yyyy-MM-dd", "MM/dd/yyyy"] } },
  { key: "num-us",   label: "Number · 1,234.50",   mani: { type: "NumberFormat", params: ["N2"] } },
  { key: "num-eu",   label: "Number · 1.234,50",   mani: { type: "NumberFormat", params: ["N2", "de-DE"] } },
  { key: "cur-eur",  label: "Currency · €1.234,50", mani: { type: "NumberFormat", params: ["C2", "de-DE"] } },
  { key: "cur-usd",  label: "Currency · $1,234.50", mani: { type: "NumberFormat", params: ["C2", "en-US"] } },
];
const FORMAT_TYPES = new Set(["DateFormat", "NumberFormat"]);
/** Which preset (if any) the node's manipulators currently match — by type + params. */
function currentPreset(manis: { type: string; params: string[] }[] | undefined): string {
  const fmt = (manis ?? []).find((m) => FORMAT_TYPES.has(m.type));
  if (!fmt) return "";
  const hit = FORMAT_PRESETS.find(
    (p) => p.mani && p.mani.type === fmt.type && JSON.stringify(p.mani.params) === JSON.stringify(fmt.params));
  return hit?.key ?? "";
}

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
  // Seed from the saved/passed tree, but force its format into the offered set so the Format
  // control always has a matching <option> (a tree saved as cXml/ubl/x12 → "xml" here).
  const [tree, setTree] = useState<OutputNodeTemplate>(
    initialTree ? { ...initialTree, format: designerFormat(initialTree.format) } : defaultTree("json"),
  );
  const [preview, setPreview] = useState<{ content: string | null; error?: string; loading: boolean }>({ content: null, loading: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showInfer, setShowInfer] = useState(initialTree == null);
  const [sample, setSample] = useState("");
  const [inferring, setInferring] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);

  const infer = useCallback(async () => {
    const s = sample.trim();
    if (!s) return;
    setInferring(true);
    setInferError(null);
    try {
      // Auto-detect the sample's format from its first character.
      const fmt = s.startsWith("<") ? "xml" : (s.startsWith("{") || s.startsWith("[")) ? "json" : "csv";
      const inferred = await inferOutputStructure(orderId, s, fmt);
      // Keep the Format control populated even if the inferred tree reports a non-offered format.
      setTree({ ...inferred, format: designerFormat(inferred.format) });
      setSaved(false);
      setShowInfer(false);
    } catch (e) {
      setInferError(e instanceof Error ? e.message : "Could not read that sample.");
    } finally {
      setInferring(false);
    }
  }, [sample, orderId]);

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
            <select value={designerFormat(tree.format)} onChange={(e) => { setTree((t) => ({ ...t, format: e.target.value as OutputFormat })); setSaved(false); }}
              style={{ height: 30, borderRadius: 6, border: "none", padding: "0 8px", fontSize: 12.5 }}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button onClick={onClose} aria-label="Close" style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
              <span style={{ height: 30, width: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.15)", color: "#FFF", fontSize: 16 }}>✕</span>
            </button>
          </div>
        </div>

        {/* Body: tree | preview */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", minHeight: 0, flex: 1 }}>
          <div style={{ overflow: "auto", padding: 16, borderRight: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: "#5A6B82", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Structure</div>

            {/* Phase D — paste the supplier's required sample and infer the shape */}
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => setShowInfer((v) => !v)}
                style={{ width: "100%", textAlign: "left", height: 30, padding: "0 10px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#F7F9FC", color: NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ⧉ Paste a supplier sample to start {showInfer ? "▾" : "▸"}
              </button>
              {showInfer && (
                <div style={{ marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, background: "#F7F9FC" }}>
                  <textarea value={sample} onChange={(e) => setSample(e.target.value)}
                    placeholder="Paste the file your supplier requires (JSON, CSV, or XML)…"
                    style={{ width: "100%", minHeight: 92, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8, resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: SLATE }}>Detects JSON, CSV, or XML automatically.</span>
                    <button onClick={() => void infer()} disabled={inferring || !sample.trim()}
                      style={{ marginLeft: "auto", height: 30, padding: "0 14px", borderRadius: 6, border: "none", background: NAVY, color: "#FFF", fontSize: 12, fontWeight: 600, cursor: inferring || !sample.trim() ? "default" : "pointer", opacity: inferring || !sample.trim() ? 0.6 : 1 }}>
                      {inferring ? "Reading…" : "Infer structure"}
                    </button>
                  </div>
                  {inferError && <div style={{ color: "#C53A3A", fontSize: 11.5, marginTop: 6 }}>{inferError}</div>}
                </div>
              )}
            </div>

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
          <span style={{ fontSize: 11.5, color: "#5A6B82" }}>Bind each value to a field or fixed value · format dates/numbers · &ldquo;only include when&rdquo; to add a field or drop lines conditionally.</span>
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

  const updateIncludeWhen = (value: string) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, includeWhen: value === "" ? null : value })));

  // Set/clear a value-format preset: keep any non-format manipulators, swap the single format one.
  const setFormatPreset = (key: string) =>
    onUpdate((n) => updateAt(n, path, (x) => {
      const others = (x.rule?.fieldManipulators ?? []).filter((m) => !FORMAT_TYPES.has(m.type));
      const preset = FORMAT_PRESETS.find((p) => p.key === key);
      const manis = preset?.mani ? [...others, preset.mani] : others;
      return { ...x, rule: { outputPath: x.name, canonicalField: x.rule?.canonicalField ?? null, fixedValue: x.rule?.fixedValue ?? null, fieldManipulators: manis } };
    }));

  const canonicalOptions = childScope ? CANONICAL_LINE_FIELDS : CANONICAL_HEADER_FIELDS;
  const boundCanonical = node.rule?.canonicalField ?? "";
  const usingFixed = node.rule?.fixedValue != null && node.rule?.canonicalField == null;
  const presetKey = currentPreset(node.rule?.fieldManipulators);
  // "Only include when…" is meaningful on any non-root node (a list ITEM uses it to drop lines).
  const scopeHint = childScope ? "line" : "order";

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
            {(boundCanonical || usingFixed) && (
              <select value={presetKey} onChange={(e) => setFormatPreset(e.target.value)} aria-label="Value format"
                title="Format this value (date / number / currency)"
                style={{ height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 6px", fontSize: 12, color: presetKey ? NAVY : SLATE }}>
                {FORMAT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            )}
          </>
        )}

        {!isRoot && (
          <button onClick={remove} aria-label="Remove node"
            style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
            <span style={{ height: 30, width: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${BORDER}`, background: "#FFF", color: "#C53A3A" }}>✕</span>
          </button>
        )}
      </div>

      {/* Conditional inclusion (OutputNode.includeWhen) — a bare condition; the node/line is skipped
          when it's false. Subtle by default; meaningful on any non-root node. */}
      {!isRoot && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, marginLeft: 2 }}>
          <span style={{ fontSize: 10.5, color: SLATE, whiteSpace: "nowrap" }}>only include when</span>
          <input value={node.includeWhen ?? ""} onChange={(e) => updateIncludeWhen(e.target.value)}
            placeholder={`always — e.g. ${scopeHint}.Quantity > 0`} aria-label="Only include when (condition)"
            spellCheck={false}
            style={{ flex: "1 1 160px", minWidth: 0, height: 26, border: `1px solid ${node.includeWhen ? BLUE : BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontFamily: "ui-monospace, Menlo, monospace", color: node.includeWhen ? NAVY : SLATE }} />
        </div>
      )}

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
