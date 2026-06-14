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
import { previewMappingOverride } from "@/lib/api-client";
import { SourceUniverse } from "./SourceUniverse";
import { CanonicalLane } from "./CanonicalLane";
import { TargetLane } from "./TargetLane";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel } from "./useMapperModel";
import type { FieldFilter } from "./types";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";
import { PREVIEW_FORMATS } from "@/lib/api/types";

export interface ThreePaneMapperProps {
  variant: "order" | "connection";
  /** orderId (order) or connectionId (connection). */
  orderId?: string;
  connectionId?: string;
  /** Connection variant: the draft revision being authored. */
  revisionId?: string;
  supplierId?: string;
  /** SpineReview already loaded the override — seed it to avoid a refetch flash. */
  initialOverride?: OrderMappingOverride | null;
  /** Published revision → read-only. */
  readOnly?: boolean;
  /** Optional: the host's deliver action (gated on validation by the shell). */
  onDeliver?: () => void;
  /** Disable the deliver button (host-controlled, e.g. order not in a deliverable state). */
  deliverDisabled?: boolean;
  deliverLabel?: string;
}

export function ThreePaneMapper(props: ThreePaneMapperProps) {
  const { variant, readOnly, onDeliver, deliverDisabled, deliverLabel } = props;
  const scopeId = (variant === "order" ? props.orderId : props.connectionId) ?? "";

  const model = useMapperModel({
    variant,
    scopeId,
    revisionId: props.revisionId,
    supplierId: props.supplierId,
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

  const selectField = useCallback((key: string) => {
    setHoveredId(key);
    // Shallow URL update so the selection is shareable + restores on reload.
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("field", key);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [router, searchParams]);

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

  // Deliver is gated on validation being clean. Task 9 feeds real blocking badges; until
  // then nothing blocks (no validation client wired yet) — honest "no blockers known".
  const blockingCount = 0;
  const canDeliver = !readOnly && blockingCount === 0 && !deliverDisabled;

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
        </div>
        <div className="flex items-center gap-2">
          {variant === "order" && <PreviewToggle open={previewOpen} onToggle={() => setPreviewOpen((o) => !o)} />}
          {onDeliver && (
            <Button variant="primary" size="sm" disabled={!canDeliver} onClick={onDeliver}>
              {deliverLabel ?? "Send to supplier"}
            </Button>
          )}
        </div>
      </div>

      {mobileSummary}

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
                readOnly={readOnly}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* The engine SVG overlays the whole grid. */}
        {svg}
      </div>

      {/* ── Collapsible live preview ────────────────────────────────────── */}
      {previewOpen && variant === "order" && props.orderId && (
        <div className="hidden lg:block mt-4">
          <InlinePreview orderId={props.orderId} override={model.override} lastTouched={model.lastTouched} />
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

// ── Inline live preview (Task 10 swaps this for the richer MapperPreviewPane) ─
function InlinePreview({ orderId, override, lastTouched }: { orderId: string; override: OrderMappingOverride; lastTouched: string | null }) {
  const [format, setFormat] = useState<OutputFormatId>("csv");
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ~400ms debounce on (override, format) — mirrors OutputMappingEditor's preview cadence.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await previewMappingOverride(orderId, override, format);
        if (cancelled) return;
        setContent(res.content);
        setErr(res.error ?? res.warning ?? null);
      } catch (e) {
        if (!cancelled) { setContent(null); setErr(e instanceof Error ? e.message : "Preview failed"); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [orderId, override, format]);

  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
          Live preview
        </span>
        {lastTouched && <span style={{ fontSize: 10, color: "#5E3DB0" }}>edited {lastTouched}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {PREVIEW_FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFormat(f.value)}
              aria-pressed={format === f.value}
              style={{
                padding: "2px 8px", borderRadius: 999, cursor: "pointer", fontSize: 10, fontWeight: 700,
                border: `1px solid ${format === f.value ? "#2E8E3A" : "#DCE0E8"}`,
                background: format === f.value ? "#EAF6EC" : "#FFFFFF",
                color: format === f.value ? "#1E6D29" : "var(--ink-faint)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {err && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "#9A6B00", background: "#FFF7E6", borderBottom: "1px solid #F1E2BE" }}>
          {err}
        </div>
      )}
      <pre
        style={{
          margin: 0, padding: "10px 12px", maxHeight: 220, overflow: "auto",
          fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.5,
          color: "#0B1A2F", whiteSpace: "pre-wrap", wordBreak: "break-word",
          opacity: busy ? 0.55 : 1, transition: "opacity 150ms",
        }}
      >
        {content ?? (busy ? "Rendering…" : "(no preview)")}
      </pre>
    </div>
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
