"use client";

// OutputStructureDesigner — Phase C: the visual editor for the OutputNode tree.
// Build a supplier's exact required STRUCTURE (nesting, repeating line groups, attributes, custom
// names) and see the live output. Self-contained: it previews + saves the order's mapping override
// with `outputTree` set (the backend renders it as the highest-precedence output mode, and the
// preview == the delivered bytes). Functional first version — form-based tree editing; drag/reorder
// polish is a follow-up.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewMappingOverride, upsertMappingOverride, inferOutputStructure, getSourceTokens, apiClient } from "@/lib/api-client";
import { OutputSourcePicker } from "./OutputSourcePicker";
import { withBinding, withFormatManipulator, type BindingKey } from "./outputRuleModel";
import type { CsvDialect } from "@/lib/api/types";
import { moveAt, canMoveAt } from "./outputNamespaceModel";
import {
  updateAt, removeAt, setNodeNamespace,
  namespacesToRows, rowsToNamespaces, templateHasRootNamespaces, treeHasPerNodeNamespaces,
  type NamespaceRow,
} from "./outputNamespaceModel";
import {
  buildPredicate, parsePredicate, operatorsForField, operatorTakesValue,
  OPERATOR_LABELS, type ConditionOperator, type ConditionScope, type StructuredCondition,
} from "./outputConditionModel";
import {
  NAMESPACE_PRESETS, applyNamespacePreset, detectNamespacePreset,
  hoistPerNodeNamespaces, clearRootNamespaces, type NamespacePresetId,
} from "./outputNamespacePresets";
import {
  collectLayoutProblems, collectOrderProblems, blocksSave, problemCounts,
  isRenderableTreeFormat, formatLabel, type DesignProblem,
} from "./outputTreeProblems";
import {
  BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS,
  type OrderMappingOverride, type OutputNode, type OutputNodeTemplate,
  type OutputNodeType, type OutputFormat, type SourceToken,
} from "@/lib/api/types";
import { useConfirm } from "@/components/ui/confirm";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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
 * Which of the three authorable shapes a format EDITS AS — the XML namespace controls, the CSV
 * dialect panel, and the per-column condition rules all key off this.
 *
 * **This is a display function and nothing else.** It used to be applied while SEEDING state from
 * `initialTree`, and `save()` writes the seeded tree verbatim, so merely opening a cXML layout and
 * pressing Save rewrote it to `xml` — data loss with no consent (WP-16). Worse than it looks: the
 * backend then requires a layout's format to EQUAL the connection's delivery format, so the
 * rewritten `xml` layout was silently dropped at transform time and the fixed cXML transform
 * delivered instead. A loud, findable failure became a silent no-op.
 *
 * The seed and save paths now carry `format` through untouched. A format the node tree cannot render
 * surfaces as a blocking bar with three explicit choices (see `FormatForkBar`) instead of being
 * quietly rewritten underneath the author.
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
const GREEN = "#2E8E3A";       // brand-green — borders / bound-field accent
const GREEN_BTN = "#297F34";   // solid fill under white text — ≈4.6:1 AA (2E8E3A was 4.16:1)
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

/** The reorder buttons' shared look — a ghost chip that only asserts itself on hover/focus. */
function moveBtnStyle(hover: boolean, enabled: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto", height: 24, width: 20,
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, border: "1px solid transparent", background: "transparent",
    color: SLATE, fontSize: 12, lineHeight: 1,
    cursor: enabled ? "pointer" : "default",
    // Disabled ends stay visible but recede, so the control's range is legible at a
    // glance rather than appearing and disappearing as rows move.
    opacity: enabled ? (hover ? 1 : 0.35) : 0.15,
    transition: "opacity 120ms ease",
  };
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
  // Seed from the saved/passed tree VERBATIM. The format is deliberately not coerced here: coercing
  // on open is how a cXML layout used to be rewritten to `xml` by nothing more than opening it and
  // pressing Save. A format the tree cannot render is surfaced by `FormatForkBar` and blocks the
  // save until a human chooses; it is never changed on their behalf.
  const [tree, setTree] = useState<OutputNodeTemplate>(initialTree ?? defaultTree("json"));
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
  // What the last reorder did, read by the tree's single live region.
  const [announcement, setAnnouncement] = useState("");
  const [treeRevision, setTreeRevision] = useState(0);
  // The `data-move` id to re-focus once the post-reorder remount has painted.
  const pendingFocus = useRef<string | null>(null);

  /**
   * A reorder remounts the tree, then puts focus back on the same control at the node's
   * NEW position. Both halves are needed, and for different reasons:
   *
   *  - the REMOUNT destroys per-row state (open inline editor, Advanced, hover) that
   *    index keys would otherwise leave pointing at the wrong node — which silently
   *    renames it;
   *  - the REFOCUS is what makes a second press move the SAME node again. Without it a
   *    keyboard user pressing Alt+↓ twice moves the node down and then moves its new
   *    neighbour back up, and the tree returns to where it started.
   */
  const onNodeMoved = useCallback((focusTarget: string) => {
    pendingFocus.current = focusTarget;
    setTreeRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (document.querySelector(`[data-move="${target}"]`) as HTMLElement | null)?.focus();
  }, [treeRevision]);

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
      // Founder ruling 2026-07-31: a layout created from here on defaults to CRLF.
      // Applied ONLY to a freshly inferred tree — an existing supplier's tree opened
      // for editing keeps its absent dialect, and absent still means "the bytes you
      // already receive". Defaulting on the edit path instead would change every
      // existing CSV supplier's output the first time anyone opened their layout.
      const withCsvDefault = designerFormat(inferred.format) === "csv" && !inferred.csvDialect
        ? { ...inferred, csvDialect: { lineEnding: "\r\n" } }
        : inferred;
      // The inferrer accepts a cXML/UBL sample and stamps that format onto the tree, which nothing
      // downstream can render. Coercing it to `xml` here would hide that behind a layout that then
      // gets silently dropped at delivery, so the inferred format is carried through and the fork
      // bar asks.
      setTree(withCsvDefault);
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

  /** Pick a namespace set instead of transcribing URIs. `custom` only reveals the rows. */
  const setNamespacePreset = useCallback((id: NamespacePresetId) => {
    setTree((t) => applyNamespacePreset(t, id));
    setSaved(false); setDirty(true);
  }, []);

  const isXml = designerFormat(tree.format) === "xml";
  const isCsv = designerFormat(tree.format) === "csv";
  const hasPerNodeNs = treeHasPerNodeNamespaces(tree.root);
  const hasRootNs = templateHasRootNamespaces(tree);
  const renderable = isRenderableTreeFormat(tree.format);

  // ── Design-time validation ─────────────────────────────────────────────────
  // The ORDER is fetched for one reason: `OutputTemplateEmitter` runs `GuardResolved` on the tree
  // path while all six fixed transforms run `OutputFieldValidator`, which also refuses a negative
  // unit price and a non-positive quantity. Those two checks are what a designed layout has always
  // skipped, so the same order a fixed transform refuses delivered silently through a layout.
  const { data: order } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    staleTime: 30_000,
    retry: 1,
  });

  const layoutProblems = useMemo(() => collectLayoutProblems(tree), [tree]);
  const orderProblems = useMemo(() => collectOrderProblems(order?.lines ?? []), [order]);
  const problems = useMemo(() => [...layoutProblems, ...orderProblems], [layoutProblems, orderProblems]);
  // Only a LAYOUT problem stops a save. An order that is not ready is not a broken layout, and
  // blocking on it would stop work that delivers today (founder ruling 2026-07-31).
  const blocked = blocksSave(layoutProblems);
  const counts = problemCounts(problems);

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
    // The guard lives here as well as on the button's `disabled`, because a blocked save is a
    // correctness rule, not a styling one — and a disabled button is the kind of thing a later edit
    // quietly turns into a tooltip.
    if (blocked) return;
    setSaving(true);
    try {
      const override: OrderMappingOverride = { ...(baseOverride ?? { customFields: [] }), outputTree: tree };
      await upsertMappingOverride(orderId, override);
      setSaved(true); setDirty(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [tree, orderId, baseOverride, onSaved, blocked]);

  /**
   * The consented half of what `designerFormat()` used to do silently. The author is told exactly
   * what they lose — the standard's envelope, which the receiving system validates before it looks
   * at the order — and the format only changes if they say yes.
   */
  const convertToXml = useCallback(async () => {
    const label = formatLabel(tree.format);
    const ok = await confirm({
      title: `Turn this into a plain XML layout?`,
      description: `This will keep your tags and nesting but produce plain XML, without the ${label} envelope. Your supplier may reject it.`,
      confirmLabel: "Convert to XML",
      cancelLabel: `Keep it as ${label}`,
    });
    if (!ok) return;
    setTree((t) => ({ ...t, format: "xml" }));
    setSaved(false); setDirty(true);
  }, [tree.format, confirm]);

  /** Drop the layout entirely, so the supplier's own dedicated transform is unambiguously in charge. */
  const removeLayout = useCallback(async () => {
    const label = formatLabel(tree.format);
    const ok = await confirm({
      title: "Remove this layout?",
      description: `This order will be built by ProcuLink's own ${label} builder instead. The layout is deleted.`,
      confirmLabel: "Remove layout",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await upsertMappingOverride(orderId, { ...(baseOverride ?? { customFields: [] }), outputTree: null });
      setDirty(false);
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [tree.format, confirm, orderId, baseOverride, onSaved, onClose]);

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

  // Modal a11y. Escape routes through requestClose, so a dirty tree still asks
  // before discarding. The hook's foreign-layer bail-out is what keeps that
  // working: `confirm()` mounts a Radix <AlertDialog> portaled to <body>, and
  // without the bail-out this handler would eat the Escape meant for it.
  // Mounted only while open, so `open` is constant true.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y({ open: true, onClose: requestClose, panelRef });

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Design output structure"
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
                // Compared against the RAW format, not the display coercion: when the layout is
                // saved as cXML none of the three is the truth, so none lights up and the bar below
                // explains. A pill lit for a format the layout is not in is the lie this replaces.
                const selected = (tree.format ?? "").toString().trim().toLowerCase() === f.id;
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

            {/* The format fork. Shown only when the saved format is one the node tree cannot render,
                which is exactly the case that used to be rewritten to "xml" on open. */}
            {!renderable && (
              <FormatForkBar
                format={tree.format}
                supplierId={order?.supplierId ?? null}
                onConvert={() => void convertToXml()}
                onRemove={() => void removeLayout()}
              />
            )}

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
                        style={{ height: 30, padding: "0 14px", borderRadius: 6, border: `1px solid ${GREEN_DEEP}`, background: GREEN_BTN, color: "#FFF", fontSize: 12, fontWeight: 600, cursor: inferring || !sample.trim() ? "default" : "pointer", opacity: inferring || !sample.trim() ? 0.6 : 1 }}>
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
            {!firstRun && isCsv && (
              <CsvDialectEditor
                dialect={tree.csvDialect ?? null}
                onChange={(next) => { setTree((t) => ({ ...t, csvDialect: next })); setSaved(false); setDirty(true); }}
              />
            )}

            {!firstRun && isXml && !hasPerNodeNs && (
              <RootNamespacesEditor
                preset={detectNamespacePreset(tree)}
                rows={namespacesToRows(tree.namespaces)}
                onPreset={setNamespacePreset}
                onChange={setRootNamespaces}
              />
            )}
            {/* Both namespace modes at once is a state the emitter THROWS on. The old copy named the
                problem, told the user to "clear the per-element namespaces", and gave them no control
                that did it — at 4.39:1, below AA. Now it is two buttons, either of which leaves the
                exclusivity invariant satisfied without the user having to understand it. */}
            {!firstRun && isXml && hasPerNodeNs && hasRootNs && (
              <div style={{ marginBottom: 12, fontSize: 11.5, color: "#8A5310", background: "#FAF1DD", border: "1px solid #E4C98F", borderRadius: 6, padding: "9px 10px", lineHeight: 1.5 }}>
                This layout sets namespaces both at the top and on individual elements. Pick one place.
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => { setTree(hoistPerNodeNamespaces); setSaved(false); setDirty(true); }}
                    style={{ height: 26, padding: "0 10px", borderRadius: 6, border: "1px solid #C69A4C", background: "#FFF", color: "#8A5310", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                    Move them to the top
                  </button>
                  <button onClick={() => { setTree(clearRootNamespaces); setSaved(false); setDirty(true); }}
                    style={{ height: 26, padding: "0 10px", borderRadius: 6, border: "1px solid #C69A4C", background: "#FFF", color: "#8A5310", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                    Keep them on each element
                  </button>
                </div>
              </div>
            )}

            {/* The editable tree is hidden during first-run (the infer panel owns the screen). */}
            {!firstRun && (
              <NodeEditor key={treeRevision} node={tree.root} path={[]} lineScope={false} onUpdate={setRoot}
                sourceTokens={sourceTokens ?? []} isRoot
                xml={isXml} csv={isCsv} rootHasNamespaces={hasRootNs}
                siblingCount={1} announce={setAnnouncement} onMoved={onNodeMoved} />
            )}

            {/* ONE polite live region for the whole tree (WP-15 · S5).
                Per-row regions race each other and a screen reader reads the wrong
                one, so the announcement is owned here and the rows call up into it.
                Visually hidden rather than `display: none` — a hidden region is not
                announced at all, which would make the boundary case silent again. */}
            <div
              data-testid="designer-announcer"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              style={{
                position: "absolute", width: 1, height: 1, margin: -1, padding: 0,
                overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
              }}
            >
              {announcement}
            </div>
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

        {/* Problems strip — persistent, never a toast, never a modal. One line when clean. */}
        <ProblemsStrip problems={problems} counts={counts} />

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 18px", borderTop: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
          {/* The helper line is desktop-only — on narrow it would push the action buttons off-screen. */}
          {!isNarrow && <span style={{ fontSize: 12, color: "#5A6B82" }}>Bind each value to a field or fixed value · format dates/numbers · &ldquo;only include when&rdquo; to add a field or drop lines conditionally.</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {/* DS Button md sizing: 44px tap target on narrow, dense 32px on desktop. */}
            <button onClick={requestClose}
              style={{ height: isNarrow ? 44 : 32, padding: "0 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: NAVY, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
            {/* A blocked save says WHY on its own label — a bare grey button is a dead end, and the
                reason is already written one row above in the problems strip. */}
            <button onClick={() => void save()} disabled={saving || blocked}
              aria-describedby={blocked ? "osd-problems" : undefined}
              onMouseEnter={(e) => { if (!saving && !blocked) e.currentTarget.style.background = GREEN_DEEP; }}
              onMouseLeave={(e) => { if (!blocked) e.currentTarget.style.background = GREEN_BTN; }}
              style={{ height: isNarrow ? 44 : 32, padding: "0 18px", borderRadius: 6, border: "none", background: blocked ? "#8A93A5" : GREEN_BTN, color: "#FFF", fontSize: 13, fontWeight: 600, cursor: saving || blocked ? "default" : "pointer", opacity: saving ? 0.7 : 1, transition: "background 150ms ease" }}>
              {blocked
                ? `Fix ${counts.problems} ${counts.problems === 1 ? "problem" : "problems"} to save`
                : saving ? "Saving…" : saved ? "✓ Saved" : "Save structure"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The format fork ─────────────────────────────────────────────────────────────
/**
 * Shown when the saved layout is in a format the node tree cannot render — cXML, UBL, X12, EDIFACT.
 *
 * This bar is the whole of WP-16's fourth item. The old behaviour was to coerce the format to `xml`
 * while seeding state and then save that, so opening a cXML layout and pressing Save rewrote it with
 * no consent and no notice. Three things make that unacceptable rather than merely untidy:
 *
 *  - **The rewrite is not a downgrade, it is a disappearance.** The backend requires a layout's
 *    format to EQUAL the connection's delivery format. A cXML supplier with an `xml` layout has the
 *    layout silently dropped at transform time and the fixed cXML transform delivers instead — so
 *    the author's work stops applying and nothing says so.
 *  - **A cXML or X12 layout may exist to carry envelope identity**, which the dedicated transform
 *    reads. Rewriting the format throws that away.
 *  - **Leaving it alone is also wrong**: the emitter throws on delivery, which is the failure the
 *    author should have seen here.
 *
 * So: keep the format, block the save, and offer the three real answers. `Turn this into a plain XML
 * layout` is the consented version of the old silent behaviour, and it warns first.
 */
function FormatForkBar({ format, supplierId, onConvert, onRemove }: {
  format: OutputFormat | string;
  supplierId: string | null;
  onConvert: () => void;
  onRemove: () => void;
}) {
  const label = formatLabel(format);
  const btn: React.CSSProperties = {
    height: 28, padding: "0 11px", borderRadius: 6, border: "1px solid #C58C8C",
    background: "#FFF", color: "#95302F", fontSize: 12, fontWeight: 600, cursor: "pointer",
    textDecoration: "none", display: "inline-flex", alignItems: "center",
  };
  return (
    <div style={{ marginBottom: 12, border: "1px solid #E8B7B7", background: "#FAE6E6", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#95302F" }}>
        This layout is saved as {label}, which can&rsquo;t be built from a layout.
      </div>
      <div style={{ fontSize: 12, color: "#7A3A3A", marginTop: 4, lineHeight: 1.55 }}>
        {label} carries an envelope — sender and receiver identifiers, a version, a document type —
        that the receiving system checks <em>before</em> it looks at your order. ProcuLink builds
        {" "}{label} itself, so this layout isn&rsquo;t being used. Choose what should happen:
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
        {supplierId && (
          <a href={`/library/suppliers/${supplierId}?tab=delivery`} style={btn}>Set up {label} properly</a>
        )}
        <button onClick={onConvert} style={btn}>Turn this into a plain XML layout</button>
        <button onClick={onRemove} style={btn}>Remove this layout</button>
      </div>
    </div>
  );
}

// ── Problems strip ──────────────────────────────────────────────────────────────
const TIER_STYLE: Record<number, { fg: string; bg: string; border: string; mark: string }> = {
  1: { fg: "#95302F", bg: "#FAE6E6", border: "#E8B7B7", mark: "✕" },
  2: { fg: "#8A5310", bg: "#FAF1DD", border: "#E4C98F", mark: "!" },
  3: { fg: "#8A5310", bg: "#FAF1DD", border: "#E4C98F", mark: "!" },
};

/**
 * The persistent design-time verdict — never a toast, never a modal, collapsed to one line when
 * clean. Every row is a plain sentence, because the reader is a procurement coordinator and the
 * alternative (the emitter's own exception text) names classes they have never heard of.
 *
 * The tiers are the honest part. Today every failure renders as red text in the preview pane, so an
 * order with unresolved lines — not a layout problem at all — reads as "your layout is broken" and
 * sends the operator looking in the wrong place.
 */
function ProblemsStrip({ problems, counts }: {
  problems: readonly DesignProblem[];
  counts: { problems: number; notReady: number; warnings: number };
}) {
  const [open, setOpen] = useState(true);
  const clean = problems.length === 0;

  const parts: string[] = [];
  if (counts.problems) parts.push(`${counts.problems} ${counts.problems === 1 ? "problem" : "problems"}`);
  if (counts.notReady) parts.push(`${counts.notReady} not ready`);
  if (counts.warnings) parts.push(`${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`);

  return (
    <div id="osd-problems"
      // Reserved for a layout blocker appearing — an order that is not ready is not an emergency.
      role={counts.problems > 0 ? "alert" : "status"}
      style={{ borderTop: `1px solid ${BORDER}`, background: clean ? "#F7F9FC" : "#FFFFFF", padding: "8px 18px", maxHeight: 168, overflowY: "auto" }}>
      {clean ? (
        <div style={{ fontSize: 12, color: GREEN_DEEP, fontWeight: 600 }}>✓ This layout will produce a valid file.</div>
      ) : (
        <>
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: counts.problems ? "#95302F" : "#8A5310" }}>
              {parts.join(" · ")}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: SLATE, fontWeight: 600 }}>{open ? "Hide" : "Show"}</span>
          </button>
          {open && (
            <ul style={{ listStyle: "none", margin: "7px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
              {problems.map((p) => {
                const s = TIER_STYLE[p.tier];
                return (
                  <li key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: s.fg, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, padding: "6px 9px" }}>
                    <span aria-hidden style={{ fontWeight: 700, flex: "0 0 auto" }}>{s.mark}</span>
                    <span style={{ minWidth: 0 }}>{p.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Structured condition builder ────────────────────────────────────────────────
/**
 * "Only include when …" as a pick, not a Scriban expression typed into a text box.
 *
 * Two properties make this safe to put in front of a non-developer:
 *
 *  - **The generated predicate is always visible**, in mono, under the controls. The builder is
 *    therefore also the documentation, and a power user graduates to the escape hatch without
 *    needing any.
 *  - **Anything the builder cannot represent stays raw and is never rewritten.** A parser that
 *    half-understands an expression is worse than none: it opens the structured editor on a
 *    predicate it cannot express, and the next save launders the author's expression into an
 *    approximation of it. `parsePredicate` returns null for every such case and this component
 *    shows the text exactly as written.
 *
 * The `>` / `<` operators are offered on numeric fields ONLY. Scriban compares two strings lexically,
 * so `"10" > "9"` is false — a layout built on that drops exactly the lines the author meant to keep
 * and produces a perfectly plausible file, which is why nobody would ever find it.
 */
function ConditionEditor({ value, scope, repeating, csv, onChange, onDone }: {
  value: string | null;
  scope: ConditionScope;
  /** True for the repeating list itself, whose condition drops LINES rather than a single value. */
  repeating: boolean;
  /** True for a per-value condition in a CSV layout, where it cannot do anything. */
  csv: boolean;
  onChange: (next: string) => void;
  onDone: () => void;
}) {
  const fields = scope === "line" ? BINDABLE_LINE_FIELDS : BINDABLE_HEADER_FIELDS;
  const parsed = parsePredicate(value, scope, fields);
  const hasValue = (value ?? "").trim() !== "";
  // Raw mode is entered two ways: the author asked for it, or the saved expression has no structured
  // shape. The second is not a failure — it is a predicate somebody wrote deliberately.
  const unparseable = hasValue && parsed === null;
  const [raw, setRaw] = useState(unparseable);
  // The builder's working state. Seeded from the parse; the row remounts when the editor reopens.
  const [draft, setDraft] = useState<StructuredCondition>(
    parsed ?? { scope, field: fields[0], operator: "is", value: "" },
  );

  const commitDraft = (next: StructuredCondition) => {
    setDraft(next);
    onChange(buildPredicate(next));
  };

  // A CSV column is present on every row or on none: the header is written once. The control is
  // shown and disabled WITH THE REASON, never silently greyed — a greyed control with no
  // explanation is read as a bug.
  if (csv) {
    return (
      <div style={{ marginTop: 4, marginLeft: 18, fontSize: 11.5, color: SLATE, lineHeight: 1.55, maxWidth: 460 }}>
        A CSV file has the same columns on every row, so a column can&rsquo;t be switched on and off.
        You can leave whole lines out instead — set that on the repeating list.
        <div>
          <button onClick={onDone} style={{ marginTop: 6, height: 26, padding: "0 9px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, cursor: "pointer" }}>done</button>
        </div>
      </div>
    );
  }

  const label = repeating ? "Only include lines when" : "Only include when";
  const operators = operatorsForField(draft.field);

  return (
    <div style={{ marginTop: 4, marginLeft: 18, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, background: "#F7F9FC", maxWidth: 520 }}>
      <div role="radiogroup" aria-label="When to include this" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: hasValue ? 8 : 0 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: NAVY, cursor: "pointer" }}>
          <input type="radio" name={`cond-${scope}-${label}`} checked={!hasValue} aria-label="Always include"
            onChange={() => { onChange(""); setRaw(false); }} />
          Always include
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: NAVY, cursor: "pointer" }}>
          <input type="radio" name={`cond-${scope}-${label}`} checked={hasValue} aria-label={label}
            onChange={() => onChange(buildPredicate(draft))} />
          {label}
        </label>
      </div>

      {hasValue && (raw ? (
        <>
          <input autoFocus value={value ?? ""} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onDone(); }}
            aria-label="Condition expression" spellCheck={false} placeholder={`${scope}.Quantity > 0`}
            style={{ width: "100%", boxSizing: "border-box", height: 28, border: `1px solid ${BLUE}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO, color: NAVY }} />
          {unparseable && (
            <div style={{ fontSize: 11, color: SLATE, marginTop: 5, lineHeight: 1.5 }}>
              This condition was written as an expression, so it&rsquo;s shown as written.
            </div>
          )}
          {!unparseable && (
            <button onClick={() => setRaw(false)}
              style={{ marginTop: 6, height: 24, padding: "0 8px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Use the builder
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select aria-label="Condition field" value={draft.field}
              onChange={(e) => {
                const field = e.target.value;
                // An operator the new field cannot offer would leave the control showing a value with
                // no matching option — the blank-select bug, one control over.
                const ops = operatorsForField(field);
                const operator = ops.includes(draft.operator) ? draft.operator : "is";
                commitDraft({ ...draft, field, operator });
              }}
              style={{ height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 6px", fontSize: 12, maxWidth: 190 }}>
              <optgroup label={scope === "line" ? "Fields from this line" : "Fields from the order"}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </optgroup>
            </select>
            <select aria-label="Condition operator" value={draft.operator}
              onChange={(e) => commitDraft({ ...draft, operator: e.target.value as ConditionOperator })}
              style={{ height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 6px", fontSize: 12 }}>
              {operators.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
            </select>
            {operatorTakesValue(draft.operator) && (
              <input aria-label="Condition value" value={draft.value} spellCheck={false}
                onChange={(e) => commitDraft({ ...draft, value: e.target.value })}
                style={{ flex: "1 1 90px", minWidth: 0, height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 8px", fontSize: 12, fontFamily: MONO }} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 7, flexWrap: "wrap" }}>
            <span data-testid="condition-preview" style={{ fontSize: 11, color: SLATE, fontFamily: MONO }}>
              Rule: {value}
            </span>
            <button onClick={() => setRaw(true)}
              style={{ marginLeft: "auto", height: 24, padding: "0 8px", borderRadius: 6, border: `1px dashed ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Write it as an expression
            </button>
            <button onClick={onDone}
              style={{ height: 24, padding: "0 9px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#FFF", color: SLATE, fontSize: 11, cursor: "pointer" }}>done</button>
          </div>
        </>
      ))}
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
  node, path, lineScope, onUpdate, sourceTokens, isRoot, xml, csv, rootHasNamespaces,
  siblingCount = 1, announce, onMoved,
}: {
  node: OutputNode;
  path: number[];
  lineScope: boolean;
  onUpdate: (fn: (n: OutputNode) => OutputNode) => void;
  sourceTokens: ReadonlyArray<SourceToken>;
  isRoot?: boolean;
  /** How many nodes share this parent — the "of N" in the move announcement. */
  siblingCount?: number;
  /**
   * Called after a successful reorder with the `data-move` id of the control that should
   * hold focus afterwards. The host remounts the tree and re-focuses it; see `move()`.
   */
  onMoved?: (focusTarget: string) => void;
  /**
   * Say what a move did. Passed down rather than owned per row because ONE polite
   * live region for the whole tree is what a screen reader can follow; a region per
   * row races itself and reads the wrong one.
   */
  announce?: (message: string) => void;
  /** True when the tree's format is XML — gates the per-node namespace/prefix authoring. */
  xml?: boolean;
  /** True when the tree's format is CSV — a column cannot be switched on and off per row. */
  csv?: boolean;
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

  // ── Reorder (WP-15 · S5) ───────────────────────────────────────────────────
  // Order is CSV column order and XML element order, both read positionally by the
  // receiver, so this is a content change and not a view preference.
  const index = path.length > 0 ? path[path.length - 1] : 0;
  const canMoveUp = !isRoot && index > 0;
  const canMoveDown = !isRoot && index < siblingCount - 1;

  const move = (delta: -1 | 1) => {
    // A boundary press must SAY something. Silence there is the single most likely
    // reading of "this control is broken", and it is the press people try first.
    if ((delta === -1 && !canMoveUp) || (delta === 1 && !canMoveDown)) {
      announce?.(`${node.name} is already ${delta === -1 ? "first" : "last"}.`);
      return;
    }
    // The rows are keyed by INDEX, so React reconciles them by position: after a swap
    // the component instance, its local state and the focused element all stay put and
    // are re-pointed at a different node. Left alone that is not a polish issue — an
    // inline name editor open on the moved row stays with the POSITION, so the next
    // keystroke renames a node the author never opened and the wrong name is SAVED.
    // The node name is the CSV column header / XML element name, so that reaches the
    // supplier's bytes.
    //
    // `onMoved` remounts the tree (killing every stale row editor) and then restores
    // focus to this same control at the node's NEW path — which also makes a second
    // press move the same node again instead of moving its neighbour back.
    const newPath = [...path.slice(0, -1), index + delta];
    onUpdate((n) => moveAt(n, path, delta));
    announce?.(`${node.name} moved to position ${index + delta + 1} of ${siblingCount}.`);
    onMoved?.(`${newPath.join(".")}:${delta === -1 ? "up" : "down"}`);
  };

  // Alt is the modifier because the bare arrows belong to the browser: inside this
  // tree they scroll, and on a focused control they move between radio/menu items.
  // Alt+Arrow is the same gesture list reorder uses across the platform.
  const onMoveKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
  };
  const addChild = (child: OutputNode) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, children: [...(x.children ?? []), child] })));
  // Bind a node to ONE source: a canonical field, a SOURCE token (bare id), or a fixed value — the
  // three are mutually exclusive, so setting one nulls the other two. The format manipulators are
  // preserved across a rebind.
  const setBinding = (key: BindingKey, value: string | null) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, rule: withBinding(x.rule, x.name, key, value) })));

  const updateIncludeWhen = (value: string) =>
    onUpdate((n) => updateAt(n, path, (x) => ({ ...x, includeWhen: value === "" ? null : value })));

  // Set/clear a value-format preset: keep any non-format manipulators, swap the single format one.
  const setFormatPreset = (key: string) =>
    onUpdate((n) => updateAt(n, path, (x) => ({
      ...x,
      rule: withFormatManipulator(x.rule, x.name, FORMAT_TYPES, FORMAT_PRESETS.find((p) => p.key === key)?.mani ?? null),
    })));

  // Set/clear this node's XML namespace + prefix (delegates the prefix-without-uri guard to the model).
  const setNamespace = (namespace: string, prefix: string) =>
    onUpdate((n) => updateAt(n, path, (x) => setNodeNamespace(x, namespace, prefix)));

  // WP-14: the full bindable set per scope, so the tree designer can reach ShipToCity,
  // ManufacturerPartNumber and the rest — the emitter resolves them from the same row bag.
  const canonicalOptions = childScope ? BINDABLE_LINE_FIELDS : BINDABLE_HEADER_FIELDS;
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

        {/* Reorder — same hover/focus reveal as delete, so the row stays quiet at rest.
            Disabled at each end AND announcing why: `disabled` alone tells a sighted
            user, the announcement tells everyone else. */}
        {!isRoot && (
          <>
            <button
              type="button"
              data-move={`${path.join(".")}:up`}
              onClick={() => move(-1)}
              onKeyDown={onMoveKeyDown}
              // `aria-disabled`, NOT `disabled`. A `disabled` button is out of the tab order and
              // receives neither activation nor key events — so it is barred from firing exactly
              // when the boundary announcement should. That shipped once: the announcing branch had
              // no caller in a browser, and only a synthetic keydown aimed at the disabled element
              // (which jsdom allows and a browser cannot produce) made the test pass. The control
              // stays focusable and clickable; `move()`'s own guard is what stops the tree changing.
              aria-disabled={!canMoveUp}
              aria-label={`Move ${node.name} up`}
              title={canMoveUp ? `Move ${node.name} up (Alt+↑)` : `${node.name} is already first`}
              onFocus={() => setHover(true)} onBlur={() => setHover(false)}
              style={moveBtnStyle(hover, canMoveUp)}>
              ↑
            </button>
            <button
              type="button"
              data-move={`${path.join(".")}:down`}
              onClick={() => move(1)}
              onKeyDown={onMoveKeyDown}
              aria-disabled={!canMoveDown}
              aria-label={`Move ${node.name} down`}
              title={canMoveDown ? `Move ${node.name} down (Alt+↓)` : `${node.name} is already last`}
              onFocus={() => setHover(true)} onBlur={() => setHover(false)}
              style={moveBtnStyle(hover, canMoveDown)}>
              ↓
            </button>
          </>
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

      {/* Structured condition builder — writes `OutputNode.includeWhen`, the same bare predicate a
          hand-author would have typed, with the raw expression always visible underneath and an
          escape hatch for anything the builder has no shape for. */}
      {!isRoot && editing === "condition" && (
        <ConditionEditor
          value={node.includeWhen ?? null}
          scope={scopeHint}
          repeating={node.nodeType === "array"}
          csv={!!csv && node.nodeType !== "array"}
          onChange={updateIncludeWhen}
          onDone={() => setEditing(null)}
        />
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
                sourceTokens={sourceTokens} xml={xml} csv={csv} rootHasNamespaces={rootHasNamespaces}
                siblingCount={(node.children ?? []).length} announce={announce} onMoved={onMoved} />
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

/**
 * The CSV wire details a receiving system cares about (WP-15 · S8).
 *
 * <b>Absent members are left absent.</b> Each control writes its key only when the operator moves
 * it away from the emitter's default, and clearing a control removes the key again. That is not
 * tidiness: the promotion path proves a designed tree by BYTE PARITY, so writing a full dialect the
 * moment this panel is opened would change the output of every existing CSV supplier as soon as
 * somebody looked at their layout.
 */
function CsvDialectEditor({
  dialect, onChange,
}: {
  dialect: CsvDialect | null;
  onChange: (next: CsvDialect | null) => void;
}) {
  const [open, setOpen] = useState(false);

  /** Set one key, dropping it when the value is the emitter's own default. */
  const put = (key: keyof CsvDialect, value: string | boolean | null) => {
    const next: CsvDialect = { ...(dialect ?? {}) };
    if (value === null || value === "") delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    // An object with no keys is not a dialect — hand back null so the tree stays
    // byte-identical to one that never had a dialect at all.
    onChange(Object.keys(next).length === 0 ? null : next);
  };

  const set = Object.keys(dialect ?? {}).length;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", background: "transparent", border: 0, cursor: "pointer",
          fontSize: 12, fontWeight: 700, color: "#0B1A2F",
        }}
      >
        <span>CSV format{set > 0 ? ` · ${set} changed` : ""}</span>
        <span aria-hidden style={{ color: SLATE }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "grid", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 11, color: SLATE, lineHeight: 1.5 }}>
            Leave these alone unless the receiving system asked for something specific. Anything you
            do not change keeps producing exactly the bytes this supplier already receives.
          </p>

          <Row label="Column separator">
            <select
              aria-label="Column separator"
              value={dialect?.delimiter ?? ","}
              onChange={(e) => put("delimiter", e.target.value === "," ? null : e.target.value)}
              style={SELECT}
            >
              <option value=",">Comma  ,</option>
              <option value=";">Semicolon  ;</option>
              <option value={"\t"}>Tab</option>
              <option value="|">Pipe  |</option>
            </select>
          </Row>

          <Row label="Line ending">
            <select
              aria-label="Line ending"
              value={dialect?.lineEnding ?? ""}
              onChange={(e) => put("lineEnding", e.target.value)}
              style={SELECT}
            >
              {/* "" is not "unknown" — it is the emitter's own default, which is the
                  server's Environment.NewLine. Named honestly rather than shown blank. */}
              <option value="">Whatever the server uses (unchanged)</option>
              <option value={"\r\n"}>Windows  CRLF</option>
              <option value={"\n"}>Unix  LF</option>
            </select>
          </Row>

          <Row label="Quoting">
            <select
              aria-label="Quoting"
              value={dialect?.quotePolicy ?? "minimal"}
              onChange={(e) => put("quotePolicy", e.target.value === "minimal" ? null : e.target.value)}
              style={SELECT}
            >
              <option value="minimal">Only when needed</option>
              <option value="always">Every field</option>
            </select>
          </Row>

          <Row label="Text encoding">
            <select
              aria-label="Text encoding"
              value={dialect?.encoding ?? ""}
              onChange={(e) => put("encoding", e.target.value)}
              style={SELECT}
            >
              <option value="">UTF-8</option>
              <option value="windows-1252">Windows-1252 (Western European)</option>
              <option value="iso-8859-1">ISO-8859-1 (Latin-1)</option>
            </select>
          </Row>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#0B1A2F" }}>
            <input
              type="checkbox"
              aria-label="Write a header row"
              checked={dialect?.writeHeaderRow ?? true}
              onChange={(e) => put("writeHeaderRow", e.target.checked ? null : false)}
            />
            Write a header row
          </label>
        </div>
      )}
    </div>
  );
}

const SELECT: React.CSSProperties = {
  height: 28, borderRadius: 6, border: "1px solid #D8DEE9", background: "#FFFFFF",
  fontSize: 12, padding: "0 8px", minWidth: 220,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: SLATE, minWidth: 130 }}>{label}</span>
      {children}
    </div>
  );
}

// ── Root XML namespaces (prefix → uri) editor ───────────────────────────────────
// Authors template.namespaces — the LEGACY root-map mode: each row becomes an xmlns:{prefix}="{uri}"
// declaration on the root element while the element names stay unprefixed. Local row state keeps
// typing smooth; every change commits up via onChange (which drops incomplete rows + nulls an empty
// map, so a cleared editor saves byte-identical). Collapsed by default so it doesn't clutter the
// common non-namespaced case.
function RootNamespacesEditor({ preset, rows, onPreset, onChange }: {
  preset: NamespacePresetId;
  rows: NamespaceRow[];
  onPreset: (id: NamespacePresetId) => void;
  onChange: (rows: NamespaceRow[]) => void;
}) {
  // `draft` is the editing source of truth so in-progress (still-blank) rows survive — the parent
  // commit drops incomplete rows + nulls an empty map (byte-identical clear), so a freshly-added
  // blank row would round-trip back as `[]` and vanish if we mirrored the parent blindly. We re-sync
  // from upstream ONLY when its COMPLETED projection differs from ours (a genuine external change,
  // e.g. a sample was inferred), comparing on the same blank-dropping rule the parent uses.
  const [draft, setDraft] = useState<NamespaceRow[]>(rows);
  const committedSig = (rs: NamespaceRow[]) => JSON.stringify(rowsToNamespaces(rs));
  const ours = useRef<string>(committedSig(rows));
  useEffect(() => {
    if (committedSig(rows) !== ours.current) {
      ours.current = committedSig(rows);
      setDraft(rows);
    }
  }, [rows]);

  const commit = (next: NamespaceRow[]) => { setDraft(next); ours.current = committedSig(next); onChange(next); };
  const setRow = (i: number, patch: Partial<NamespaceRow>) =>
    commit(draft.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => commit([...draft, { prefix: "", uri: "" }]);
  const removeRow = (i: number) => commit(draft.filter((_, idx) => idx !== i));

  // `custom` is a MODE, not a value: an empty custom map is indistinguishable from "none" in the
  // saved template, so choosing Custom and then reading the choice back off the template would snap
  // the control to None before the first row could be typed. The chosen mode is therefore local, and
  // re-syncs only when the template's own detected preset becomes something concrete — which is what
  // happens when a sample is inferred underneath the editor.
  const [mode, setMode] = useState<NamespacePresetId>(preset);
  useEffect(() => { if (preset !== "none") setMode(preset); }, [preset]);

  const presetMeta = NAMESPACE_PRESETS.find((p) => p.id === mode);

  return (
    <div style={{ marginBottom: 12, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, background: "#F7F9FC" }}>
      {/* Not behind a disclosure. The old collapsed panel meant the only way to discover that a
          layout could carry namespaces at all was to open a section labelled with the thing you did
          not yet know you needed. One always-visible control that reads "None" costs a single row. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>XML namespaces</span>
        <select aria-label="XML namespaces" value={mode}
          onChange={(e) => { const id = e.target.value as NamespacePresetId; setMode(id); onPreset(id); }}
          style={{ height: 28, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0 6px", fontSize: 12, minWidth: 190 }}>
          {NAMESPACE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {presetMeta && <span style={{ fontSize: 11, color: SLATE, flex: "1 1 180px", lineHeight: 1.45 }}>{presetMeta.description}</span>}
      </div>
      {/* One sentence, no jargon beyond "tag". A namespace URI is a string a coordinator has no way
          to know and every way to mistype, and a typo does not fail — it emits a document in a
          namespace nobody recognises, which the receiver rejects after we have reported the order
          delivered. The preset makes the common case a pick.

          Deliberately NOT offered: a cXML preset (cXML is DTD-based and has no namespaces at all)
          and a Peppol BIS 3 preset (its namespaces are UBL's, plus three MANDATORY element values —
          a preset seeding only the namespaces would produce a document that looks like Peppol and is
          rejected by the network, and ProcuLink has just retracted Peppol as a claim). Both formats
          are produced by their own transforms, set up on the supplier's Delivery tab. */}
      <div style={{ fontSize: 11, color: SLATE, marginTop: 7, lineHeight: 1.5 }}>
        A namespace is a label — usually a web address — that tells your supplier&rsquo;s software
        which standard each tag comes from, so their <code style={{ fontFamily: MONO }}>ID</code> and
        yours are never confused. Your supplier&rsquo;s spec lists the ones they expect; if it
        doesn&rsquo;t mention namespaces, leave this off.
      </div>
      {mode === "custom" && (
        <div style={{ marginTop: 9 }}>
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
