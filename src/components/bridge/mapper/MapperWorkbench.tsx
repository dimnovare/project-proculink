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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../DSPrimitives";
import { IncomingPane } from "./IncomingPane";
import { OutgoingPane } from "./OutgoingPane";
import { MapperPreviewPane } from "./MapperPreviewPane";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel } from "./useMapperModel";
import type { IncomingOrderShape } from "./incomingFromOrder";
import { MAPPER_EVENT, type MapperCommandEvent } from "./mapperCommands";
import type { OutgoingStatusInput } from "./outgoingStatusModel";
import { computeOutgoingStatuses } from "./outgoingStatusModel";
import type { FieldFilter, TargetField } from "./types";
import type { OrderMappingOverride } from "@/lib/api/types";

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
}

export function MapperWorkbench(props: MapperWorkbenchProps) {
  const {
    variant, readOnly, onDeliver, deliverDisabled, deliverLabel, extractionFailed,
    supplierName, onSaveMappings, saveMappingsLabel, savingMappings, onValidate,
  } = props;
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

  // ── Deep-link: ?field=<key> selects + scrolls to a row ─────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepField = searchParams.get("field");
  useEffect(() => {
    if (!deepField) return;
    setSelectedId(deepField);
    setHoveredId(deepField);
    // Scroll to the ROW (sourceRowEls), not the grip — sourceEls now holds the wire-engine port.
    const el = targetEls.current[deepField] ?? sourceRowEls.current[deepField];
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [deepField]);

  useEffect(() => {
    if (!selectedId || selectedId === deepField) return;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set("field", selectedId);
      router.replace(`?${sp.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [selectedId, deepField, router, searchParams]);

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
    <OutgoingPane
      variant={variant}
      targetFields={model.targetFields}
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
      badgeSlot={badgeSlot}
      manipulatorsOf={(field) => fieldManipulatorsOf(model.override, field.outputPath)}
      onFieldManipulatorsChange={model.onFieldManipulatorsChange}
      readOnly={readOnly}
    />
  );

  const previewNode = (
    <MapperPreviewPane
      previewOrderId={model.previewOrderId}
      override={model.override}
      lastTouched={model.lastTouched}
      cycleFormatSignal={cycleFormatSignal}
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
      {/* ── Top action bar (desktop) ────────────────────────────────────── */}
      <div className="hidden lg:flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
            {variant === "order" ? "Map this order" : "Author the mapping"}
          </span>
          <MappedSummaryChip mapped={summary.mappedCount} total={summary.total} />
          {model.saving && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>Saving…</span>}
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
          {summary.requiredUnmapped > 0 && (
            <span
              title="A required output field still has no source — wire one or set a fixed value"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 5, padding: "2px 8px" }}
            >
              ⚠ {summary.requiredUnmapped} {summary.requiredUnmapped === 1 ? "field needs" : "fields need"} a source
            </span>
          )}
          <ToolbarButton
            label={catalogHintCount > 0 ? `Enrich from catalog · ${catalogHintCount}` : "Enrich from catalog"}
            title={
              catalogHintCount > 0
                ? "Jump to the lines with catalog price/code hints — apply each per line"
                : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it."
            }
            onClick={catalogHintCount > 0 ? scrollToFirstCatalogHint : undefined}
          />
          <ToolbarButton
            label="Validate"
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
          region below otherwise. */}
      <div className="hidden lg:flex" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div
          ref={canvasRef}
          data-mapper-canvas
          style={{ position: "relative", flex: "1 1 560px", minWidth: 0 }}
        >
          {/* TRUE 2 columns: Incoming | gutter | Outgoing. The gutter is where wires live. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px minmax(0,1fr)", alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>{incomingNode}</div>
            <div aria-hidden /> {/* wire gutter — empty, the SVG draws here */}
            <div style={{ minWidth: 0 }}>{outgoingNode}</div>
          </div>
          {/* The engine SVG overlays the whole canvas (measured relative to it). */}
          {wire.svg}
        </div>
        {/* Docked preview — always present. Widened (T7): the live output is the
            thing operators read most, so it gets a near-equal share of the row
            instead of the old ~35%. Still flex-wraps to full width when narrow. */}
        <div style={{ flex: "1 1 480px", minWidth: 420 }}>
          {previewNode}
        </div>
      </div>
    </div>
  );
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
      title="Output fields with a resolved value (wired, fixed, or auto)"
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
