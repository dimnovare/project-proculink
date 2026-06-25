"use client";

// MapperWorkbench — the RE-ARCHITECTED mapper shell (2026-06-14 rebuild).
//
// The previous redesign failed in production. Root causes (now fixed):
//   1. Incoming values came ONLY from getSourceTokens(orderId), which is [] for PDF/XLSX → an
//      empty left pane + a false "arrived already-structured" message. → Values now come from
//      the parsed Order DIRECTLY (useMapperModel.incomingOrder); tokens are optional extras.
//   2. It was THREE physical columns (Incoming | value-less CanonicalLane | Outgoing) with the
//      canonical dot far-left, so output wires crossed the canonical LABEL TEXT. → TRUE 2
//      COLUMNS: Incoming | gutter | Outgoing. The canonical join is wire METADATA, not a column.
//   3. Columns were position:sticky while the wire SVG was container-relative → anchors drifted
//      every scroll frame and a rAF scroll-poll fought to keep up. → ONE relatively-positioned
//      CANVAS wraps both columns + the SVG; NOTHING is sticky; the page scrolls the canvas as
//      one unit so the overlay stays glued with ZERO per-scroll JS (see MapperWireLayer).
//   4. Wires only appeared after a scroll (80ms gate + scroll-poll). → measure-on-layout
//      (useLayoutEffect, synchronous, commit on first paint); a single ResizeObserver; no poll.
//   5. Duplicate transform editors (FieldBadges in badgeSlot AND OutgoingPane's own). → ONE
//      inline transform per outgoing row; badgeSlot keeps only catalog/validation badges.
//   6. The format toggle showed the server body verbatim. → the preview pane passes the chosen
//      format and shows an honest "unavailable in {format}" rather than silently showing JSON.
//
// The save contract (sourceMap + output via buildOverrideDraft, inside useMapperModel) is
// UNCHANGED — this only changes the VIEW + adds incoming values + the robust overlay.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../DSPrimitives";
import { IncomingPane } from "./IncomingPane";
import { OutgoingPane } from "./OutgoingPane";
import { MapperPreviewPane } from "./MapperPreviewPane";
import { OutputStructureDesigner } from "../OutputStructureDesigner";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel } from "./useMapperModel";
import type { IncomingOrderShape } from "./incomingFromOrder";
import { MAPPER_EVENT, type MapperCommandEvent } from "./mapperCommands";
import type { OutgoingStatusInput } from "./outgoingStatusModel";
import { computeOutgoingStatus, computeOutgoingStatuses } from "./outgoingStatusModel";
import type { FieldFilter, TargetField } from "./types";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";

/**
 * Optional collapse/focus state for the workbench's incoming + preview panes,
 * driven by the Order Workshop's `useWorkshopLayout` (Task 12). PURELY additive:
 * when `undefined` (every non-workshop host), both panes render at full width —
 * byte-identical to the pre-workshop behavior.
 *
 *   • `incoming: "rail"` → the incoming column collapses to a thin chevron rail.
 *   • `preview: "rail"`  → the docked preview collapses to a thin chevron rail.
 * Any other value (`"auto"` | `"1fr"`) renders the pane in full (today's behavior).
 */
export interface MapperWorkbenchLayout {
  incoming?: "rail" | "auto" | "1fr";
  preview?: "rail" | "auto" | "1fr";
  /** Expand the incoming rail back out (chevron click). */
  onExpandIncoming?: () => void;
  /** Expand the preview rail back out (chevron click). */
  onExpandPreview?: () => void;
  /** Collapse the (full) incoming pane to a rail — the in-header caret. */
  onCollapseIncoming?: () => void;
  /** Collapse the (full) preview pane to a rail — the in-header caret. */
  onCollapsePreview?: () => void;
}

export interface MapperWorkbenchProps {
  variant: "order" | "connection";
  orderId?: string;
  connectionId?: string;
  revisionId?: string;
  supplierId?: string;
  /** The supplier/connection display name — drives the "what {name} receives" preview header. */
  supplierName?: string;
  previewOrderId?: string | null;
  initialOverride?: OrderMappingOverride | null;
  /**
   * The parsed Order the incoming column is built from (order variant). Passing this is what
   * makes the left pane work for PDF/XLSX orders. SpineReview already has it.
   */
  order?: IncomingOrderShape | null;
  readOnly?: boolean;
  extractionFailed?: boolean;
  onDeliver?: () => void;
  deliverDisabled?: boolean;
  deliverLabel?: string;
  /** Host "Save mappings" — promote the per-order mapping to the supplier (inbox owns the real one). */
  onSaveMappings?: () => void;
  saveMappingsLabel?: string;
  savingMappings?: boolean;
  /** Host "Validate" — open the standards-profile validation flow. */
  onValidate?: () => void;
  /**
   * The format the supplier actually RECEIVES for this order (order variant). Seeds the preview
   * pane's DEFAULT format so it opens on the delivered format, not a hard-coded CSV (founder bug 4).
   * Takes precedence over the connection-only `model.outputFormat` when set. Absent → today's
   * behavior (model.outputFormat, then CSV).
   */
  previewDefaultFormat?: OutputFormatId | null;
  /**
   * The mapping interaction mode. "wires" (default) keeps today's drag-to-connect mapper — the
   * classic /inbox screen and the connection editor are UNCHANGED. "picker" turns each output row's
   * source into an inline searchable dropdown (no dragging) and HIDES the wires by default (a "Show
   * connections" toggle reveals the existing wire layer). The Order Workshop passes "picker".
   */
  mappingMode?: "picker" | "wires";

  // ── Order Workshop (Task 12) — ALL optional + additive; omitting them keeps
  //    today's exact rendering (flag-off = byte-identical). ────────────────────
  /**
   * Rendered ABOVE the two value columns (the IssuesPanel, in the workshop). When
   * absent nothing extra renders. Desktop region only — the mapper's mobile
   * summary is unchanged.
   */
  issuesSlot?: ReactNode;
  /**
   * Collapse/focus the incoming + preview panes (driven by `useWorkshopLayout`).
   * When absent both panes render full-width (today's behavior).
   */
  layout?: MapperWorkbenchLayout;
  /**
   * "Attention-first" default for the outgoing column: collapse the
   * already-mapped (auto/wired/fixed) rows behind an "N mapped · review" chip and
   * show only the rows that need attention (unmapped, required-unmapped). When
   * absent or false, every output row renders (today's behavior). Uses the pure
   * `splitMappings` boundary via the per-field outgoing status.
   */
  attentionFirstOutput?: boolean;
  /**
   * The trust threshold (0..1) from AI calibration. Only consulted when
   * `attentionFirstOutput` is on. Defaults to 0.85 (mappingListModel's default).
   */
  trustedThreshold?: number;
  /**
   * External "focus this field" signal (the IssuesPanel "Where →" affordance).
   * Bumping `focusFieldSignal` with a new `focusFieldId` selects + scrolls to that
   * row, reusing the SAME mechanism as the `?field=` deep-link. Absent → no-op.
   */
  focusFieldId?: string | null;
  focusFieldSignal?: number;
}

export function MapperWorkbench(props: MapperWorkbenchProps) {
  const {
    variant, readOnly, onDeliver, deliverDisabled, deliverLabel, extractionFailed,
    supplierName, onSaveMappings, saveMappingsLabel, savingMappings, onValidate,
    issuesSlot, layout, attentionFirstOutput, trustedThreshold, focusFieldId, focusFieldSignal,
    previewDefaultFormat, mappingMode = "wires",
  } = props;
  const pickerMode = mappingMode === "picker";
  const scopeId = (variant === "order" ? props.orderId : props.connectionId) ?? "";

  const model = useMapperModel({
    variant,
    scopeId,
    revisionId: props.revisionId,
    supplierId: props.supplierId,
    previewOrderId: props.previewOrderId,
    initialOverride: props.initialOverride,
    incomingOrder: props.order ?? null,
    readOnly,
  });

  // ── "✓ Saved" confirmation — display-only. When an auto-save (model.saving) settles
  //    with NO error, flash a calm "✓ Saved" for ~2s, then fade back to idle. This reads
  //    existing state ONLY (saving + error); it never changes when or what saves.
  const wasSavingRef = useRef(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (model.saving) {
      wasSavingRef.current = true;
      if (justSaved) setJustSaved(false); // a new save started — clear the old tick
      return;
    }
    // saving just flipped true → false. Only celebrate a clean settle (no error).
    if (wasSavingRef.current) {
      wasSavingRef.current = false;
      if (!model.error) {
        setJustSaved(true);
        const t = setTimeout(() => setJustSaved(false), 2000);
        return () => clearTimeout(t);
      }
    }
  }, [model.saving, model.error, justSaved]);

  // ── Wire anchor refs — ONE canvas (relative), two port maps. Nothing is sticky. ──
  const canvasRef = useRef<HTMLDivElement>(null);
  // The wire engine MEASURES from `sourceEls` — it must hold the incoming row's RIGHT-edge PORT
  // (the 22px grip), written by wire.sourcePortProps(id).ref. `sourceRowEls` is a SEPARATE map for
  // the incoming row <div> (command-palette scroll-to only). They must NOT share a key: React
  // resolves the child port ref before the parent row ref, so a shared map would let the row
  // clobber the port and the engine would anchor wires at the full-width row edge, not the grip.
  const sourceEls = useRef<Record<string, HTMLElement | null>>({});
  const sourceRowEls = useRef<Record<string, HTMLElement | null>>({});
  const targetEls = useRef<Record<string, HTMLElement | null>>({});

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");
  const [showDesigner, setShowDesigner] = useState(false);
  // Picker mode hides the wires by default; this toggle reveals the existing wire layer. In "wires"
  // mode the wires always show (this is ignored), so the classic screen is unchanged.
  const [showConnections, setShowConnections] = useState(false);
  const qc = useQueryClient();

  // ── Deep-link: ?field=<key> selects + scrolls to a row ─────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepField = searchParams.get("field");

  // Resolve a focus/deep-link ref to a REGISTERED row element. Refs coming from the
  // issue queue / send-readiness blockers are PREFIXED (`line:{lineId}` / `rule:{path}:…`)
  // and a raw `?field={lineId}` deep-link is a bare line GUID — none of these match the
  // targetEls/sourceRowEls keys (which are OUTPUT PATHS / anchor ids). Resolve resiliently
  // (exact → strip prefix → fuzzy contains) so a blocker-chip or deep-link jump always
  // lands on a real row instead of silently doing nothing (founder bug #1).
  const resolveRowRef = useCallback((rawId: string): { key: string; el: HTMLElement } | null => {
    const at = (k: string): HTMLElement | null => (targetEls.current[k] ?? sourceRowEls.current[k]) ?? null;
    let el = at(rawId);
    if (el) return { key: rawId, el };
    const bare = rawId.replace(/^(line|rule):/, "").split(":")[0];
    if (bare && bare !== rawId) {
      el = at(bare);
      if (el) return { key: bare, el };
    }
    // Whole-segment match only (split on path punctuation) so a short ref can't
    // substring-collide with an unrelated key — e.g. "PoNumber" must not match
    // "PoNumberRef"; a line GUID matches `lines[{guid}].itemCode` as one segment.
    if (bare && bare.length >= 4) {
      const seg = (k: string) => k.split(/[^A-Za-z0-9_-]+/);
      for (const map of [targetEls.current, sourceRowEls.current]) {
        for (const [k, v] of Object.entries(map)) {
          if (v && seg(k).includes(bare)) return { key: k, el: v };
        }
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (!deepField) return;
    const hit = resolveRowRef(deepField);
    const key = hit?.key ?? deepField;
    setSelectedId(key);
    setHoveredId(key);
    hit?.el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [deepField, resolveRowRef]);

  useEffect(() => {
    if (!selectedId || selectedId === deepField) return;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set("field", selectedId);
      router.replace(`?${sp.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [selectedId, deepField, router, searchParams]);

  // ── External focus signal (Order Workshop IssuesPanel "Where →") ───────────
  // Reuses the SAME select + scroll mechanism as the ?field= deep-link, driven by
  // a bumped signal so the SAME ref can be re-focused (a plain value-equality dep
  // would no-op on a repeat click of the same issue). No-op when unused.
  useEffect(() => {
    if (focusFieldSignal == null || focusFieldSignal === 0 || !focusFieldId) return;
    const hit = resolveRowRef(focusFieldId);
    const key = hit?.key ?? focusFieldId;
    setSelectedId(key);
    setHoveredId(key);
    hit?.el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFieldSignal]);

  // ── Command-palette power commands (plk:mapper event bus) ───────────────────
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [cycleFormatSignal, setCycleFormatSignal] = useState(0);

  useEffect(() => {
    function onCommand(ev: Event) {
      const detail = (ev as CustomEvent<MapperCommandEvent>).detail;
      if (!detail) return;
      switch (detail.kind) {
        case "jump-to-field":
          setFocusSearchSignal((n) => n + 1);
          break;
        case "switch-format":
          setCycleFormatSignal((n) => n + 1);
          break;
        case "add-transform": {
          if (readOnly || !hoveredId) break;
          targetEls.current[hoveredId]?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          break;
        }
        case "show-standards": {
          if (!hoveredId) break;
          // Resolve the ROW element (sourceRowEls), not the grip — see the ref-map split above.
          const row = targetEls.current[hoveredId] ?? sourceRowEls.current[hoveredId];
          const card = row?.closest<HTMLElement>("[data-mapper-row]") ?? row?.parentElement ?? null;
          const trigger = card?.querySelector<HTMLButtonElement>('[aria-label^="Standards"], [aria-label*="standards"]');
          card?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          trigger?.click();
          break;
        }
      }
    }
    window.addEventListener(MAPPER_EVENT, onCommand);
    return () => window.removeEventListener(MAPPER_EVENT, onCommand);
  }, [readOnly, hoveredId]);

  // ── Source ids in render order (drives the wire engine's measure list + kb order) ──
  const sourceIds = useMemo(() => model.sourceFields.map((f) => f.id), [model.sourceFields]);
  const knownSourceIds = useMemo(() => new Set(sourceIds), [sourceIds]);

  // Canonical keys = the spine node ids (so a wired raw token is distinguishable from a re-point).
  const knownCanonical = useMemo(
    () => new Set(model.canonicalNodes.map((n) => n.id)),
    [model.canonicalNodes],
  );

  // An incoming row dropped on an output. A canonical row (id is a canonical key) re-points the
  // output's source; a raw token (id is a token id, NOT a canonical key) pins the output's value
  // to the token's literal (lossless + keeps the output-only save contract).
  const onWireConnect = useCallback((sourceId: string, outputPath: string) => {
    if (knownCanonical.has(sourceId)) {
      model.onTargetConnect(sourceId, outputPath);
    } else {
      const literal = model.tokenValueById.get(sourceId) ?? "";
      const field = model.targetFields.find((f) => f.outputPath === outputPath);
      model.onSetFixedValue(outputPath, literal || null, field?.scope ?? "header");
    }
    setSelectedId(outputPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownCanonical, model.onTargetConnect, model.onSetFixedValue, model.tokenValueById, model.targetFields]);

  // ── Collapse state for the incoming + preview panes (Order Workshop, Task 12a).
  //    `undefined` layout → never collapsed → today's full-width rendering. ──────
  //    Hoisted above the wire engine so it can suppress wires when a wired pane is a rail.
  const incomingCollapsed = layout?.incoming === "rail";
  const previewCollapsed = layout?.preview === "rail";

  // Suppress the wire SVG when:
  //   • the INCOMING column is collapsed to a rail (bug 8) — its source anchors are no longer
  //     rendered, but the engine keeps last-good positions, so wires would draw into the void; or
  //   • we're in PICKER mode and the operator hasn't opted into "Show connections" — picker mode
  //     maps via the inline dropdown, so wires are off by default.
  // Collapsing the PREVIEW doesn't touch the wire span, so it doesn't gate the SVG. "wires" mode
  // never collapses and isn't picker → wires always show, the old screen is unchanged.
  const wiresHidden = incomingCollapsed || (pickerMode && !showConnections);

  // ── Wire engine (2-bank, robust in-content overlay) ─────────────────────────
  const wire = useMapperWireLayer({
    canvasRef,
    sourceEls,
    targetEls,
    sourceIds,
    targetFields: model.targetFields,
    outputConnections: model.outputConnections,
    knownSourceIds,
    onConnect: onWireConnect,
    onDisconnect: model.onTargetDisconnect,
    suggestions: model.suggestions,
    onAcceptSuggestion: model.onAcceptSuggestion,
    onRejectSuggestion: model.onRejectSuggestion,
    hoveredId,
    readOnly,
    hidden: wiresHidden,
    signature: model.signature,
  });

  const blockingCount = model.blockingCount;

  // ── Outgoing status (honest per-field) ──────────────────────────────────────
  const statusInput: OutgoingStatusInput = useMemo(
    () => ({
      outputConnections: model.outputConnections,
      sourceConnections: model.sourceConnections,
      fixedValues: model.fixedValues,
      tokenValueById: model.tokenValueById,
      canonicalValueByKey: model.canonicalValueByKey,
      labelForCanonical: model.labelForCanonical,
    }),
    [model.outputConnections, model.sourceConnections, model.fixedValues, model.tokenValueById, model.canonicalValueByKey, model.labelForCanonical],
  );
  const { summary } = useMemo(
    () => computeOutgoingStatuses(model.targetFields, statusInput),
    [model.targetFields, statusInput],
  );
  const canDeliver = !readOnly && blockingCount === 0 && summary.requiredUnmapped === 0 && !deliverDisabled;

  // ── Attention-first output split (Order Workshop, Task 12c) ──────────────────
  // OFF by default → `attentionFields` === every field → identical to today. When
  // ON, a row is "already mapped" (collapsed behind a chip) when it resolves to a
  // value AND is not a required-unmapped field; "attention" = the rest the operator
  // must still touch. The trust threshold is the AI calibration bound; auto/wired/
  // fixed rows that resolve to a value are mapped regardless of a per-field
  // confidence (the outgoing status, not a suggestion, is the source of truth here).
  const [outputExpanded, setOutputExpanded] = useState(false);
  const attentionSplit = useMemo(() => {
    if (!attentionFirstOutput) {
      return { attention: model.targetFields, mappedCount: 0 };
    }
    const attention: TargetField[] = [];
    let mappedCount = 0;
    for (const f of model.targetFields) {
      const st = computeOutgoingStatus(f, statusInput);
      // Needs attention: genuinely unmapped, OR required without a resolved value.
      const needsAttention = !st.mapped || (st.required && !st.mapped);
      if (needsAttention) attention.push(f);
      else mappedCount++;
    }
    // Never hide everything: if a clean order has zero attention rows, fall back to
    // the full list so the pane is never an empty box (the operator can still edit).
    if (attention.length === 0) return { attention: model.targetFields, mappedCount: 0 };
    return { attention, mappedCount };
  }, [attentionFirstOutput, model.targetFields, statusInput]);
  // The fields the outgoing pane actually renders: the attention subset by default,
  // the full list once the operator expands the "N mapped · review" chip.
  // In picker mode the OutgoingPane owns the v3 needs/auto split + "N fields ready" summary, so the
  // workbench passes the FULL field list and suppresses its own attention-first chip below.
  const outgoingFields =
    attentionFirstOutput && !pickerMode && !outputExpanded ? attentionSplit.attention : model.targetFields;
  const collapsedMappedCount =
    attentionFirstOutput && !pickerMode && !outputExpanded ? attentionSplit.mappedCount : 0;

  // ── Per-row enrichment badges (catalog/validation ONLY — no 2nd transform editor) ──
  const badgeSlot = useCallback((field: TargetField) => {
    const validation =
      model.validationByKey.get(field.outputPath) ??
      (model.outputConnections[field.outputPath]
        ? model.validationByKey.get(model.outputConnections[field.outputPath]) ?? null
        : null);
    const catalogHint =
      model.catalogHintByLine.get(field.outputPath) ??
      (model.outputConnections[field.outputPath]
        ? model.catalogHintByLine.get(model.outputConnections[field.outputPath]) ?? null
        : null);
    if (!validation && !catalogHint) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {validation && <ValidationBadge state={validation.state} blocking={validation.blocking} reason={validation.reason} />}
        {catalogHint && (
          <CatalogBadge
            hint={catalogHint}
            onUse={readOnly ? undefined : () => model.onUseCatalogPrice(field.outputPath, catalogHint, field.scope)}
          />
        )}
      </div>
    );
  }, [model, readOnly]);

  // ── Catalog enrich: count hinted lines + a scroll-to-first action ──────────
  const catalogHintCount = model.catalogHintByLine.size;
  const scrollToFirstCatalogHint = useCallback(() => {
    const target = model.targetFields.find((f) =>
      model.catalogHintByLine.has(f.outputPath) ||
      (model.outputConnections[f.outputPath]
        ? model.catalogHintByLine.has(model.outputConnections[f.outputPath])
        : false),
    );
    const el = target ? targetEls.current[target.outputPath] : null;
    if (el) {
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
      setHoveredId(target!.outputPath);
    }
  }, [model.targetFields, model.catalogHintByLine, model.outputConnections]);

  if (model.loading) {
    return <WorkbenchSkeleton />;
  }

  // ── The two value columns (shared by both layouts) ──────────────────────────
  const incomingNode = (
    <IncomingPane
      fields={model.sourceFields}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      portProps={wire.sourcePortProps}
      loading={model.loading}
      sourceFileKey={model.sourceFileKey}
      sourceType={sourceTypeFromKey(model.sourceFileKey)}
      extractionFailed={extractionFailed}
      focusSearchSignal={focusSearchSignal}
      anchorRef={(id, el) => { sourceRowEls.current[id] = el; }}
      hoveredId={hoveredId}
      onHover={setHoveredId}
      onSelect={setSelectedId}
      dragging={wire.dragging}
      readOnly={readOnly}
    />
  );

  const outgoingNode = (
    <>
      {/* Attention-first chip — collapses the AI-/auto-mapped rows so only the rows
          needing a human are shown by default. Workshop-only (off → not rendered). */}
      {attentionFirstOutput && !pickerMode && (collapsedMappedCount > 0 || outputExpanded) && (
        <button
          type="button"
          onClick={() => setOutputExpanded((v) => !v)}
          aria-expanded={outputExpanded}
          title={outputExpanded
            ? "Hide the already-mapped fields and show only what needs attention"
            : "Show every output field, including the ones already mapped"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8,
            padding: "5px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            border: "1px solid #E2D6F6", background: "#F4EFFC", color: "#5E3DB0", cursor: "pointer",
          }}
        >
          <span aria-hidden style={{ display: "inline-block", transform: outputExpanded ? "rotate(90deg)" : "none", transition: "transform 150ms", fontSize: 9 }}>▸</span>
          {outputExpanded
            ? "Showing all fields — collapse the mapped ones"
            : `${attentionSplit.mappedCount} mapped${model.suggestions.length > 0 ? " by AI" : ""} · review`}
        </button>
      )}
    <OutgoingPane
      variant={variant}
      targetFields={outgoingFields}
      outputConnections={model.outputConnections}
      fixedValues={model.fixedValues}
      statusInput={statusInput}
      portRef={(path, el) => { targetEls.current[path] = el; }}
      onHover={setHoveredId}
      onSelect={setSelectedId}
      hoveredId={hoveredId}
      snapTarget={wire.hoverTarget}
      onDisconnect={model.onTargetDisconnect}
      onSetFixedValue={model.onSetFixedValue}
      onAddField={model.onAddField}
      canonicalOptions={model.canonicalNodes}
      badgeSlot={badgeSlot}
      manipulatorsOf={(field) => fieldManipulatorsOf(model.override, field.outputPath)}
      onFieldManipulatorsChange={model.onFieldManipulatorsChange}
      mappingMode={mappingMode}
      incomingFields={model.sourceFields}
      onPickSource={(outputPath, sourceId) => onWireConnect(sourceId, outputPath)}
      outputFormat={previewDefaultFormat ?? model.outputFormat}
      readOnly={readOnly}
    />
    </>
  );

  const previewNode = (
    <MapperPreviewPane
      previewOrderId={model.previewOrderId}
      override={model.override}
      lastTouched={model.lastTouched}
      cycleFormatSignal={cycleFormatSignal}
      defaultFormat={previewDefaultFormat ?? model.outputFormat}
      supplierName={supplierName}
      emptyHint={
        variant === "connection"
          ? "No sample order yet for this supplier — upload or receive one order to preview the live output of this mapping."
          : undefined
      }
    />
  );

  return (
    <div>
      {showDesigner && variant === "order" && scopeId && (
        <OutputStructureDesigner
          orderId={scopeId}
          baseOverride={model.override}
          initialTree={model.override.outputTree ?? null}
          onClose={() => setShowDesigner(false)}
          onSaved={() => {
            setShowDesigner(false);
            void qc.invalidateQueries({ queryKey: ["mapping-override", scopeId] });
            void qc.invalidateQueries({ queryKey: ["order", scopeId] });
          }}
        />
      )}
      {/* ── Issues slot (Order Workshop) — the IssuesPanel sits above the columns.
          Absent for every non-workshop host → nothing extra renders. ───────── */}
      {issuesSlot && <div className="mb-3">{issuesSlot}</div>}
      {/* ── Top action bar (desktop) ────────────────────────────────────── */}
      <div className="hidden lg:flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
            {variant === "order" ? "Map this order" : "Map fields"}
          </span>
          <MappedSummaryChip mapped={summary.mappedCount} total={summary.total} />
          {model.saving && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>Saving…</span>}
          {!model.saving && !model.error && justSaved && (
            <span role="status" style={{ fontSize: 10.5, color: "#1E6D29" }}>✓ Saved</span>
          )}
          {model.error && <span style={{ fontSize: 10.5, color: "var(--danger,#C0392B)" }}>{model.error}</span>}
          {model.aiUnavailable && (
            <span
              title="AI mapping suggestions are unavailable right now — map fields manually; everything still works."
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#56627A", background: "#F3F4F7", border: "1px solid #E2E6EE", borderRadius: 5, padding: "1px 7px" }}
            >
              <span aria-hidden style={{ color: "#A8B0BF" }}>✦</span>
              AI suggestions unavailable
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pickerMode && (
            // Picker mode hides the drag-wires by default (you map via the inline source dropdown).
            // This toggle reveals the existing wire layer for anyone who wants the visual connections.
            <button
              type="button"
              onClick={() => setShowConnections((v) => !v)}
              aria-pressed={showConnections}
              title={showConnections ? "Hide the connection wires" : "Show the connection wires between received and output fields"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700,
                color: showConnections ? "#185FA5" : "#56627A",
                background: showConnections ? "#E6F1FB" : "#F3F4F7",
                border: `1px solid ${showConnections ? "#B5D4F4" : "#E2E6EE"}`,
                borderRadius: 5, padding: "2px 9px", cursor: "pointer",
              }}
            >
              <span aria-hidden>{showConnections ? "◉" : "○"}</span>
              {showConnections ? "Hide connections" : "Show connections"}
            </button>
          )}
          {summary.requiredUnmapped > 0 && (
            <span
              title="A required output field still has no source — map one or set a fixed value"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 5, padding: "2px 8px" }}
            >
              ⚠ {summary.requiredUnmapped} {summary.requiredUnmapped === 1 ? "field needs" : "fields need"} a source
            </span>
          )}
          {variant === "order" && (
            <ToolbarButton
              label="Customize output layout"
              title="Change how the output file is structured for this supplier — paste a supplier sample to start"
              onClick={() => setShowDesigner(true)}
            />
          )}
          <ToolbarButton
            label={catalogHintCount > 0 ? `Fill from catalog · ${catalogHintCount}` : "Fill from catalog"}
            title={
              catalogHintCount > 0
                ? "Jump to the lines with catalog price/code hints — apply each per line"
                : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it."
            }
            onClick={catalogHintCount > 0 ? scrollToFirstCatalogHint : undefined}
          />
          <ToolbarButton
            label="Standards check"
            title={onValidate ? "Validate the outbound document against a standards profile" : "Validation runs from the order review header"}
            onClick={onValidate}
          />
          {onSaveMappings && (
            <ToolbarButton
              label={savingMappings ? "Saving…" : (saveMappingsLabel ?? "Save mappings")}
              title="Save these field mappings for this supplier — applies to their next order automatically"
              onClick={onSaveMappings}
              disabled={savingMappings || readOnly}
              variant="violet"
            />
          )}
          {onDeliver && (
            <Button variant="primary" size="sm" disabled={!canDeliver} onClick={onDeliver}>
              {deliverLabel ?? "Send to supplier"}
            </Button>
          )}
        </div>
      </div>

      {/* ── AI suggestions banner ───────────────────────────────────────── */}
      {!readOnly && model.suggestions.length > 0 && (
        <div
          role="status"
          className="hidden lg:flex"
          style={{ alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#F4EFFC", border: "1px solid #E2D6F6", color: "#5E3DB0", fontSize: 12 }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>✦</span>
          <span style={{ fontWeight: 700 }}>
            {model.suggestions.length} AI {model.suggestions.length === 1 ? "suggestion" : "suggestions"} to review
          </span>
          <span style={{ color: "#7A6AA8", fontWeight: 500 }}>
            Shown as dashed wires — accept (✓) or dismiss (✗) each. Nothing is applied automatically.
          </span>
          <button
            type="button"
            onClick={() => model.suggestions.forEach((s) => model.onRejectSuggestion(s))}
            title="Dismiss every AI suggestion"
            style={{ marginLeft: "auto", border: "1px solid #D6C7F0", background: "#FFFFFF", color: "#5E3DB0", borderRadius: 6, padding: "3px 10px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
          >
            Dismiss all
          </button>
        </div>
      )}

      {/* ── Mobile read-only summary ────────────────────────────────────── */}
      <div className="lg:hidden">
        <MapperMobileSummary
          incomingCount={model.sourceFields.length}
          outputCount={model.targetFields.length}
          mapped={summary.mappedCount}
          requiredUnmapped={summary.requiredUnmapped}
        />
        {onDeliver && (
          <div className="mt-3">
            <Button variant="primary" size="lg" className="w-full" disabled={!canDeliver} onClick={onDeliver}>
              {deliverLabel ?? "Send to supplier"}
            </Button>
          </div>
        )}
      </div>

      {extractionFailed && (
        <div
          role="status"
          style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "#FFF7E6", border: "1px solid #F1E2BE", color: "#9A6B00", fontSize: 12, lineHeight: 1.45 }}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1.2 }}>⚠</span>
          <span>
            We couldn&rsquo;t auto-extract this document, so it fell back to the deterministic parser.
            The parsed values still flow through — map any output fields manually below; wiring,
            transforms, preview and delivery all still work.
          </span>
        </div>
      )}

      {/* ── Desktop (lg+) canvas + docked preview ─────────────────────────────
          A flex row that wraps. The CANVAS holds the two value columns + the wire SVG as ONE
          relatively-positioned unit (NOTHING sticky → the overlay scrolls with the columns).
          The preview docks to the right when it fits (≥~1440 total) and wraps to a full-width
          region below otherwise.

          Order Workshop collapse (Task 12a): when `layout.incoming === "rail"` the incoming
          column becomes a thin chevron rail (the grid drops its first track), and when
          `layout.preview === "rail"` the docked preview becomes a thin chevron rail. Both
          default to the full pane when `layout` is absent — byte-identical to today. */}
      <div className="hidden lg:flex" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div
          ref={canvasRef}
          data-mapper-canvas
          style={{ position: "relative", flex: "1 1 560px", minWidth: 0 }}
        >
          {incomingCollapsed ? (
            // Incoming collapsed to a rail — the wire source anchors aren't registered, so the
            // engine simply draws no incoming wires (graceful). One click expands it back.
            <div style={{ display: "grid", gridTemplateColumns: "44px 56px minmax(0,1fr)", alignItems: "start" }}>
              <CollapsedRail label="Incoming" color="#1E66C9" onExpand={layout?.onExpandIncoming} />
              <div aria-hidden />
              <div style={{ minWidth: 0 }}>{outgoingNode}</div>
            </div>
          ) : (
            // TRUE 2 columns: Incoming | gutter | Outgoing. Incoming is fixed-narrow and Outgoing
            // flexes wide (the v3 inline-fix rows need the room — handoff resolveLayout 336/flex).
            // Incoming min lowered to 260 so the whole canvas (260 + 56 gutter + outgoing) fits
            // within ~1000px of content — a 13"/14" laptop at 1024px gets the mapper with no
            // horizontal scroll; on wider screens it still grows to 340.
            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,340px) 56px minmax(0,1fr)", alignItems: "start" }}>
              <div style={{ minWidth: 0, position: "relative" }}>
                {layout?.onCollapseIncoming && <PaneCollapseCaret side="left" label="Received" onClick={layout.onCollapseIncoming} />}
                {incomingNode}
              </div>
              <div aria-hidden /> {/* wire gutter — empty, the SVG draws here */}
              <div style={{ minWidth: 0 }}>{outgoingNode}</div>
            </div>
          )}
          {/* The engine SVG overlays the whole canvas (measured relative to it). */}
          {wire.svg}
        </div>
        {/* Docked preview — always present (a companion, not a second hero column). In the
            workshop it can collapse to a rail to give the columns the full width. */}
        {previewCollapsed ? (
          <CollapsedRail label="Preview" color="#2E8E3A" onExpand={layout?.onExpandPreview} />
        ) : (
          <div style={{ flex: "1 1 460px", minWidth: 460, position: "relative" }}>
            {layout?.onCollapsePreview && <PaneCollapseCaret side="right" label="Live preview" onClick={layout.onCollapsePreview} />}
            {previewNode}
          </div>
        )}
      </div>
    </div>
  );
}

// ── A thin collapsed-zone rail with a chevron to expand it (Order Workshop, v3) ─
//    44px strip with a buyer/supplier TONE-GRADIENT spine + rotated label.
function CollapsedRail({ label, color, onExpand }: { label: string; color: string; onExpand?: () => void }) {
  const grad = `linear-gradient(180deg, ${color}33, ${color} 50%, ${color}33)`;
  return (
    <button
      type="button"
      onClick={onExpand}
      disabled={!onExpand}
      aria-label={`Expand ${label}`}
      title={`Expand ${label}`}
      style={{
        width: 44, minHeight: 240, alignSelf: "stretch", position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 12,
        borderRadius: 12, border: `1px solid ${color}33`, background: "#FBFBFD",
        color, cursor: onExpand ? "pointer" : "default", padding: "12px 0", overflow: "hidden",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: grad }} />
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${color}40`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>›</span>
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
        {label}
      </span>
    </button>
  );
}

// ── Collapse caret — rails a full pane to its CollapsedRail. Rendered as a slim
//    mid-height tab in the INTER-PANE GUTTER (not over the pane header) so it never
//    overlaps a pane's own header controls (preview Copy/Download/format pills etc.).
//    Chevron points the way the pane folds. Only rendered when a handler exists. ──
function PaneCollapseCaret({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Collapse ${label}`}
      title={`Collapse ${label}`}
      style={{
        position: "absolute", top: 64, zIndex: 6,
        ...(side === "left" ? { right: -13 } : { left: -13 }),
        width: 22, height: 30, borderRadius: 6, border: "1px solid #E2E6EE",
        background: "#FFFFFF", color: "#56627A", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, lineHeight: 1, padding: 0,
        boxShadow: "0 1px 3px rgba(11,26,47,.10)",
        transition: "background .12s, border-color .12s, color .12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#EFF2F7"; e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.color = "#0B1A2F"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#E2E6EE"; e.currentTarget.style.color = "#56627A"; }}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

// ── Derive the received document type from the stored file key's extension (drives the
//    "What we received" PDF/CSV/… chip). Unknown / no key → undefined → no chip. ──
function sourceTypeFromKey(key?: string | null): string | undefined {
  if (!key) return undefined;
  const ext = key.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "PDF";
    case "csv": return "CSV";
    case "xlsx": case "xls": return "XLSX";
    case "xml": return "XML";
    case "json": return "JSON";
    case "edi": case "txt": return ext.toUpperCase();
    default: return undefined;
  }
}

// ── Read an output path's current manipulator (fx) chain from an override (per-row feed) ──
function fieldManipulatorsOf(override: OrderMappingOverride, outputPath: string) {
  const cfg = override.output;
  if (!cfg) return [];
  const rule = cfg.header?.[outputPath] ?? cfg.lines?.[outputPath];
  return rule?.fieldManipulators ?? [];
}

// ── Toolbar button — real handler, or honestly disabled with a reason tooltip ──
function ToolbarButton({
  label, title, onClick, disabled, variant = "ghost",
}: {
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "ghost" | "violet";
}) {
  const isDisabled = disabled || !onClick;
  const violet = variant === "violet";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      style={{
        height: 30, padding: "0 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700,
        border: `1px solid ${violet ? "#C4ABE8" : "#DCE0E8"}`,
        background: isDisabled ? "#F6F7FA" : "#FFFFFF",
        color: isDisabled ? "#AEB6C4" : violet ? "#5E3DB0" : "#345470",
        cursor: isDisabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

// ── Header "N of M mapped" chip ──────────────────────────────────────────────
function MappedSummaryChip({ mapped, total }: { mapped: number; total: number }) {
  if (total === 0) return null;
  const allMapped = mapped >= total;
  return (
    <span
      title="Output fields with a resolved value (mapped, fixed, or auto)"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700,
        borderRadius: 999, padding: "2px 9px",
        color: allMapped ? "#1E6D29" : "#56627A",
        background: allMapped ? "#EAF6EC" : "#F3F4F7",
        border: `1px solid ${allMapped ? "#CDE7D1" : "#E2E6EE"}`,
      }}
    >
      {mapped} of {total} mapped
    </span>
  );
}

// ── Per-row validation badge (catalog/validation only — NOT a transform editor) ──
function ValidationBadge({ state, blocking, reason }: { state: "valid" | "review"; blocking?: boolean; reason?: string | null }) {
  if (state === "valid") return null; // a clean field needs no badge
  const tone = blocking
    ? { bg: "#FBE3E3", color: "#C53A3A", border: "#F0C8C8", label: "needs review" }
    : { bg: "#FFF7E6", color: "#9A6B00", border: "#F1E2BE", label: "review" };
  return (
    <span title={reason ?? undefined} style={{ fontSize: 9, fontWeight: 700, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 4, padding: "1px 6px" }}>
      {tone.label}
    </span>
  );
}

function CatalogBadge({ hint, onUse }: { hint: { catalogPrice?: number | null; currency?: string | null }; onUse?: () => void }) {
  if (hint.catalogPrice == null) return null;
  const label = `Catalog ${hint.currency ?? ""}${hint.catalogPrice}`.trim();
  if (!onUse) {
    return <span style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 6px" }}>{label}</span>;
  }
  return (
    <button type="button" onClick={onUse} title="Apply the catalog price as a fixed value for this line"
      style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", background: "#F4EFFC", border: "1px solid #E2D6F6", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>
      Use {label}
    </button>
  );
}

// ── Mobile read-only summary ─────────────────────────────────────────────────
function MapperMobileSummary({
  incomingCount, outputCount, mapped, requiredUnmapped,
}: {
  incomingCount: number; outputCount: number; mapped: number; requiredUnmapped: number;
}) {
  const rows = [
    { label: "Incoming fields", value: `${incomingCount}` },
    { label: "Output fields", value: `${outputCount}` },
    { label: "Mapped outputs", value: `${mapped} of ${outputCount}` },
    { label: "Required without a source", value: `${requiredUnmapped}` },
  ];
  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FFFFFF", overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #EEF0F4", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
        Mapping summary
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", borderBottom: "1px solid #F2F4F8", minHeight: 44 }}>
          <span style={{ fontSize: 12, color: "#56627A" }}>{r.label}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F" }}>{r.value}</span>
        </div>
      ))}
      <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.45 }}>
        Open this order on a larger screen to drag-wire fields. The mapping shown above is read-only here.
      </div>
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────
function WorkbenchSkeleton() {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 64px 1fr" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3, 4].map((j) => (
            <div key={j} style={{ height: 44, borderRadius: 8, background: "#EEF1F6", animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
