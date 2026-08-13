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
import { isPlanGate, PlanGateNotice } from "../PlanGateNotice";
import { Card } from "../layout/Card";
import { IncomingPane } from "./IncomingPane";
import { OutgoingPane, type AutoFilledFields } from "./OutgoingPane";
import { MapperPreviewPane } from "./MapperPreviewPane";
import { OutputStructureDesigner } from "../OutputStructureDesigner";
import { OutputMappingEditor } from "../OutputMappingEditor";
import { useMapperWireLayer } from "./MapperWireLayer";
import { useMapperModel } from "./useMapperModel";
import type { IncomingOrderShape } from "./incomingFromOrder";
import { MAPPER_EVENT, type MapperCommandEvent } from "./mapperCommands";
import type { OutgoingStatusInput } from "./outgoingStatusModel";
import { computeOutgoingStatus, computeOutgoingStatuses } from "./outgoingStatusModel";
import type { FieldFilter, TargetField } from "./types";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";
import type { IncomingView } from "@/lib/sourceDocument";

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
  /**
   * Which body the "What we received" column shows — the original document, or the field list
   * that is the drag-source for wiring. Owned by `useWorkshopLayout` so it persists with the
   * rest of the layout, and so selecting the Mapping focus can force the field list back: you
   * cannot be asked to map from a pane that is showing a PDF.
   */
  incomingView?: IncomingView;
  onIncomingView?: (view: IncomingView) => void;
}

/** The received column's document view, supplied by the caller that owns the order. */
export interface MapperReceivedDocument {
  /** The rendered document. Only read when `available`. */
  slot: ReactNode;
  /** True only when the source endpoint served a renderable file. */
  available: boolean;
  /** Short format tag for the pane header, derived from the served content type. */
  formatLabel?: string | null;
  /** One sentence explaining why there is no document. Shown above the field list. */
  notice?: string | null;
}

/**
 * The top toolbar's live state + handlers, published via `onToolbarState` so a host
 * that hides the toolbar (`hideToolbar`) can re-host the SAME controls elsewhere
 * (the Order Workshop's consolidated status bar). Handlers are the workbench's own
 * — relocated, not reimplemented.
 */
export interface MapperToolbarState {
  /** Output fields with a resolved value (same source as the "N of M mapped" chip). */
  mapped: number;
  total: number;
  /** Required output fields still without a source (the amber toolbar warning). */
  requiredUnmapped: number;
  /** Auto-save status (the "Saving… / ✓ Saved / error" toolbar indicators). */
  saving: boolean;
  justSaved: boolean;
  error: string | null;
  aiUnavailable: boolean;
  /** Picker mode's wire-layer toggle. */
  showConnections: boolean;
  toggleConnections: () => void;
  /** Opens the OutputStructureDesigner (closes the template editor first). */
  openLayoutDesigner: () => void;
  /** Opens the OutputMappingEditor template slideover (closes the designer first). */
  openTemplateEditor: () => void;
  catalogHintCount: number;
  /** Jump to the first catalog-hinted line; null when there are no hints (disabled). */
  fillFromCatalog: (() => void) | null;
  /**
   * Open AI field-mapping suggestions. WP-28 retired the violet banner these used
   * to occupy above the three columns; a host that hides the toolbar re-hosts the
   * count as a chip. Optional so pure-view callers and tests can omit them.
   */
  suggestionCount?: number;
  /** Dismiss every AI suggestion at once (the retired banner's "Dismiss all"). */
  dismissAllSuggestions?: () => void;
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
   * The order's auto-filled address + contact fields (order variant). For structured formats
   * (cXML / X12 / UBL) the OutgoingPane surfaces these READ-ONLY so the user can see what the
   * backend writer emits automatically. Optional + every field nullable — omitted/empty renders
   * nothing. Forwarded straight to OutgoingPane; flat formats ignore it.
   */
  autoFilledFields?: AutoFilledFields | null;
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
   * When `issuesSlot` is present it no longer sits above the columns — it becomes
   * the "Issues" tab of the docked preview column (Issues | Preview). These drive
   * that tab's badge + which tab opens first.
   */
  issuesOpenCount?: number;
  /** Blocking subset of `issuesOpenCount` → the Issues-tab badge color (red vs amber). */
  issuesBlockingCount?: number;
  /**
   * Is the order genuinely fine? Only consulted when `issuesOpenCount` is 0.
   *
   * Zero open issues means zero FIELD problems, which is not the same thing as
   * "nothing is wrong" — a delivery can fail with every field correctly filled. The
   * head used to draw its green dot, green check and "Nothing to fix" from the count
   * alone, so on the failed order in WP-39 §4.3 it declared an all-clear beside a
   * "Couldn't send" badge on the same screen.
   *
   * The workbench stays out of the order-status machine; the caller passes the verdict.
   * Omitted → the count decides, exactly as before.
   */
  issuesAllClear?: boolean;
  /** Bump to force the preview column onto its "Issues" tab (e.g. a send-readiness chip jump). */
  showIssuesSignal?: number;
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
  /**
   * Bumped when the order's line-review state changes (last unresolved line resolved →
   * status goes ready). Forwarded to MapperPreviewPane so the live preview re-fetches
   * instead of sitting on the "Cannot transform: lines still need review" message until
   * the user switches format tabs. Omitting this keeps today's behaviour (no-op).
   */
  reviewSignal?: number;
  /**
   * Hide the workbench's own top action bar (the "MAP THIS ORDER" row). The Order
   * Workshop passes true and re-hosts the bar's controls in its consolidated
   * status bar via `onToolbarState`. Absent/false → today's rendering.
   */
  hideToolbar?: boolean;
  /**
   * Hide the one-line "Left = … Middle = … Right = …" orientation helper (WP-28).
   * The Order Workshop passes true: all three columns already carry the same
   * sentence in their own sub-headers ("These are the fields in the {supplier}'s
   * order. You don't edit them here — you map them to the output on the right."),
   * so the band restated it a fourth time and cost 66px of the vertical budget
   * above the columns on every session until dismissed. The connection editor,
   * which has a different first-run population, keeps it.
   */
  hideOrientation?: boolean;
  /** Publishes the toolbar's live state + handlers (see MapperToolbarState). */
  onToolbarState?: (state: MapperToolbarState) => void;
  /**
   * Order Workshop "Lines" view — extra control rendered at the right end of the
   * outgoing ("What we'll send") pane header: the Fields|Lines toggle. Optional +
   * additive; absent → the pane header is unchanged.
   */
  outgoingHeaderExtra?: ReactNode;
  /**
   * When set, REPLACES the outgoing pane's field list with this node (the
   * workshop's per-line Lines view). The pane header stays; the wire overlay is
   * suppressed while active because the output anchors it draws to are unmounted.
   */
  outgoingBodyOverride?: ReactNode;
  /**
   * The original file this order arrived as, rendered by the caller (which owns the order id
   * and therefore the fetch). Absent → the received column behaves exactly as it did before:
   * the field list, no toggle, no notice.
   */
  receivedDocument?: MapperReceivedDocument;
}

export function MapperWorkbench(props: MapperWorkbenchProps) {
  const {
    variant, readOnly, onDeliver, deliverDisabled, deliverLabel, extractionFailed,
    supplierName, onSaveMappings, saveMappingsLabel, savingMappings, onValidate,
    issuesSlot, issuesOpenCount = 0, issuesBlockingCount = 0, issuesAllClear, showIssuesSignal,
    layout, attentionFirstOutput, trustedThreshold, focusFieldId, focusFieldSignal,
    previewDefaultFormat, autoFilledFields, mappingMode = "wires", reviewSignal,
    hideToolbar, hideOrientation, onToolbarState,
    outgoingHeaderExtra, outgoingBodyOverride, receivedDocument,
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
  // The OutputMappingEditor slideover (template mode / explicit field rules) — the
  // only surface where a whole-document output template is written. Order variant only.
  const [showOutputEditor, setShowOutputEditor] = useState(false);

  // ── B1 orientation helper — a thin, dismissible one-line explainer of the
  //    Incoming | Output | Preview / "wires" / collapse-chevron model, for the
  //    non-technical operator seeing the 3-column mapper for the first time.
  //    ADDITIVE chrome above the grid (it does NOT touch gridTemplateColumns), so
  //    the 3-column layout is unshifted. SSR-safe dismissal (mirrors
  //    WorkspaceNameNudge): localStorage is read in an effect, never during render,
  //    so the server + first client render agree (both hidden → no hydration flash).
  const [showOrientation, setShowOrientation] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setShowOrientation(localStorage.getItem("plk-mapper-orient-seen") !== "1");
    } catch {
      setShowOrientation(true); // storage blocked — show it (harmless)
    }
  }, []);
  const dismissOrientation = useCallback(() => {
    try { localStorage.setItem("plk-mapper-orient-seen", "1"); } catch { /* ignore */ }
    setShowOrientation(false);
  }, []);
  const orientationSupplier = supplierName?.trim() || "supplier";

  // Connections (wires) are ON by default so the order workbench opens on the signature
  // received→output wire view (handoff reference). The toggle still hides them for dense orders.
  const [showConnections, setShowConnections] = useState(true);
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
        case "edit-output-template": {
          // Per-order templates only — the connection editor has no order to render
          // against, so its mapper leaves the event alone (harmless palette no-op).
          // Close the designer first: Cmd+K stays reachable over the open designer
          // (z 9999 > 100), and the designer would otherwise fully occlude the
          // editor slideover (z 60) — a second modal mounted invisibly behind it.
          if (variant === "order" && scopeId) {
            setShowDesigner(false);
            setShowOutputEditor(true);
          }
          break;
        }
      }
    }
    window.addEventListener(MAPPER_EVENT, onCommand);
    return () => window.removeEventListener(MAPPER_EVENT, onCommand);
  }, [readOnly, hoveredId, variant, scopeId]);

  // ── Source ids in render order (drives the wire engine's measure list + kb order) ──
  const sourceIds = useMemo(() => model.sourceFields.map((f) => f.id), [model.sourceFields]);
  const knownSourceIds = useMemo(() => new Set(sourceIds), [sourceIds]);

  // ── Bidirectional hover link — "what we received" ↔ "what we'll send" ↔ live
  //    preview. `model.outputConnections` maps an output path → its wired source
  //    id. From the raw hovered id (a received field id OR an output path) we light
  //    BOTH ends of the wire; the panes read `activeIds` so the linked counterpart
  //    lights, not just the element under the cursor. Cheap: it only grows the
  //    existing single-hover set, so nothing else changes when nothing is hovered.
  const activeHoverIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!hoveredId) return set;
    set.add(hoveredId);
    const conns = model.outputConnections;
    if (knownSourceIds.has(hoveredId)) {
      // received field hovered → light every output path wired from it
      for (const path in conns) if (conns[path] === hoveredId) set.add(path);
    } else {
      // output path hovered → light its wired source
      const src = conns[hoveredId];
      if (src) set.add(src);
    }
    return set;
  }, [hoveredId, model.outputConnections, knownSourceIds]);

  // The live preview highlights an OUTPUT line, so a hovered RECEIVED field must be
  // resolved to the output path it feeds; an output path passes straight through.
  const targetPathSet = useMemo(() => new Set(model.targetFields.map((f) => f.outputPath)), [model.targetFields]);
  const previewHot = useMemo<string | null>(() => {
    if (!hoveredId) return null;
    if (!knownSourceIds.has(hoveredId)) return hoveredId; // already an output path
    // Received field hovered → find the output path it feeds:
    //   1. an EXPLICIT canonical→output wire (outputConnections value === the field id), or
    //   2. the AUTO 1:1 default (the received field id IS a declared output path — the common
    //      case, which the explicit-wire-only lookup missed, so hovering an auto-mapped field
    //      like "PO number" lit nothing in the preview). Both resolve to the output path whose
    //      resolved VALUE the preview highlights.
    const conns = model.outputConnections;
    for (const path in conns) if (conns[path] === hoveredId) return path;
    if (targetPathSet.has(hoveredId)) return hoveredId;
    return null;
  }, [hoveredId, model.outputConnections, knownSourceIds, targetPathSet]);

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
  // A body override (the workshop Lines view) unmounts every output-row anchor, so the SVG is
  // suppressed there too — the engine would otherwise draw to last-good stale positions.
  const wiresHidden = incomingCollapsed || (pickerMode && !showConnections) || outgoingBodyOverride != null;

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

  // ── The RESOLVED VALUE of the hovered output field (founder bug: hover→preview
  //    highlight didn't visibly work). The preview highlights by string match, but the
  //    canonical output PATH (e.g. "SupplierItemCode") does NOT appear verbatim in a
  //    structured document (cXML emits <SupplierPartID>, XML emits the mapped tag) — so
  //    matching on the path alone lit nothing for XML/cXML/UBL. The field's resolved
  //    VALUE (e.g. "SM-A576BZABEEE") DOES appear in the rendered output for EVERY format,
  //    so we pass it and the pane matches value-first, path-second. Null when the hovered
  //    field has no resolved value (nothing to light). ──────────────────────────────────
  const previewHotValue = useMemo<string | null>(() => {
    if (!previewHot) return null;
    const field = model.targetFields.find((f) => f.outputPath === previewHot);
    if (!field) return null;
    const st = computeOutgoingStatus(field, statusInput);
    const v = st.valuePreview;
    return v != null && v !== "" ? v : null;
  }, [previewHot, model.targetFields, statusInput]);

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

  // ── Re-hosted toolbar (Order Workshop chrome compression) ───────────────────
  // Stable versions of the toolbar's handlers, published to the host via
  // onToolbarState so it can render the SAME controls in its own status bar.
  // The designer and the template editor are workbench-level portal modals over
  // the same order override — opening one closes the other (independent flags
  // would stack them; see the inline toolbar buttons below, which share these).
  const toggleConnections = useCallback(() => setShowConnections((v) => !v), []);
  const openLayoutDesigner = useCallback(() => { setShowOutputEditor(false); setShowDesigner(true); }, []);
  const openTemplateEditor = useCallback(() => { setShowDesigner(false); setShowOutputEditor(true); }, []);
  // The retired violet banner's "Dismiss all" — the SAME per-suggestion reject
  // loop it ran, relocated not reimplemented.
  const suggestionCount = readOnly ? 0 : model.suggestions.length;
  const dismissAllSuggestions = useCallback(() => {
    model.suggestions.forEach((s) => model.onRejectSuggestion(s));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.suggestions, model.onRejectSuggestion]);
  useEffect(() => {
    if (!onToolbarState) return;
    onToolbarState({
      suggestionCount,
      dismissAllSuggestions,
      mapped: summary.mappedCount,
      total: summary.total,
      requiredUnmapped: summary.requiredUnmapped,
      saving: model.saving,
      justSaved,
      error: model.error,
      aiUnavailable: model.aiUnavailable,
      showConnections,
      toggleConnections,
      openLayoutDesigner,
      openTemplateEditor,
      catalogHintCount,
      fillFromCatalog: catalogHintCount > 0 ? scrollToFirstCatalogHint : null,
    });
  }, [
    onToolbarState, summary.mappedCount, summary.total, summary.requiredUnmapped,
    model.saving, justSaved, model.error, model.aiUnavailable, showConnections,
    toggleConnections, openLayoutDesigner, openTemplateEditor, catalogHintCount,
    scrollToFirstCatalogHint, suggestionCount, dismissAllSuggestions,
  ]);

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
      hasIncomingSource={model.hasIncomingSource}
      // The format tag comes from the served document's content type — the ONLY thing that
      // actually establishes it. It used to be derived from a "file key" that was an order id.
      sourceType={receivedDocument?.formatLabel ?? undefined}
      view={layout?.incomingView}
      onView={receivedDocument ? layout?.onIncomingView : undefined}
      documentAvailable={receivedDocument?.available}
      documentSlot={receivedDocument?.slot}
      documentNotice={receivedDocument?.notice}
      supplierName={supplierName}
      extractionFailed={extractionFailed}
      focusSearchSignal={focusSearchSignal}
      anchorRef={(id, el) => { sourceRowEls.current[id] = el; }}
      hoveredId={hoveredId}
      activeIds={activeHoverIds}
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
      activeIds={activeHoverIds}
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
      autoFilledFields={autoFilledFields}
      supplierName={supplierName}
      readOnly={readOnly}
      headerExtra={outgoingHeaderExtra}
      bodyOverride={outgoingBodyOverride}
    />
    </>
  );

  const previewNode = (
    <MapperPreviewPane
      previewOrderId={model.previewOrderId}
      override={model.override}
      lastTouched={model.lastTouched}
      hot={previewHot}
      hotValue={previewHotValue}
      onHotChange={setHoveredId}
      cycleFormatSignal={cycleFormatSignal}
      defaultFormat={previewDefaultFormat ?? model.outputFormat}
      supplierName={supplierName}
      reviewSignal={reviewSignal}
      emptyHint={
        variant === "connection"
          ? "No sample order yet for this supplier — upload or receive one order to preview the live output of this mapping."
          : undefined
      }
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
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
            // This workbench reads the override under its OWN key (useMapperModel:
            // ["mapper-override", variant, scopeId, …]) — without this the outgoing
            // column + live preview keep rendering the pre-save mapping.
            void qc.invalidateQueries({ queryKey: ["mapper-override", variant, scopeId] });
          }}
        />
      )}
      {/* The whole-document template escape hatch (+ explicit field-rule form). Portal
          slideover — invalidates the shared override keys itself on save; onSaved busts
          THIS workbench's own "mapper-override" cache (see the designer note above). */}
      {showOutputEditor && variant === "order" && scopeId && (
        <OutputMappingEditor
          orderId={scopeId}
          open
          initialTemplateMode
          onClose={() => setShowOutputEditor(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["mapper-override", variant, scopeId] });
          }}
        />
      )}
      {/* ── Issues slot (Order Workshop) no longer sits above the columns — it is
          now the "Issues" tab of the docked preview column (see PreviewColumnTabs
          in the desktop grid below). Absent for every non-workshop host. ─────── */}
      {/* ── Top action bar (desktop). Hidden when the host re-hosts these
          controls itself (hideToolbar + onToolbarState — the Order Workshop's
          consolidated status bar). ─────────────────────────────────────── */}
      {!hideToolbar && (
      <div className="hidden lg:flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Section label above the 3 columns (app.jsx Toolbar). The connection editor
              says "MAP FIELDS"; the order variant says "MAP THIS ORDER · N to resolve"
              (N = open issue count) so the mapper region is labelled and the operator
              sees how many issues remain right above the columns. When there are no open
              issues it reads the calm "all mapped" state via the summary chip beside it. */}
          {variant !== "order" ? (
            <span style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--ink)" }}>
              Map fields
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--ink)" }}>
              Map this order
              {issuesOpenCount > 0 && (
                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "none", letterSpacing: 0, color: issuesBlockingCount > 0 ? "#B43838" : "#8A5310" }}>
                  · {issuesOpenCount} to resolve
                </span>
              )}
            </span>
          )}
          <MappedSummaryChip mapped={summary.mappedCount} total={summary.total} />
          {model.saving && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>Saving…</span>}
          {!model.saving && !model.error && justSaved && (
            <span role="status" style={{ fontSize: 10.5, color: "#1E6D29" }}>✓ Saved</span>
          )}
          {model.error && !isPlanGate(model.error) && <span style={{ fontSize: 10.5, color: "var(--danger,#C0392B)" }}>{model.error}</span>}
          {model.aiUnavailable && (
            <span
              title="AI mapping suggestions are unavailable right now — map fields manually; everything still works."
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5E6779", background: "#F3F4F7", border: "1px solid #E5E8EE", borderRadius: 5, padding: "1px 7px" }}
            >
              <span aria-hidden style={{ color: "#A8B0BF" }}>✦</span>
              AI suggestions unavailable
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Picker mode's "Show connections" toggle stays INLINE for the connection
              editor (its own most-used control); the order variant folds it into the
              "More" menu below so the order toolbar reads clean. */}
          {pickerMode && variant !== "order" && (
            // Picker mode hides the drag-wires by default (you map via the inline source dropdown).
            // This toggle reveals the existing wire layer for anyone who wants the visual connections.
            <button
              type="button"
              onClick={() => setShowConnections((v) => !v)}
              aria-pressed={showConnections}
              title={showConnections ? "Hide the connection wires" : "Show the connection wires between received and output fields"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 32, fontSize: 11.5, fontWeight: 600,
                color: showConnections ? "#0F4FA8" : "#5E6779",
                background: showConnections ? "#EAF0F8" : "#F3F4F7",
                border: `1px solid ${showConnections ? "#1E66C9" : "#E5E8EE"}`,
                borderRadius: 8, padding: "0 12px", cursor: "pointer",
              }}
            >
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1, color: showConnections ? "#1E66C9" : "#9AA8C0" }}>{showConnections ? "◉" : "○"}</span>
              {showConnections ? "Hide connections" : "Show connections"}
            </button>
          )}
          {summary.requiredUnmapped > 0 && (
            <span
              title="A required output field still has no source — map one or set a fixed value"
              // Same near-miss as ValidationBadge: #9A6B00 on #FFF7E6 is 4.3999:1, #8A5310 is 5.9237:1.
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#8A5310", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 5, padding: "2px 8px" }}
            >
              ⚠ {summary.requiredUnmapped} {summary.requiredUnmapped === 1 ? "field needs" : "fields need"} a source
            </span>
          )}
          {/* ── Order variant: the secondary tools are surfaced INLINE (app.jsx Toolbar) —
              "Hide connections · Customize output layout · Fill from catalog" — instead of
              behind a "More ▾" dropdown, so the operator can reach them in one click. Each
              keeps its EXACT original handler; nothing about wiring / activeIds /
              showConnections changes — the controls only relocated out of the menu. ─── */}
          {variant === "order" ? (
            <>
              {pickerMode && (
                // Picker mode hides the drag-wires by default (you map via the inline source
                // dropdown). This pill toggle reveals the existing wire layer.
                <button
                  type="button"
                  onClick={() => setShowConnections((v) => !v)}
                  aria-pressed={showConnections}
                  title={showConnections ? "Hide the connection wires" : "Show the connection wires between received and output fields"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, height: 30, fontSize: 11.5, fontWeight: 700,
                    color: showConnections ? "#0F4FA8" : "#345470",
                    background: showConnections ? "#EAF0F8" : "#FFFFFF",
                    border: `1px solid ${showConnections ? "#1E66C9" : "#DCE0E8"}`,
                    borderRadius: 7, padding: "0 11px", cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  <span aria-hidden style={{ fontSize: 13, lineHeight: 1, color: showConnections ? "#1E66C9" : "#9AA8C0" }}>{showConnections ? "◉" : "○"}</span>
                  {showConnections ? "Hide connections" : "Show connections"}
                </button>
              )}
              {/* The designer and the template editor are both workbench-level portal
                  modals over the same order override — opening one closes the other
                  (independent flags would stack them, the higher-z designer fully
                  occluding the editor slideover). */}
              <ToolbarButton
                label="Customize output layout"
                title="Change how the output file is structured for this supplier — paste a supplier sample to start"
                onClick={() => { setShowOutputEditor(false); setShowDesigner(true); }}
              />
              <ToolbarButton
                label="Edit as template"
                title="Write one template that renders this order's whole output document — for outputs the layout designer can't express (advanced)"
                onClick={() => { setShowDesigner(false); setShowOutputEditor(true); }}
              />
              <ToolbarButton
                label={catalogHintCount > 0 ? `Fill from catalog · ${catalogHintCount}` : "Fill from catalog"}
                title={
                  catalogHintCount > 0
                    ? "Jump to the lines with catalog price/code hints — apply each per line"
                    : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it."
                }
                onClick={catalogHintCount > 0 ? scrollToFirstCatalogHint : undefined}
              />
            </>
          ) : (
            <ToolbarButton
              label={catalogHintCount > 0 ? `Fill from catalog · ${catalogHintCount}` : "Fill from catalog"}
              title={
                catalogHintCount > 0
                  ? "Jump to the lines with catalog price/code hints — apply each per line"
                  : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it."
              }
              onClick={catalogHintCount > 0 ? scrollToFirstCatalogHint : undefined}
            />
          )}
          {/* Standards check is NOT a toolbar button — it lives in the Details drawer
              (Standards-check tab), per the app.jsx reference + founder. */}
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
      )}

      {/* ── Plan-gate banner ────────────────────────────────────────────────
          A connection save PUTs the whole draft bundle, so a revision on a gated protocol or
          output format is refused on EVERY mapping save. That refusal needs its own
          full-width banner: the toolbar's 10.5px error span can't carry a sentence, and hosts
          that hide the toolbar would have swallowed it entirely. ────────────────────── */}
      {isPlanGate(model.error) && (
        <PlanGateNotice error={model.error} capability="This connection setup" className="mb-3" />
      )}

      {/* ── AI suggestions banner ─────────────────────────────────────────
          Suppressed for a host that re-hosts the toolbar (the Order Workshop):
          WP-28 moved the count to a chip and "Dismiss all" to the ⋯ overflow of
          the consolidated status bar, so this band no longer stacks above the
          three columns there. Every other host renders it unchanged. */}
      {!hideToolbar && !readOnly && model.suggestions.length > 0 && (
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

      {/* ── B1 orientation helper (desktop) — one calm line explaining the
          Incoming | Output | Preview model + wires + collapse chevrons, dismissible
          and remembered. `hidden lg:flex` so it only shows where the columns render;
          it lives in the chrome ABOVE the grid, so the 3-column layout is unshifted. */}
      {showOrientation && !hideOrientation && (
        <div
          role="note"
          className="hidden lg:flex"
          style={{
            alignItems: "flex-start", gap: 8, marginBottom: 12, padding: "8px 12px",
            borderRadius: 8, background: "#F6F8FC", border: "1px solid #E1E7F0",
            color: "#5E6779", fontSize: 12, lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 12, lineHeight: 1.3, color: "#8A93A5" }}>ⓘ</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontWeight: 700, color: "#3C4658" }}>Left</strong> = the fields in this {orientationSupplier}&rsquo;s order.{" "}
            <strong style={{ fontWeight: 700, color: "#3C4658" }}>Middle</strong> = where each one goes in the output — drag a left field onto a middle field to connect it.{" "}
            <strong style={{ fontWeight: 700, color: "#3C4658" }}>Right</strong> = a live preview of what the {orientationSupplier} receives. Use the ⌃ chevrons to collapse a column.
          </span>
          <button
            type="button"
            onClick={dismissOrientation}
            aria-label="Dismiss this tip"
            title="Dismiss this tip"
            style={{
              flexShrink: 0, border: "none", background: "none", cursor: "pointer",
              color: "var(--ink-faint)", fontSize: 13, lineHeight: 1, padding: "1px 3px",
            }}
          >
            ✕
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
          // A whole paragraph of it: #9A6B00 on #FFF7E6 is 4.3999:1, #8A5310 is 5.9237:1.
          style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "#FFF7E6", border: "1px solid #F1E2BE", color: "#8A5310", fontSize: 12, lineHeight: 1.45 }}
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
      {/* app.jsx 2-level grid — OUTER [ received+output wrap | preview ] · INNER [ received | output ].
          NO gaps (the three areas share borders as one connected strip) + align-items:stretch (all
          three are equal, full height). The wire SVG overlays ONLY the inner received↔output wrap,
          so the wires are short clean curves at the column boundary (no 56px gutter to span). */}
      <div
        className="hidden lg:grid"
        style={{
          // Chrome above (action bar, banners) keeps the wrapper's px-6 indent so it aligns with
          // the page title; the column grid bleeds back out to the wrapper edges (flush to the
          // sidebar + viewport) via a negative horizontal margin that cancels that px-6.
          flex: 1, minHeight: 0, alignItems: "stretch", gridTemplateRows: "minmax(0,1fr)",
          marginLeft: -24, marginRight: -24,
          gridTemplateColumns: previewCollapsed
            ? "minmax(0,1fr) 46px"
            : incomingCollapsed
              ? "minmax(0,1fr) minmax(400px,1fr)"
              : "minmax(0,1.85fr) minmax(380px,1.05fr)",
        }}
      >
        {/* INNER wrap — received | output, the wire overlay's host (canvasRef). */}
        <div
          ref={canvasRef}
          data-mapper-canvas
          style={{
            position: "relative", minWidth: 0, minHeight: 0, display: "grid", alignItems: "stretch", gridTemplateRows: "minmax(0,1fr)",
            gridTemplateColumns: incomingCollapsed
              ? "46px minmax(360px,1fr)"
              : "minmax(300px,0.92fr) minmax(360px,1fr)",
          }}
        >
          {incomingCollapsed ? (
            <CollapsedRail label="Incoming" color="#1E66C9" onExpand={layout?.onExpandIncoming} chevron="›" />
          ) : (
            <div style={{ minWidth: 0, position: "relative" }}>
              {layout?.onCollapseIncoming && <PaneCollapseCaret side="left" label="Received" onClick={layout.onCollapseIncoming} />}
              {incomingNode}
            </div>
          )}
          <div style={{ minWidth: 0 }}>{outgoingNode}</div>
          {wire.svg}
        </div>
        {/* Live preview — fills its column to full height (a connected third pane, not a short box). */}
        {previewCollapsed ? (
          <CollapsedRail label="Preview" color="#2E8E3A" textColor="#1E6D29" onExpand={layout?.onExpandPreview} chevron="‹" />
        ) : (
          <div style={{ minWidth: 0, position: "relative" }}>
            {layout?.onCollapsePreview && <PaneCollapseCaret side="right" label="Live preview" onClick={layout.onCollapsePreview} />}
            {issuesSlot ? (
              <PreviewColumnSplit
                issuesSlot={issuesSlot}
                openCount={issuesOpenCount}
                blockingCount={issuesBlockingCount}
                allClear={issuesAllClear ?? issuesOpenCount === 0}
                showIssuesSignal={showIssuesSignal}
                preview={previewNode}
              />
            ) : (
              previewNode
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preview column split (Order Workshop) — the third column is Issues ABOVE the
//    live output, not "Issues | Preview" tabs (WP-28 / DB-4).
//
//    The tabs were the defect: the issue list is the reason the operator opened
//    the screen, and it disappeared the moment they looked at the preview. Worse,
//    the count went with it — and `useWorkshopLayout` can rail this entire column
//    (Focus = Mapping), which took the tab strip too.
//
//    A VERTICAL split is what the brief asks for: "always-present on desktop,
//    without stealing width from the three columns". Height is the only thing it
//    costs, and it costs it to the preview — a verification surface — not to the
//    work. The issues region is capped at 46% so the preview always keeps a
//    usable body; with zero issues the region collapses to the ~44px green
//    "Ready to send" bar and the preview gets the column back.
//
//    Both regions are always mounted, which is strictly stronger than the tabs'
//    display-toggling: the preview never loses its fetched body or its format.
//
//    `showIssuesSignal` (bumped by a send-readiness chip jump) no longer switches
//    anything — the panel is on screen — so it only guarantees the region is
//    scrolled to the top before the caller's scroll-to-card runs. ─────────────
function PreviewColumnSplit({
  issuesSlot,
  openCount,
  blockingCount,
  allClear,
  showIssuesSignal,
  preview,
}: {
  issuesSlot: ReactNode;
  openCount: number;
  blockingCount: number;
  /** Nothing wrong with the order AT ALL — not merely no open field issues. */
  allClear: boolean;
  showIssuesSignal?: number;
  preview: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (showIssuesSignal == null || showIssuesSignal === 0) return;
    bodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [showIssuesSignal]);

  // #B43838 on #FAE6E6 = 4.92:1; #8A5310 on #FAF1DD = 5.62:1. Both AA at 10px/700.
  // NOT #B36D14 (the old tab badge), which is 3.65:1 on its own soft background.
  const badge = blockingCount > 0 ? { bg: "#FAE6E6", fg: "#B43838" } : { bg: "#FAF1DD", fg: "#8A5310" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#FFFFFF" }}>
      {/* ColHead — the same 52px head as Received / Output / Live preview, so the
          column heads still form ONE connected strip across the three columns. */}
      <div
        data-testid="issues-column-head"
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 10, height: 52,
          padding: "0 18px", borderBottom: "1px solid #E5E8EE",
          background: openCount > 0 ? "#FDECEA44" : allClear ? "#E9F1EA44" : "#FAF1DD44",
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0, width: 9, height: 9, borderRadius: "50%",
            background: openCount === 0 && allClear ? "#2E8E3A" : blockingCount > 0 ? "#B43838" : "#8A5310",
            boxShadow: `0 0 0 3px ${openCount === 0 && allClear ? "#E9F1EA" : blockingCount > 0 ? "#FAE6E6" : "#FAF1DD"}`,
          }}
        />
        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: "#0B1A2F", whiteSpace: "nowrap" }}>
            Issues
          </span>
          <span style={{ fontSize: 10.5, color: "#5E6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {openCount > 0 ? "Fix these before you send" : allClear ? "Nothing to fix" : "Something else stopped this order"}
          </span>
        </span>
        <span style={{ marginLeft: "auto", flexShrink: 0 }}>
          {openCount > 0 ? (
            <span
              data-testid="issues-column-count"
              style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", padding: "2px 8px", borderRadius: 999, background: badge.bg, color: badge.fg }}
            >
              {openCount}
            </span>
          ) : allClear ? (
            <span aria-hidden style={{ display: "inline-flex", width: 18, height: 18, borderRadius: "50%", background: "#2E8E3A", alignItems: "center", justifyContent: "center" }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ) : (
            /* A tick here would say the order is fine. It is not — it just has no
               FIELD problems left. #FFFFFF on #B36D14 is 3.7:1, non-text glyph. */
            <span aria-hidden style={{ display: "inline-flex", width: 18, height: 18, borderRadius: "50%", background: "#B36D14", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontSize: 12, fontWeight: 800 }}>
              !
            </span>
          )}
        </span>
      </div>
      {/* Issues body — its own scroll region, capped so the preview keeps a body. */}
      <div
        ref={bodyRef}
        style={{ flex: "0 1 auto", minHeight: 0, maxHeight: "46%", overflow: "auto", padding: 14, background: "#F6F7FA", borderBottom: "1px solid #E5E8EE" }}
      >
        {issuesSlot}
      </div>
      {/* Preview body — always mounted (keeps fetched output + selected format). */}
      <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column" }}>
        {preview}
      </div>
    </div>
  );
}

// ── A thin collapsed-zone rail with a chevron to expand it (Order Workshop, v3) ─
//    44px strip with a buyer/supplier TONE-GRADIENT spine + rotated label.
// `color` paints the accent stripe, the two hairline borders and the gradient —
// all non-text, 3:1. `textColor` paints the vertical label + chevron glyph, which
// are copy at 4.5:1, so the two can't be one value: the supplier rail's #2E8E3A
// is 4.0264:1 on this #FBFBFD and #1E6D29 is 6.2049:1. Defaults to `color`
// because the buyer rail's #1E66C9 already clears the floor at 5.3483:1.
function CollapsedRail({ label, color, textColor, onExpand, chevron }: { label: string; color: string; textColor?: string; onExpand?: () => void; chevron: string }) {
  const grad = `linear-gradient(180deg, ${color}33, ${color} 50%, ${color}33)`;
  return (
    <button
      type="button"
      onClick={onExpand}
      disabled={!onExpand}
      aria-label={`Expand ${label}`}
      title={`Expand ${label}`}
      style={{
        width: 46, minHeight: 240, alignSelf: "stretch", position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 12,
        borderRadius: 0, border: `1px solid ${color}33`, background: "#FBFBFD",
        color: textColor ?? color, cursor: onExpand ? "pointer" : "default", padding: "12px 0", overflow: "hidden",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: grad }} />
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${color}40`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{chevron}</span>
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", marginTop: 2 }}>
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
        position: "absolute", top: 60, zIndex: 6,
        ...(side === "left" ? { right: -13 } : { left: -13 }),
        width: 26, height: 26, borderRadius: 6, border: "1px solid #E5E8EE",
        background: "#FFFFFF", color: "#5E6779", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, lineHeight: 1, padding: 0,
        boxShadow: "0 2px 8px rgba(11,26,47,0.12)",
        transition: "background .12s, border-color .12s, color .12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#F1F3F7"; e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.color = "#0B1A2F"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#E5E8EE"; e.currentTarget.style.color = "#5E6779"; }}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

// `sourceTypeFromKey()` lived here. It split its argument on "." and switched on the extension,
// and `model.sourceFileKey` — the value it was handed — was the ORDER ID. An order id has no
// extension, so it returned `undefined` on every render of this route and the format chip never
// once appeared, without ever throwing. The replacement is the served document's `Content-Type`
// (`sourceFormatLabel` in src/lib/sourceDocument.ts), which is the only thing that establishes
// the format; the model's flag is now a boolean called `hasIncomingSource`, so there is nothing
// left here that looks like a filename.

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
        color: allMapped ? "#1E6D29" : "#5E6779",
        background: allMapped ? "#EAF6EC" : "#F3F4F7",
        border: `1px solid ${allMapped ? "#CDE7D1" : "#E5E8EE"}`,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M2.5 6.2 L5 8.6 L9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {mapped} of {total} mapped
    </span>
  );
}

// ── Per-row validation badge (catalog/validation only — NOT a transform editor) ──
function ValidationBadge({ state, blocking, reason }: { state: "valid" | "review"; blocking?: boolean; reason?: string | null }) {
  if (state === "valid") return null; // a clean field needs no badge
  // #9A6B00 on this badge's #FFF7E6 was 4.3999:1 — a near-miss under the 4.5:1
  // floor for 9px/700. --amber-text (#8A5310) is 5.9237:1. The border is unchanged.
  const tone = blocking
    ? { bg: "#FBE3E3", color: "#B43838", border: "#F0C8C8", label: "needs review" }
    : { bg: "#FFF7E6", color: "#8A5310", border: "#F1E2BE", label: "review" };
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
    <Card edge="bridge" flush>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #EEF0F4", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
        Mapping summary
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", borderBottom: "1px solid #F2F4F8", minHeight: 44 }}>
          <span style={{ fontSize: 12, color: "#5E6779" }}>{r.label}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F" }}>{r.value}</span>
        </div>
      ))}
      <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.45 }}>
        Open this order on a larger screen to drag fields into place. The mapping shown above is read-only here.
      </div>
    </Card>
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
