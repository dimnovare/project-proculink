"use client";

// MapperWorkbench — the REDESIGNED mapper shell. It replaces ThreePaneMapper's three equal
// lanes with a structure the founder asked for:
//
//   ┌──────────────────────────┬──────────────┬──────────────────────────┐
//   │  IncomingPane            │ canonical    │  OutgoingPane             │
//   │  (order's ACTUAL fields  │ spine        │  (output fields with an   │
//   │   WITH VALUES — never     │ (wire gutter)│   HONEST per-field status:│
//   │   empty, even for API)    │              │   value preview + source  │
//   │                          │              │   tag / quiet unmapped)   │
//   └──────────────────────────┴──────────────┴──────────────────────────┘
//   ┌───────────────────────────────────────────────────────────────────┐
//   │  DOCKED LIVE PREVIEW  — ALWAYS PRESENT, prominent (right rail ≥1280,│
//   │  docked bottom-third otherwise). Filled by the interaction agent.   │
//   └───────────────────────────────────────────────────────────────────┘
//
// Two co-equal VALUE columns (Incoming | Outgoing) flank a slimmer canonical spine that IS the
// wire gutter — the engine snaps source→canonical and canonical→output wires to it. The preview
// is a co-equal docked region, not a hidden/bottom-buried strip.
//
// The INTERACTION + POLISH pass wires the seams the structural pass left:
//   • IncomingPane anchorRef + OutgoingPane zoneRef + CanonicalLane dotRef → live drag wires
//     (MapperWireLayer): grip handles, snap zones, land-pulse, hover-emphasis, keyboard path.
//   • the docked `<MapperPreviewPane/>` renders the real output ("what {name} receives"),
//     debounced ~300ms, with working format toggle + copy + download + change-flash.
//   • OutgoingPane "+ Transform" opens the manipulator-chain popover (TransformPopover);
//     IncomingPane "Change source" opens the re-derive popover (ChangeSourcePopover, writes
//     sourceMap / fixed value). Toolbar Validate · Enrich from catalog · Save mappings are
//     each wired to a real handler or honestly disabled with a reason.
//   • AI suggestions render as dashed ghost wires with inline ✓/✗ + a "N suggestions" banner —
//     never auto-applied.
// The save contract (sourceMap + output via buildOverrideDraft, inside useMapperModel) is
// UNCHANGED — this only changes the VIEW + adds incoming values + the status overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../DSPrimitives";
import { IncomingPane } from "./IncomingPane";
import { OutgoingPane } from "./OutgoingPane";
import { CanonicalLane } from "./CanonicalLane";
import { FieldBadges } from "./FieldBadges";
import { MapperPreviewPane } from "./MapperPreviewPane";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel, fieldManipulatorsOf } from "./useMapperModel";
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
    readOnly,
  });

  // ── Wire anchor refs (the engine measures these) ───────────────────────────
  const gridRef = useRef<HTMLDivElement>(null);
  const sourceEls = useRef<Record<string, HTMLElement | null>>({});
  const canonicalEls = useRef<Record<string, HTMLElement | null>>({});
  const targetEls = useRef<Record<string, HTMLElement | null>>({});

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");

  // ── Deep-link: ?field=<key> selects + scrolls to a node ────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepField = searchParams.get("field");
  useEffect(() => {
    if (!deepField) return;
    setSelectedId(deepField);
    setHoveredId(deepField);
    const el = canonicalEls.current[deepField] ?? targetEls.current[deepField] ?? sourceEls.current[deepField];
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
  const [addFieldSignal, setAddFieldSignal] = useState(0);
  const [cycleFormatSignal, setCycleFormatSignal] = useState(0);

  useEffect(() => {
    function onCommand(ev: Event) {
      const detail = (ev as CustomEvent<MapperCommandEvent>).detail;
      if (!detail) return;
      switch (detail.kind) {
        case "jump-to-field":
          setFocusSearchSignal((n) => n + 1);
          break;
        case "add-field":
          if (!readOnly) setAddFieldSignal((n) => n + 1);
          break;
        case "switch-format":
          setCycleFormatSignal((n) => n + 1);
          break;
        case "add-transform": {
          if (readOnly || !hoveredId) break;
          const row = targetEls.current[hoveredId];
          row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          break;
        }
        case "show-standards": {
          if (!hoveredId) break;
          const node = canonicalEls.current[hoveredId];
          const card = node?.closest<HTMLElement>(".relative") ?? node?.parentElement ?? null;
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

  // ── Wire engine (interaction agent refines drag/preview; structural pass keeps it live) ──
  const { sourceChipProps, svg } = useMapperWireLayer({
    gridRef,
    sourceEls,
    canonicalEls,
    targetEls,
    canonicalNodes: model.canonicalNodes,
    targetFields: model.targetFields,
    outputConnections: model.outputConnections,
    sourceConnections: model.sourceConnections,
    knownSourceTokenIds: model.knownSourceTokenIds,
    onSourceConnect: model.onSourceConnect,
    onTargetConnect: model.onTargetConnect,
    onSourceDisconnect: model.onSourceDisconnect,
    onTargetDisconnect: model.onTargetDisconnect,
    suggestions: model.suggestions,
    onAcceptSuggestion: model.onAcceptSuggestion,
    onRejectSuggestion: model.onRejectSuggestion,
    hoveredId,
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
  // Deliver is gated on validation being clean AND no required output left without a source.
  const canDeliver = !readOnly && blockingCount === 0 && summary.requiredUnmapped === 0 && !deliverDisabled;

  // ── Per-row enrichment badges ───────────────────────────────────────────────
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
    const manipulators = fieldManipulatorsOf(model.override, field.outputPath);
    return (
      <FieldBadges
        validation={validation}
        catalogHint={catalogHint}
        manipulators={manipulators}
        onManipulatorsChange={(next) => model.onFieldManipulatorsChange(field.outputPath, next, field.scope)}
        onUseCatalogPrice={(hint) => model.onUseCatalogPrice(field.outputPath, hint, field.scope)}
        readOnly={readOnly}
      />
    );
  }, [model, readOnly]);

  // ── Catalog enrich: count hinted lines + a scroll-to-first action (real, never dead) ──
  const catalogHintCount = model.catalogHintByLine.size;
  const scrollToFirstCatalogHint = useCallback(() => {
    // Find the first OUTPUT row whose line has a catalog hint and bring it into view so the
    // per-row "Use catalog €X" action (rendered in its FieldBadges) is reachable.
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

  // ── Shared incoming/outgoing column nodes (reused by both layouts) ──────────
  const incomingNode = (
    <IncomingPane
      fields={model.sourceFields}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      chipProps={sourceChipProps}
      loading={model.loading}
      sourceFileKey={model.sourceFileKey}
      extractionFailed={extractionFailed}
      focusSearchSignal={focusSearchSignal}
      anchorRef={(id, el) => { sourceEls.current[id] = el; }}
      canonicalNodes={model.canonicalNodes}
      sourceConnections={model.sourceConnections}
      onSourceConnect={model.onSourceConnect}
      onSourceDisconnect={model.onSourceDisconnect}
      onSetFixedValue={model.onSetFixedValue}
      hoveredId={hoveredId}
      onHover={setHoveredId}
      onSelect={setSelectedId}
      readOnly={readOnly}
    />
  );

  const canonicalNode = (
    <CanonicalLane
      scopeId={scopeId}
      customFields={model.customFields}
      sourceConnections={model.sourceConnections}
      dotRef={(id, el) => { canonicalEls.current[id] = el; }}
      onHover={setHoveredId}
      onSelect={setSelectedId}
      hoveredId={hoveredId}
      readOnly={readOnly}
      allowCustomFields={variant === "connection"}
      openAddFieldSignal={addFieldSignal}
    />
  );

  const outgoingNode = (
    <OutgoingPane
      variant={variant}
      targetFields={model.targetFields}
      outputConnections={model.outputConnections}
      fixedValues={model.fixedValues}
      statusInput={statusInput}
      zoneRef={(path, el) => { targetEls.current[path] = el; }}
      onHover={setHoveredId}
      onSelect={setSelectedId}
      hoveredId={hoveredId}
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
          {/* Enrich from catalog — when the catalog overlay has hints, it scrolls the first
              hinted output row into view so the per-line "Use catalog €X" action is reachable;
              otherwise honestly disabled with the reason (no hints / no catalog configured). */}
          <ToolbarButton
            label={catalogHintCount > 0 ? `Enrich from catalog · ${catalogHintCount}` : "Enrich from catalog"}
            title={
              catalogHintCount > 0
                ? "Jump to the lines with catalog price/code hints — apply each per line"
                : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it."
            }
            onClick={catalogHintCount > 0 ? scrollToFirstCatalogHint : undefined}
          />
          {/* Validate — opens the host's standards-profile validation flow, or honestly disabled. */}
          <ToolbarButton
            label="Validate"
            title={onValidate ? "Validate the outbound document against a standards profile" : "Validation runs from the order review header"}
            onClick={onValidate}
          />
          {/* Save mappings — promotes this mapping to the supplier so the next order auto-applies. */}
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

      {/* ── AI suggestions banner — N suggestions to review (never auto-applied) ────────
          Each suggestion renders as a dashed ghost wire with inline ✓ accept / ✗ reject; this
          banner just surfaces the count + the honest framing so a bad suggestion reads as an
          easy reject, not a committed mapping. Hidden when there are none. */}
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
          ONE canvas (so the wire engine has exactly one gridRef to measure). The preview is
          ALWAYS PRESENT and prominent — a flex row that wraps: at ≥1280 the canvas + preview
          sit side-by-side (preview = docked right rail); at 1024–1279 the preview wraps to a
          full-width docked region below (the bottom-third). CSS reflow only — no duplicate
          ref. The canvas is `flex: 1 1 720px`; the preview is `flex: 1 1 340px`, so the row
          breaks to two rows once both can't fit, docking the preview underneath. */}
      <div className="hidden lg:flex" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div ref={gridRef} style={{ position: "relative", flex: "1 1 720px", minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 184px minmax(0,1fr)", gap: 12, alignItems: "start" }}>
            <div style={{ position: "sticky", top: 8 }}>{incomingNode}</div>
            <div style={{ position: "sticky", top: 8 }} aria-label="Canonical spine (wire gutter)">{canonicalNode}</div>
            <div style={{ position: "sticky", top: 8 }}>{outgoingNode}</div>
          </div>
          {/* The engine SVG overlays the whole value grid. */}
          {svg}
        </div>
        {/* Docked preview — always present, prominent. Right rail when it fits beside the
            canvas; wraps to a full-width docked region below otherwise. */}
        <div style={{ flex: "1 1 340px", minWidth: 320, position: "sticky", top: 8, alignSelf: "stretch" }}>
          {previewNode}
        </div>
      </div>
    </div>
  );
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
  // No handler → render disabled-with-reason (never a dead-but-enabled button).
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
        background: isDisabled ? "#F6F7FA" : violet ? "#FFFFFF" : "#FFFFFF",
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
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 0.5fr 1fr" }}>
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
