"use client";

// ThreePaneMapper — the UNIFIED three-pane mapper shell. Composes the three lanes
// (SourceUniverse │ CanonicalLane │ TargetLane) over the prop-driven MapperWireLayer
// engine, with a top action bar and a collapsible live-preview pane. Reused by BOTH:
//   • variant="order"      — the inbox per-order review (SpineReview mounts it, Task 11);
//   • variant="connection" — the Supplier Connection draft-revision editor (Task 12).
//
// All state lives in useMapperModel (one hook; carries sourceMap via buildOverrideDraft).
// The shell is layout + wiring only — it owns the gridRef + the three lanes' anchor refs
// (mirrors SpineReview's nodeEls/outLineEls/dotEls) and overlays the engine SVG. No new
// visual language — locked Bridge tokens + shipped primitives (Button, the lane chips).
//
// Mobile (< lg): the drag canvas is a desktop-first power tool, so small screens render a
// read-only mapping summary + the primary approve/deliver action (MobileListRow language).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "../DSPrimitives";
import { SourceUniverse } from "./SourceUniverse";
import { CanonicalLane } from "./CanonicalLane";
import { TargetLane } from "./TargetLane";
import { FieldBadges } from "./FieldBadges";
import { MapperPreviewPane } from "./MapperPreviewPane";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel, fieldManipulatorsOf } from "./useMapperModel";
import { MAPPER_EVENT, type MapperCommandEvent } from "./mapperCommands";
import type { FieldFilter, TargetField } from "./types";
import type { OrderMappingOverride } from "@/lib/api/types";

export interface ThreePaneMapperProps {
  variant: "order" | "connection";
  /** orderId (order) or connectionId (connection). */
  orderId?: string;
  connectionId?: string;
  /** Connection variant: the draft revision being authored. */
  revisionId?: string;
  supplierId?: string;
  /**
   * Connection variant only: the sample/recent order this author-once mapping is wired +
   * previewed against (there is no single order on the connection path). Null → the source
   * lane + preview show their honest empty states.
   */
  previewOrderId?: string | null;
  /** SpineReview already loaded the override — seed it to avoid a refetch flash. */
  initialOverride?: OrderMappingOverride | null;
  /** Published revision → read-only. */
  readOnly?: boolean;
  /**
   * The host detected that AI extraction failed and the deterministic parser ran instead.
   * Surfaces an honest banner + softens the source-pane empty copy; manual mapping is
   * unaffected (everything still works).
   */
  extractionFailed?: boolean;
  /** Optional: the host's deliver action (gated on validation by the shell). */
  onDeliver?: () => void;
  /** Disable the deliver button (host-controlled, e.g. order not in a deliverable state). */
  deliverDisabled?: boolean;
  deliverLabel?: string;
}

export function ThreePaneMapper(props: ThreePaneMapperProps) {
  const { variant, readOnly, onDeliver, deliverDisabled, deliverLabel, extractionFailed } = props;
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

  // ── Lane anchor refs (the wire engine measures these) ──────────────────────
  const gridRef = useRef<HTMLDivElement>(null);
  const sourceEls = useRef<Record<string, HTMLElement | null>>({});
  const canonicalEls = useRef<Record<string, HTMLElement | null>>({});
  const targetEls = useRef<Record<string, HTMLElement | null>>({});

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Discovery controls (SourceUniverse) ────────────────────────────────────
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("all");

  // Live-preview pane open/closed (order variant only; the toggle + pane share this).
  const [previewOpen, setPreviewOpen] = useState(true);

  // ── Deep-link: ?field=<key> selects + scrolls to a node ────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepField = searchParams.get("field");
  useEffect(() => {
    if (!deepField) return;
    setHoveredId(deepField);
    const el = canonicalEls.current[deepField] ?? targetEls.current[deepField];
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [deepField]);

  // Reflect the selected field into the URL (?field=<key>) so a selection is shareable and
  // restores on reload — shallow via router.replace (next/navigation). Debounced + skips the
  // value that arrived FROM the URL so we don't fight the deep-link effect or spam history on
  // hover. null (nothing focused) leaves the param as-is rather than thrashing it off/on.
  useEffect(() => {
    if (!hoveredId || hoveredId === deepField) return;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set("field", hoveredId);
      router.replace(`?${sp.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [hoveredId, deepField, router, searchParams]);

  // ── Command-palette power commands (plk:mapper event bus) ───────────────────
  // The palette can't reach this React tree, so it dispatches a window CustomEvent and we
  // act here on the currently-focused field (hoveredId). Counter signals re-trigger the
  // child effects (focus search / open add-field form / cycle preview format) on each call.
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
          setPreviewOpen(true);
          setCycleFormatSignal((n) => n + 1);
          break;
        case "add-transform": {
          // Focus the "+ transform" dropdown on the focused output row (DOM — the badge
          // lives several layers down; this is a one-shot imperative, not state we own).
          if (readOnly || !hoveredId) break;
          const row = targetEls.current[hoveredId];
          row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          const sel = row?.querySelector<HTMLSelectElement>('select[aria-label="Add a transform"]');
          sel?.focus();
          break;
        }
        case "show-standards": {
          // Open the standards popover for the focused canonical node (DOM — the trigger
          // is inside CanonicalNodeCard).
          if (!hoveredId) break;
          const node = canonicalEls.current[hoveredId];
          // The dot ref is the snap target; the standards trigger sits in the same card.
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

  // ── Wire engine ────────────────────────────────────────────────────────────
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

  // Deliver is gated on validation being clean — Task 9 feeds real BLOCKING review badges
  // (getFieldValidation; mock/404 → 0, so nothing blocks before Phase 2 lands — honest
  // "no blockers known").
  const blockingCount = model.blockingCount;
  const canDeliver = !readOnly && blockingCount === 0 && !deliverDisabled;

  // ── Per-row enrichment badges (catalog/validation + manipulator pills) ─────
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

  // ── Mobile read-only summary ────────────────────────────────────────────────
  const mobileSummary = (
    <div className="lg:hidden">
      <MapperMobileSummary
        sourceCount={model.sourceFields.length}
        canonicalCount={model.canonicalNodes.length}
        targetCount={model.targetFields.length}
        wiredSources={Object.keys(model.sourceConnections).length}
        wiredOutputs={Object.keys(model.outputConnections).length}
      />
      {onDeliver && (
        <div className="mt-3">
          <Button variant="primary" size="lg" className="w-full" disabled={!canDeliver} onClick={onDeliver}>
            {deliverLabel ?? "Send to supplier"}
          </Button>
        </div>
      )}
    </div>
  );

  if (model.loading) {
    return <MapperSkeleton />;
  }

  return (
    <div>
      {/* ── Top action bar ──────────────────────────────────────────────── */}
      <div className="hidden lg:flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
            {variant === "order" ? "Map this order" : "Author the mapping"}
          </span>
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
          {blockingCount > 0 && (
            <span
              title="Resolve the flagged fields before delivering"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 5, padding: "2px 8px" }}
            >
              ⚠ {blockingCount} {blockingCount === 1 ? "field needs" : "fields need"} review
            </span>
          )}
          {variant === "order" && <PreviewToggle open={previewOpen} onToggle={() => setPreviewOpen((o) => !o)} />}
          {onDeliver && (
            <Button variant="primary" size="sm" disabled={!canDeliver} onClick={onDeliver}>
              {deliverLabel ?? "Send to supplier"}
            </Button>
          )}
        </div>
      </div>

      {mobileSummary}

      {/* Extraction-failed banner — honest, non-blocking: the deterministic parser ran,
          map manually. Shown on both mobile + desktop above the canvas. */}
      {extractionFailed && (
        <div
          role="status"
          style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "#FFF7E6", border: "1px solid #F1E2BE", color: "#9A6B00", fontSize: 12, lineHeight: 1.45 }}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1.2 }}>⚠</span>
          <span>
            We couldn&rsquo;t auto-extract this document, so it fell back to the deterministic parser.
            Map the fields manually below — wiring, transforms, preview and delivery all still work.
          </span>
        </div>
      )}

      {/* ── Desktop three-pane canvas ───────────────────────────────────── */}
      <div
        ref={gridRef}
        className="hidden lg:block"
        style={{ position: "relative" }}
      >
        <ResizablePanelGroup direction="horizontal" style={{ minHeight: 360 }}>
          <ResizablePanel defaultSize={32} minSize={20}>
            <div style={{ position: "sticky", top: 8, paddingRight: 10 }}>
              <SourceUniverse
                fields={model.sourceFields}
                query={query}
                onQuery={setQuery}
                filter={filter}
                onFilter={setFilter}
                chipProps={sourceChipProps}
                loading={model.loading}
                sourceFileKey={model.sourceFileKey}
                focusSearchSignal={focusSearchSignal}
                extractionFailed={extractionFailed}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={34} minSize={22}>
            <div style={{ padding: "0 12px" }}>
              <CanonicalLane
                scopeId={scopeId}
                customFields={model.customFields}
                sourceConnections={model.sourceConnections}
                dotRef={(id, el) => { canonicalEls.current[id] = el; }}
                onHover={(id) => setHoveredId(id)}
                hoveredId={hoveredId}
                readOnly={readOnly}
                openAddFieldSignal={addFieldSignal}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={34} minSize={22}>
            <div style={{ position: "sticky", top: 8, paddingLeft: 10 }}>
              <TargetLane
                variant={variant}
                targetFields={model.targetFields}
                outputConnections={model.outputConnections}
                fixedValues={model.fixedValues}
                zoneRef={(path, el) => { targetEls.current[path] = el; }}
                onHover={(id) => setHoveredId(id)}
                hoveredId={hoveredId}
                onDisconnect={model.onTargetDisconnect}
                onSetFixedValue={model.onSetFixedValue}
                badgeSlot={badgeSlot}
                readOnly={readOnly}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* The engine SVG overlays the whole grid. */}
        {svg}
      </div>

      {/* ── Collapsible live preview ────────────────────────────────────── */}
      {/* Order variant: preview against the order. Connection variant (author-once):
          preview against the chosen sample/recent order (model.previewOrderId); when none
          exists the pane shows its honest empty hint, not an error (offer⇔works). */}
      {(previewOpen || variant === "connection") && (
        <div className="hidden lg:block mt-4">
          <MapperPreviewPane
            previewOrderId={model.previewOrderId}
            override={model.override}
            lastTouched={model.lastTouched}
            cycleFormatSignal={cycleFormatSignal}
            emptyHint={
              variant === "connection"
                ? "No sample order yet for this supplier — upload or receive one order to preview the live output of this mapping."
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

function PreviewToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onToggle} aria-pressed={open}>
      {open ? "Hide preview" : "Show preview"}
    </Button>
  );
}

// ── Mobile read-only summary ─────────────────────────────────────────────────
function MapperMobileSummary({
  sourceCount, canonicalCount, targetCount, wiredSources, wiredOutputs,
}: {
  sourceCount: number; canonicalCount: number; targetCount: number; wiredSources: number; wiredOutputs: number;
}) {
  const rows = [
    { label: "Source fields", value: `${sourceCount}` },
    { label: "Canonical fields", value: `${canonicalCount}` },
    { label: "Output fields", value: `${targetCount}` },
    { label: "Wired source → canonical", value: `${wiredSources}` },
    { label: "Wired canonical → output", value: `${wiredOutputs}` },
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
function MapperSkeleton() {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3, 4].map((j) => (
            <div key={j} style={{ height: 34, borderRadius: 7, background: "#EEF1F6", animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
