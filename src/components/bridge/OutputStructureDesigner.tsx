"use client";

// OutputStructureDesigner — Phase C: the visual editor for the OutputNode tree.
// Build a supplier's exact required STRUCTURE (nesting, repeating line groups, attributes, custom
// names) and see the live output. Self-contained: it previews + saves the order's mapping override
// with `outputTree` set (the backend renders it as the highest-precedence output mode, and the
// preview == the delivered bytes). Functional first version — form-based tree editing; drag/reorder
// polish is a follow-up.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewMappingOverride, upsertMappingOverride, inferOutputStructure, getSourceTokens } from "@/lib/api-client";
import { OutputSourcePicker } from "./OutputSourcePicker";
import {
  updateAt, removeAt, setNodeNamespace,
  namespacesToRows, rowsToNamespaces, templateHasRootNamespaces, treeHasPerNodeNamespaces,
  type NamespaceRow,
} from "./outputNamespaceModel";
import {
  CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS,
  type OrderMappingOverride, type OutputNode, type OutputNodeTemplate,
  type OutputNodeType, type OutputFormat, type SourceToken,
} from "@/lib/api/types";
import { useConfirm } from "@/components/ui/confirm";

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
// These are the LOCKED canonical palette used everywhere else in the mapper (DSPrimitives,
// OutgoingPane, SendReadinessStrip, the signature blue→green bridge edge): buyer-blue #1E66C9,
// supplier-green #2E8E3A (fill), green-deep #1E6D29 (hover/active). Do NOT diverge.
const NAVY = "#0B1A2F";
const GREEN = "#2E8E3A";       // brand-green — modal's single primary action (Save)
const GREEN_DEEP = "#1E6D29";  // brand-green-deep — primary hover, green text/borders
const BLUE = "#1E66C9";        // buyer-blue — incoming accent (active includeWhen)
const BORDER = "#CBD0DA";
const SLATE = "#5E6779";

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

// (updateAt / removeAt now live in ./outputNamespaceModel so they're unit-testable for namespace
// round-trip preservation; imported above.)

// ── Responsive switch ───────────────────────────────────────────────────────
// The body is a 50/50 two-column grid (tree | dark live-output). Below ~860px that's unusable,
// so we collapse to a single column (tree on top, output below) and go full-screen. A matchMedia
// listener reflows on resize/rotate (no poll). SSR-safe: defaults to wide so the desktop layout
// is the server/first-paint shape, then corrects on mount.
const NARROW_QUERY = "(max-width: 860px)";
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const apply = () => setNarrow(mql.matches);
    apply();
    // addEventListener("change") is the modern API; both fire on viewport resize across the bound.
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);
  return narrow;
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
  const confirm = useConfirm();
  const [preview, setPreview] = useState<{ content: string | null; error?: string; loading: boolean }>({ content: null, loading: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Tracks whether the user has made an EDIT since open / last save — drives the close confirm.
  // (`saved` starts false on a fresh open, so guarding the close on `!saved` would wrongly prompt
  // when closing an UNEDITED designer; `dirty` only flips true on a real edit.)
  const [dirty, setDirty] = useState(false);
  const [showInfer, setShowInfer] = useState(initialTree == null);
  const [sample, setSample] = useState("");
  const [inferring, setInferring] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const isNarrow = useIsNarrow();
  // First-run empty state: when there's no saved tree, the infer panel IS the screen — the default
  // tree stays hidden until the user either infers a sample or explicitly chooses "start blank".
  // This avoids showing a populated tree + a paste-a-sample prompt at once (two competing affordances).
  const [firstRun, setFirstRun] = useState(initialTree == null);
  // P-1: paste-to-infer replaces the whole tree while the modal stays mounted. NodeEditor lazily
  // initializes its per-node "Advanced" open-state from the node's data, so position-reconciled
  // editors would NOT re-run that initializer — a node that GAINS a namespace/condition from infer
  // could render with Advanced collapsed (data still reachable via its pill, but the affordance is
  // hidden). Bump this revision on infer and key the editor subtree by it so the editors remount and
  // re-initialize. Normal edits never bump it, so an in-progress edit is preserved.
  const [treeRevision, setTreeRevision] = useState(0);

  // F-1: the full source-field universe for this order, so a node can bind to ANY incoming field
  // (CSV cell / XML leaf+attr / EDI / JSON leaf / PDF-email raw_field), each with a sample value —
  // not just the ~13 canonical names. [] for formats with no token capture.
  const { data: sourceTokens } = useQuery({
    queryKey: ["source-tokens", orderId],
    queryFn: () => getSourceTokens(orderId),
    staleTime: 30_000,
  });

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
      setSaved(false); setDirty(true);
      setShowInfer(false);
      setFirstRun(false); // sample inferred → reveal the editable tree
      setTreeRevision((r) => r + 1); // remount the editors so Advanced re-initializes for the new tree
    } catch (e) {
      setInferError(e instanceof Error ? e.message : "Could not read that sample.");
    } finally {
      setInferring(false);
    }
  }, [sample, orderId]);

  const setRoot = useCallback((fn: (n: OutputNode) => OutputNode) => {
    setTree((t) => ({ ...t, root: fn(t.root) }));
    setSaved(false); setDirty(true);
  }, []);

  // Root namespaces (prefix → uri). Only meaningful for XML; the LEGACY root-map mode where nodes
  // stay unprefixed and the xmlns:* declarations live on the root. Mutually exclusive with per-node
  // namespaces (the emitter throws if both are set) — the UI gates which editor is shown.
  const setRootNamespaces = useCallback((rows: NamespaceRow[]) => {
    setTree((t) => ({ ...t, namespaces: rowsToNamespaces(rows) }));
    setSaved(false); setDirty(true);
  }, []);

  const isXml = designerFormat(tree.format) === "xml";
  const hasPerNodeNs = treeHasPerNodeNamespaces(tree.root);
  const hasRootNs = templateHasRootNamespaces(tree);

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
      setSaved(true); setDirty(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [tree, orderId, baseOverride, onSaved]);

  // Guarded close — the X and Cancel both discard in-modal edits, so confirm first when the tree
  // has unsaved changes. `onClose` itself stays unchanged so the save-then-close path is untouched.
  const requestClose = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "You have unsaved changes to this output structure. Discard them?",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose, confirm]);

  return (
    <div role="dialog" aria-label="Design output structure"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,16,28,0.55)", display: "flex", justifyContent: "center", alignItems: "stretch",
        // Full-screen on narrow viewports (no breathing-room padding) so the single-column stack
        // has the whole screen; comfortable inset on desktop.
        padding: isNarrow ? 0 : "3vh 2vw" }}>
      <div style={{ position: "relative", background: "#FFFFFF", borderRadius: isNarrow ? 0 : 12, width: "100%", maxWidth: isNarrow ? "none" : 1100, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: isNarrow ? "none" : "0 24px 64px rgba(8,16,28,0.4)" }}>
        {/* Bridge edge — design system signature. Spec §9.3: a 2px gradient LEFT edge
            (buyer blue #2D6BD4 → supplier green #1E6D29), full height of the dialog. */}
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 2, background: "linear-gradient(180deg, #2D6BD4, #1E6D29)", zIndex: 1 }} />
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, background: NAVY, color: "#FFFFFF" }}>
          <strong style={{ fontSize: 15 }}>Design the output</strong>
          {/* The subtitle is a desktop nicety — hide it on narrow where horizontal room is scarce. */}
          {!isNarrow && <span style={{ fontSize: 12, opacity: 0.8 }}>What the supplier receives — live preview on the right</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <span id="osd-format-label" style={{ fontSize: 12, opacity: 0.85 }}>Format</span>
            {/* Styled segmented format selector (§7.5 format pills) — replaces the raw OS <select>.
                Selected pill = green text/border on a soft-green fill; unselected = muted slate on a
                faint navy field. Same OutputFormat set the emitter can render (json/xml/csv) and the
                same onChange (set tree.format + mark unsaved). */}
            <div role="radiogroup" aria-labelledby="osd-format-label"
              style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)" }}>
              {FORMATS.map((f) => {
                const selected = designerFormat(tree.format) === f.id;
                return (
                  <button key={f.id} role="radio" aria-checked={selected} aria-label={`${f.label} format`}
                    onClick={() => { setTree((t) => ({ ...t, format: f.id })); setSaved(false); setDirty(true); }}
                    style={{
                      height: 24, padding: "0 11px", borderRadius: 6, cursor: "pointer",
                      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: 10, fontWeight: 700,
                      letterSpacing: 0.2, transition: "all 120ms ease",
                      border: `1px solid ${selected ? GREEN : "transparent"}`,
                      background: selected ? "#EAF6EC" : "transparent",
                      color: selected ? GREEN_DEEP : "rgba(255,255,255,0.7)",
                    }}>
                    {f.label}
                  </button>
                );
              })}
            </div>
            <button onClick={requestClose} aria-label="Close" style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
              <span style={{ height: 30, width: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.15)", color: "#FFF", fontSize: 16 }}>✕</span>
            </button>
          </div>
        </div>

        {/* Body: tree | preview. Two columns on desktop; a single stacked column (tree on top,
            dark live-output below) below ~860px. The narrow stack scrolls as one region so the
            per-node rows never need a horizontal scrollbar. */}
        <div style={{ display: isNarrow ? "flex" : "grid", flexDirection: isNarrow ? "column" : undefined,
          gridTemplateColumns: isNarrow ? undefined : "minmax(0,1fr) minmax(0,1fr)", minHeight: 0, flex: 1,
          overflowY: isNarrow ? "auto" : undefined }}>
          <div style={{ overflow: isNarrow ? "visible" : "auto", padding: 16, borderRight: isNarrow ? "none" : `1px solid ${BORDER}`, borderBottom: isNarrow ? `1px solid ${BORDER}` : "none" }}>
            <div style={{ fontSize: 11, color: "#5A6B82", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Structure</div>

            {/* Phase D — paste the supplier's required sample and infer the shape.
                On first run this IS the empty state (firstRun), so the toggle/collapse chrome and the
                default tree are suppressed until the user infers a sample or chooses "start blank". */}
            <div style={{ marginBottom: 12 }}>
              {!firstRun && (
                <button onClick={() => setShowInfer((v) => !v)}
                  style={{ width: "100%", textAlign: "left", height: 30, padding: "0 10px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#F7F9FC", color: NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ⧉ Paste a supplier sample to start {showInfer ? "▾" : "▸"}
                </button>
              )}
              {(showInfer || firstRun) && (
                <div style={{ marginTop: firstRun ? 0 : 8, border: `1px solid ${BORDER}`, borderRadius: 8, padding: firstRun ? 14 : 10, background: "#F7F9FC" }}>
                  {firstRun && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Start from a supplier sample</div>
                      <div style={{ fontSize: 12, color: SLATE, marginTop: 3, lineHeight: 1.5 }}>
                        Paste the exact file your supplier requires and we&rsquo;ll match its structure — or start from a blank shape.
                      </div>
                    </div>
                  )}
                  <textarea value={sample} onChange={(e) => setSample(e.target.value)}
                    aria-label="Supplier sample file"
                    placeholder="Paste the file your supplier requires (JSON, CSV, or XML)…"
                    style={{ width: "100%", minHeight: firstRun ? 132 : 92, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.5, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8, resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: SLATE }}>Detects JSON, CSV, or XML automatically.</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                      {firstRun && (
                        // Secondary escape hatch — keep editing the default starting shape. Neutral
                        // styling so the single primary (green Save) is never rivalled by a 2nd accent.
                        <button onClick={() => { setFirstRun(false); setShowInfer(false); }}
                          style={{ height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Start blank
                        </button>
                      )}
                      <button onClick={() => void infer()} disabled={inferring || !sample.trim()}
                        style={{ height: 30, padding: "0 14px", borderRadius: 6, border: `1px solid ${GREEN_DEEP}`, background: GREEN, color: "#FFF", fontSize: 12, fontWeight: 600, cursor: inferring || !sample.trim() ? "default" : "pointer", opacity: inferring || !sample.trim() ? 0.6 : 1 }}>
                        {inferring ? "Reading…" : "Build from a sample"}
                      </button>
                    </div>
                  </div>
                  {inferError && <div style={{ color: "#B43838", fontSize: 12, marginTop: 6 }}>{inferError}</div>}
                </div>
              )}
            </div>

            {/* Root XML namespaces (prefix → uri) — the LEGACY root-map mode: declare xmlns:cbc=… on
                the root, nodes stay unprefixed. XML-only, hidden during first-run. Hidden when the
                tree already uses PER-NODE namespaces (the two modes are mutually exclusive — the
                emitter throws if both are set), with an inline hint so the user knows why. */}
            {!firstRun && isXml && !hasPerNodeNs && (
              <RootNamespacesEditor rows={namespacesToRows(tree.namespaces)} onChange={setRootNamespaces} />
            )}
            {!firstRun && isXml && hasPerNodeNs && hasRootNs && (
              <div style={{ marginBottom: 12, fontSize: 11, color: "#9A6B1E", background: "#FFF7E8", border: "1px solid #F2DBA8", borderRadius: 6, padding: "7px 10px" }}>
                This structure declares namespaces on individual elements, so root-level namespaces
                are not used. Clear the per-element namespaces to declare them on the root instead.
              </div>
            )}

            {/* The editable tree is hidden during first-run (the infer panel owns the screen). */}
            {!firstRun && (
              <NodeEditor key={treeRevision} node={tree.root} path={[]} lineScope={false} onUpdate={setRoot}
                sourceTokens={sourceTokens ?? []} isRoot
                xml={isXml} rootHasNamespaces={hasRootNs} />
            )}
          </div>
          <div style={{ overflow: isNarrow ? "visible" : "auto", padding: 16, background: "#0B1626" }}>
            <div style={{ fontSize: 11, color: "#8FA3BF", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              What the supplier receives {preview.loading ? "· updating…" : "· live"}
            </div>
            {preview.error
              ? <div style={{ color: "#FF9B9B", fontSize: 13, whiteSpace: "pre-wrap" }}>{preview.error}</div>
              : <pre style={{ margin: 0, color: "#D7E2F2", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", fontVariantNumeric: "tabular-nums", fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace" }}>{preview.content ?? "—"}</pre>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 18px", borderTop: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
          {/* The helper line is desktop-only — on narrow it would push the action buttons off-screen. */}
          {!isNarrow && <span style={{ fontSize: 12, color: "#5A6B82" }}>Bind each value to a field or fixed value · format dates/numbers · &ldquo;only include when&rdquo; to add a field or drop lines conditionally.</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {/* DS Button md sizing: 44px tap target on narrow, dense 32px on desktop. */}
            <button onClick={requestClose}
              style={{ height: isNarrow ? 44 : 32, padding: "0 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: NAVY, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => void save()} disabled={saving}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = GREEN_DEEP; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = GREEN; }}
              style={{ height: isNarrow ? 44 : 32, padding: "0 18px", borderRadius: 6, border: "none", background: GREEN, color: "#FFF", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 150ms ease" }}>
              {saving ? "Saving…" : saved ? "✓ Saved" : "Save structure"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Node-row presentation tokens ────────────────────────────────────────────────
// A type "pill" identifies what kind of node this is at a glance (image 07): object = blue,
// list = blue-grey, value = grey, attr = grey. Short symbol + tooltip, mono.
const TYPE_PILL: Record<OutputNodeType, { glyph: string; fg: string; bg: string; border: string }> = {
  object:    { glyph: "{ }", fg: "#1E66C9", bg: "#EAF1FC", border: "#CFE0F7" },
  array:     { glyph: "[ ]", fg: "#3A4A60", bg: "#EEF1F6", border: "#D8DEE9" },
  field:     { glyph: "val", fg: "#5E6779", bg: "#EEF1F6", border: "#D8DEE9" },
  attribute: { glyph: "@",   fg: "#5E6779", bg: "#EEF1F6", border: "#D8DEE9" },
};

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

// Short human label for a format preset, shown inside the compact format pill (e.g. "Date · EU").
const PRESET_SHORT: Record<string, string> = {
  "date-iso": "Date · ISO", "date-eu": "Date · EU", "date-us": "Date · US",
  "num-us": "Number", "num-eu": "Number · EU", "cur-eur": "Currency · €", "cur-usd": "Currency · $",
};

// ── Recursive node editor ──────────────────────────────────────────────────────

function NodeEditor({
  node, path, lineScope, onUpdate, sourceTokens, isRoot, xml, rootHasNamespaces,
}: {
  node: OutputNode;
  path: number[];
  lineScope: boolean;
  onUpdate: (fn: (n: OutputNode) => OutputNode) => void;
  sourceTokens: ReadonlyArray<SourceToken>;
  isRoot?: boolean;
  /** True when the tree's format is XML — gates the per-node namespace/prefix authoring. */
  xml?: boolean;
  /** True when the template carries root-level namespaces — per-node authoring is hidden then
   *  (the two modes are mutually exclusive; the emitter throws if both are set). */
  rootHasNamespaces?: boolean;
}) {
  const isContainer = node.nodeType === "object" || node.nodeType === "array";
  const childScope = lineScope || node.nodeType === "array";

  // Which inline editor (if any) is open for THIS row. Only one open at a time keeps the row clean.
  const [editing, setEditing] = useState<null | "name" | "format" | "condition" | "namespace">(null);
  const [hover, setHover] = useState(false);
  // P-1 progressive disclosure: the developer-grade controls (a hand-typed "only include when"
  // predicate + XML namespace prefix/URI) are collapsed behind a per-node "Advanced" toggle so a
  // procurement coordinator sees only name + source + format by default. Default collapsed, BUT
  // auto-expanded (lazy initializer) when this node ALREADY carries advanced data — a non-empty
  // includeWhen or a bound namespace/prefix — so editing an existing config never hides data out
  // from under the user. Local row state; one toggle per node.
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !!node.includeWhen || (node.namespace ?? "") !== "" || (node.prefix ?? "") !== "",
  );

  const updateName = (name: string) => onUpdate((n) => updateAt(n, path, (x) => ({ ...x, name })));
  const remove = () => onUpdate((n) => removeAt(n, path));
  const addChild = (child: OutputNode) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, children: [...(x.children ?? []), child] })));
  // Bind a node to ONE source: a canonical field, a SOURCE token (bare id), or a fixed value — the
  // three are mutually exclusive, so setting one nulls the other two. The format manipulators are
  // preserved across a rebind.
  const setBinding = (key: "canonicalField" | "sourceToken" | "fixedValue", value: string | null) =>
    onUpdate((n) => updateAt(n, path, (x) => ({
      ...x,
      rule: {
        outputPath: x.name,
        canonicalField: key === "canonicalField" ? value : null,
        sourceToken: key === "sourceToken" ? value : null,
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
      return { ...x, rule: { outputPath: x.name, canonicalField: x.rule?.canonicalField ?? null, sourceToken: x.rule?.sourceToken ?? null, fixedValue: x.rule?.fixedValue ?? null, fieldManipulators: manis } };
    }));

  // Set/clear this node's XML namespace + prefix (delegates the prefix-without-uri guard to the model).
  const setNamespace = (namespace: string, prefix: string) =>
    onUpdate((n) => updateAt(n, path, (x) => setNodeNamespace(x, namespace, prefix)));

  const canonicalOptions = childScope ? CANONICAL_LINE_FIELDS : CANONICAL_HEADER_FIELDS;
  const boundCanonical = node.rule?.canonicalField ?? "";
  const boundToken = node.rule?.sourceToken ?? "";
  const usingFixed = node.rule?.fixedValue != null && !boundCanonical && !boundToken;
  const bound = !!boundCanonical || !!boundToken || usingFixed;
  const presetKey = currentPreset(node.rule?.fieldManipulators);
  const hasCondition = !!node.includeWhen;
  // Per-node XML namespace authoring is offered only for XML trees, on element/attribute nodes, and
  // only when the LEGACY root-map mode is NOT in use (mutually exclusive — the emitter throws if both).
  const nsAllowed = !!xml && !rootHasNamespaces && node.nodeType !== "array";
  const nsUri = node.namespace ?? "";
  const nsPrefix = node.prefix ?? "";
  const hasNamespace = nsUri !== "" || nsPrefix !== "";
  // The pill shows the prefix when set (cbc:), else "default ns" for an unprefixed default namespace.
  const nsPillLabel = nsPrefix !== "" ? `xmlns · ${nsPrefix}` : "default ns";
  // "Only include when…" is meaningful on any non-root node (a list ITEM uses it to drop lines).
  const scopeHint = childScope ? "line" : "order";
  const pill = TYPE_PILL[node.nodeType];

  return (
    <div style={{ paddingLeft: isRoot ? 0 : 18, marginTop: isRoot ? 0 : 4 }}>
      {/* ── The clean single-line row: type pill · name · binding pill · (format/condition pills) · × ── */}
      <div
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 38,
          padding: "5px 8px 5px 10px", borderRadius: 9,
          border: `1px solid ${isContainer ? "#E6EAF1" : "#ECEFF4"}`,
          background: isContainer ? "#FBFCFE" : "#FFFFFF",
          // Left status bar (§7.2): green=mapped / violet=fixed / grey=unset/container.
          boxShadow: `inset 3px 0 0 0 ${isContainer ? "#D8DEE9" : usingFixed ? "#6F4FCE" : (boundCanonical || boundToken) ? GREEN : "#E5E8EE"}`,
        }}>
        {/* Type pill */}
        <span title={node.nodeType} style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 11, fontWeight: 700, color: pill.fg, background: pill.bg, border: `1px solid ${pill.border}`, borderRadius: 5, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 7px", minWidth: 34 }}>
          {pill.glyph}
        </span>

        {/* Node name — read-only mono text by default; click to edit inline. */}
        {editing === "name" ? (
          <input autoFocus value={node.name} onChange={(e) => updateName(e.target.value)}
            onBlur={() => setEditing(null)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(null); }}
            aria-label="Node name"
            style={{ flex: "1 1 110px", minWidth: 0, height: 26, border: `1px solid ${BLUE}`, borderRadius: 6, padding: "0 7px", fontSize: 13, fontWeight: 700, fontFamily: MONO }} />
        ) : (
          <button onClick={() => setEditing("name")} aria-label={`Edit name (${node.name})`} title="Click to rename"
            style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "100%", textAlign: "left", border: "1px solid transparent", background: "transparent", borderRadius: 6, padding: "2px 4px", cursor: "pointer", fontFamily: MONO, fontSize: 13, fontWeight: 700, color: NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {node.name}
          </button>
        )}

        {/* Binding (value nodes + attributes only — containers carry no value). The picker offers
            EVERY source field (canonical first, then "More source fields…" for the raw token
            universe — F-1) plus a fixed value, and reports the chosen binding inline. */}
        {!isContainer && (
          <FixedValueOrPicker
            node={node}
            usingFixed={usingFixed}
            canonicalOptions={canonicalOptions}
            sourceTokens={sourceTokens}
            onPickCanonical={(f) => setBinding("canonicalField", f)}
            onPickSourceToken={(id) => setBinding("sourceToken", id)}
            onPickFixed={() => setBinding("fixedValue", node.rule?.fixedValue ?? "")}
            onChangeFixed={(v) => setBinding("fixedValue", v)}
            onClear={() => setBinding("canonicalField", null)}
          />
        )}

        {/* Compact pills (only render when SET) — format + condition. Each is click-to-edit with a ×. */}
        {!isContainer && bound && presetKey && (
          <SetPill tone="green" label={PRESET_SHORT[presetKey] ?? "Format"}
            title="Click to change formatting" onClick={() => setEditing("format")} onClear={() => setFormatPreset("")} clearLabel="Remove formatting" />
        )}
        {/* Condition + namespace SetPills stay visible whenever SET (so set data is always glanceable),
            but editing them lives behind Advanced — clicking the pill opens Advanced first. */}
        {!isRoot && hasCondition && (
          <SetPill tone="blue" mono label={`only when · ${node.includeWhen}`}
            title="Click to edit the condition" onClick={() => { setAdvancedOpen(true); setEditing("condition"); }} onClear={() => updateIncludeWhen("")} clearLabel="Remove condition" />
        )}
        {/* XML namespace pill (element/attribute nodes only) — shown when a namespace is bound. */}
        {nsAllowed && hasNamespace && (
          <SetPill tone="blue" mono label={nsPillLabel}
            title="Click to edit this element's XML namespace" onClick={() => { setAdvancedOpen(true); setEditing("namespace"); }}
            onClear={() => setNamespace("", "")} clearLabel="Remove namespace" />
        )}

        {/* Spacer pushes add-affordances + delete to the right edge. */}
        <span style={{ flex: "1 1 auto" }} />

        {/* Discoverable "+ format" when UNSET — hover/focus-revealed. Format stays an EVERYDAY
            control (not behind Advanced): a coordinator routinely formats dates/numbers/currency. */}
        {!isContainer && bound && !presetKey && (
          <GhostAdd label="+ format" title="Format this value as a date, number, or currency"
            visible={hover || editing === "format"} onClick={() => setEditing("format")} />
        )}

        {/* P-1 Advanced disclosure (per node, collapsed by default). Only rendered when this node
            actually has an advanced control available — a condition (any non-root node) or an XML
            namespace (XML element/attribute nodes). The developer-grade "+ condition" / "+ namespace"
            authoring affordances live INSIDE it; the inline editors render below the row when open. */}
        {(!isRoot || nsAllowed) && (
          advancedOpen ? (
            <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {!isRoot && !hasCondition && (
                <GhostAdd label="+ condition" title="Only include this when a rule is true"
                  visible onClick={() => setEditing("condition")} />
              )}
              {nsAllowed && !hasNamespace && (
                <GhostAdd label="+ namespace" title="Put this element in an XML namespace (e.g. cbc:)"
                  visible onClick={() => setEditing("namespace")} />
              )}
              <button onClick={() => { setAdvancedOpen(false); if (editing === "condition" || editing === "namespace") setEditing(null); }}
                title="Hide advanced options" aria-label="Hide advanced options" aria-expanded
                style={{ flex: "0 0 auto", height: 22, padding: "0 8px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: SLATE, fontSize: 10.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                Advanced ▾
              </button>
            </span>
          ) : (
            <button onClick={() => setAdvancedOpen(true)}
              title="Conditions and XML namespaces" aria-label="Show advanced options" aria-expanded={false}
              style={{ flex: "0 0 auto", height: 22, padding: "0 8px", borderRadius: 6, border: "1px dashed #D8DEE9", background: "transparent", color: SLATE, fontSize: 10.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: hover ? 1 : 0, transition: "opacity 120ms ease", pointerEvents: hover ? "auto" : "none" }}>
              Advanced ▸
            </button>
          )
        )}

        {/* Inline delete — a small ghost ×, hover/focus-revealed (not a permanent full-width line). */}
        {!isRoot && (
          <button onClick={remove} aria-label="Remove node" title="Remove"
            onFocus={() => setHover(true)} onBlur={() => setHover(false)}
            style={{ flex: "0 0 auto", height: 24, width: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "var(--danger, #B43838)", fontSize: 13, cursor: "pointer", opacity: hover ? 1 : 0.35, transition: "opacity 120ms ease" }}>
            ✕
          </button>
        )}
      </div>

      {/* Inline format picker (popover row) — opens under the row only while editing. */}
      {!isContainer && editing === "format" && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, marginLeft: 18, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: SLATE }}>Format as</span>
          <select autoFocus value={presetKey} onChange={(e) => setFormatPreset(e.target.value)}
            onBlur={() => setEditing(null)} aria-label="Value format"
            style={{ height: 28, border: `1px solid ${BLUE}`, borderRadius: 6, padding: "0 6px", fontSize: 12, color: presetKey ? NAVY : SLATE }}>
            {FORMAT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button onClick={() => setEditing(null)} style={{ height: 28, padding: "0 8px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, cursor: "pointer" }}>done</button>
        </div>
      )}

      {/* Inline condition editor — OutputNode.includeWhen (a bare predicate; node/line skipped when false).
          The raw predicate is the power-user escape hatch; a one-line plain example sits under it so a
          non-technical user knows what to type (not a full query builder — out of scope here). */}
      {!isRoot && editing === "condition" && (
        <div style={{ marginTop: 4, marginLeft: 18 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: SLATE, whiteSpace: "nowrap" }}>only include when</span>
            <input autoFocus value={node.includeWhen ?? ""} onChange={(e) => updateIncludeWhen(e.target.value)}
              onBlur={() => setEditing(null)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(null); }}
              placeholder={`e.g. ${scopeHint}.Quantity > 0`} aria-label="Only include when (condition)"
              spellCheck={false}
              style={{ flex: "1 1 200px", minWidth: 0, height: 28, border: `1px solid ${node.includeWhen ? BLUE : BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO, color: node.includeWhen ? NAVY : SLATE }} />
          </div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 4, lineHeight: 1.5 }}>
            Only include this when a condition is true — e.g. include the {scopeHint} only when quantity is above zero:{" "}
            <code style={{ fontFamily: MONO, color: NAVY }}>{scopeHint}.Quantity &gt; 0</code>
          </div>
        </div>
      )}

      {/* Inline XML namespace editor — author prefix + namespace URI so this element emits e.g. <cbc:ID>
          (prefix "cbc") or sits in a default namespace (blank prefix). Local draft so a half-typed
          prefix survives until the URI is entered (the model clears a prefix-without-URI on persist —
          a prefix needs a namespace). XML-only. */}
      {nsAllowed && editing === "namespace" && (
        <NamespaceEditorRow prefix={nsPrefix} uri={nsUri}
          onChange={(uri, prefix) => setNamespace(uri, prefix)} onDone={() => setEditing(null)} />
      )}

      {isContainer && (
        <>
          <div style={{ marginTop: 4, borderLeft: isRoot ? "none" : "2px solid #ECEFF4", marginLeft: isRoot ? 0 : 4, paddingLeft: isRoot ? 0 : 2 }}>
            {(node.children ?? []).map((c, i) => (
              <NodeEditor key={i} node={c} path={[...path, i]} lineScope={childScope} onUpdate={onUpdate}
                sourceTokens={sourceTokens} xml={xml} rootHasNamespaces={rootHasNamespaces} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5, marginLeft: isRoot ? 0 : 18, flexWrap: "wrap" }}>
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

// The node's source binding: the F-1 OutputSourcePicker (canonical first, then "More source
// fields…" for the raw token universe + "= Fixed value…") rendered as a compact green pill, plus an
// inline fixed-value text input shown only while the node is bound to a fixed value.
function FixedValueOrPicker({
  node, usingFixed, canonicalOptions, sourceTokens,
  onPickCanonical, onPickSourceToken, onPickFixed, onChangeFixed, onClear,
}: {
  node: OutputNode;
  usingFixed: boolean;
  canonicalOptions: ReadonlyArray<string>;
  sourceTokens: ReadonlyArray<SourceToken>;
  onPickCanonical: (f: string) => void;
  onPickSourceToken: (id: string) => void;
  onPickFixed: () => void;
  onChangeFixed: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <OutputSourcePicker
        outputPath={node.name}
        binding={node.rule ?? {}}
        canonicalFields={canonicalOptions}
        sourceTokens={sourceTokens}
        onPickCanonical={onPickCanonical}
        onPickSourceToken={onPickSourceToken}
        onPickFixed={onPickFixed}
        onClear={onClear}
        compact
      />
      {usingFixed && (
        <input value={node.rule?.fixedValue ?? ""} onChange={(e) => onChangeFixed(e.target.value)}
          placeholder="value" aria-label="Fixed value"
          style={{ width: 110, height: 26, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO }} />
      )}
    </span>
  );
}

// A compact "this is set" pill: a colored label + a tiny × to clear. Clicking the label edits inline.
function SetPill({ tone, label, mono, title, onClick, onClear, clearLabel }: {
  tone: "green" | "blue"; label: string; mono?: boolean; title: string;
  onClick: () => void; onClear: () => void; clearLabel: string;
}) {
  const c = tone === "green"
    ? { fg: GREEN_DEEP, bg: "#F1F8F2", border: "#CDE7D1" }
    : { fg: "#0F4FA8", bg: "#EEF3FB", border: "#D5E3F6" };
  return (
    <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", height: 22, borderRadius: 999, border: `1px solid ${c.border}`, background: c.bg, maxWidth: 280, overflow: "hidden" }}>
      <button onClick={onClick} title={title} aria-label={`${label}. ${title}.`}
        style={{ display: "inline-flex", alignItems: "center", height: "100%", padding: "0 4px 0 9px", border: "none", background: "transparent", color: c.fg, fontFamily: mono ? MONO : "inherit", fontSize: mono ? 10.5 : 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </button>
      <button onClick={onClear} aria-label={clearLabel} title={clearLabel}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: "100%", width: 20, border: "none", background: "transparent", color: c.fg, fontSize: 11, cursor: "pointer", opacity: 0.65 }}>
        ✕
      </button>
    </span>
  );
}

// Low-emphasis "add this capability" ghost button — revealed on row hover/focus so the row stays clean.
function GhostAdd({ label, title, visible, onClick }: { label: string; title: string; visible: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      style={{ flex: "0 0 auto", height: 22, padding: "0 8px", borderRadius: 6, border: "1px dashed #D8DEE9", background: "transparent", color: SLATE, fontSize: 10.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: visible ? 1 : 0, transition: "opacity 120ms ease", pointerEvents: visible ? "auto" : "none" }}>
      {label}
    </button>
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  // Chip height (22) matches the mapper's add-field chips; the row wraps so these never scroll sideways.
  return (
    <button onClick={onClick} style={{ height: 24, padding: "0 11px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#F7F9FC", color: "#3A4A60", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
  );
}

// ── Inline per-node namespace editor ────────────────────────────────────────────
// Local draft so a half-typed prefix isn't discarded before the URI is entered: setNodeNamespace
// clears a prefix-without-URI on the persisted node (the emitter rejects that half-state), but the
// user must still be able to type the prefix first. We hold prefix+uri locally and push (uri, prefix)
// to the node on every keystroke; the node persists only a valid pair, the draft keeps the typed
// prefix visible. Seeded once — the row remounts each time the editor is opened.
function NamespaceEditorRow({ prefix, uri, onChange, onDone }: {
  prefix: string; uri: string;
  onChange: (uri: string, prefix: string) => void;
  onDone: () => void;
}) {
  // Seeded once — the row remounts each time the editor opens, so no re-sync effect is needed.
  const [p, setP] = useState(prefix);
  const [u, setU] = useState(uri);
  const change = (nextPrefix: string, nextUri: string) => {
    setP(nextPrefix); setU(nextUri);
    onChange(nextUri, nextPrefix);
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, marginLeft: 18, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: SLATE, whiteSpace: "nowrap" }}>prefix</span>
      <input autoFocus value={p} onChange={(e) => change(e.target.value, u)}
        placeholder="cbc" aria-label="XML namespace prefix" spellCheck={false}
        style={{ width: 70, height: 28, border: `1px solid ${p ? BLUE : BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO, color: p ? NAVY : SLATE }} />
      <span style={{ fontSize: 11, color: SLATE, whiteSpace: "nowrap" }}>namespace URI</span>
      <input value={u} onChange={(e) => change(p, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onDone(); }}
        placeholder="urn:oasis:names:…:CommonBasicComponents-2" aria-label="XML namespace URI" spellCheck={false}
        style={{ flex: "1 1 220px", minWidth: 0, height: 28, border: `1px solid ${u ? BLUE : BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO, color: u ? NAVY : SLATE }} />
      <button onClick={onDone} style={{ height: 28, padding: "0 8px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, cursor: "pointer" }}>done</button>
    </div>
  );
}

// ── Root XML namespaces (prefix → uri) editor ───────────────────────────────────
// Authors template.namespaces — the LEGACY root-map mode: each row becomes an xmlns:{prefix}="{uri}"
// declaration on the root element while the element names stay unprefixed. Local row state keeps
// typing smooth; every change commits up via onChange (which drops incomplete rows + nulls an empty
// map, so a cleared editor saves byte-identical). Collapsed by default so it doesn't clutter the
// common non-namespaced case.
function RootNamespacesEditor({ rows, onChange }: {
  rows: NamespaceRow[];
  onChange: (rows: NamespaceRow[]) => void;
}) {
  // `draft` is the editing source of truth so in-progress (still-blank) rows survive — the parent
  // commit drops incomplete rows + nulls an empty map (byte-identical clear), so a freshly-added
  // blank row would round-trip back as `[]` and vanish if we mirrored the parent blindly. We re-sync
  // from upstream ONLY when its COMPLETED projection differs from ours (a genuine external change,
  // e.g. a sample was inferred), comparing on the same blank-dropping rule the parent uses.
  const [open, setOpen] = useState(rows.length > 0);
  const [draft, setDraft] = useState<NamespaceRow[]>(rows);
  const committedSig = (rs: NamespaceRow[]) => JSON.stringify(rowsToNamespaces(rs));
  const ours = useRef<string>(committedSig(rows));
  useEffect(() => {
    if (committedSig(rows) !== ours.current) {
      ours.current = committedSig(rows);
      setDraft(rows);
      if (rows.length > 0) setOpen(true);
    }
  }, [rows]);

  const commit = (next: NamespaceRow[]) => { setDraft(next); ours.current = committedSig(next); onChange(next); };
  const setRow = (i: number, patch: Partial<NamespaceRow>) =>
    commit(draft.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => { setOpen(true); commit([...draft, { prefix: "", uri: "" }]); };
  const removeRow = (i: number) => commit(draft.filter((_, idx) => idx !== i));

  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", height: 30, padding: "0 10px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#F7F9FC", color: NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
        <span>XML namespaces{draft.length > 0 ? ` · ${draft.length}` : ""}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: SLATE, fontWeight: 500 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, background: "#F7F9FC" }}>
          <div style={{ fontSize: 11, color: SLATE, marginBottom: 8, lineHeight: 1.5 }}>
            Declare <code style={{ fontFamily: MONO }}>xmlns:</code> prefixes on the root element (e.g.{" "}
            <code style={{ fontFamily: MONO }}>cbc</code> →{" "}
            <code style={{ fontFamily: MONO }}>urn:oasis:names:…:CommonBasicComponents-2</code>).
          </div>
          {draft.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <input value={r.prefix} onChange={(e) => setRow(i, { prefix: e.target.value })}
                placeholder="cbc" aria-label={`Namespace prefix ${i + 1}`} spellCheck={false}
                style={{ width: 70, height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO }} />
              <input value={r.uri} onChange={(e) => setRow(i, { uri: e.target.value })}
                placeholder="urn:oasis:names:…:CommonBasicComponents-2" aria-label={`Namespace URI ${i + 1}`} spellCheck={false}
                style={{ flex: "1 1 200px", minWidth: 0, height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO }} />
              <button onClick={() => removeRow(i)} aria-label={`Remove namespace ${i + 1}`} title="Remove"
                style={{ height: 28, width: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: "var(--danger, #B43838)", fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          ))}
          <button onClick={addRow}
            style={{ height: 24, padding: "0 11px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#FFF", color: "#3A4A60", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ namespace</button>
        </div>
      )}
    </div>
  );
}
