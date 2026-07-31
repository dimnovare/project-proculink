"use client";

// OrderWorkshop — the unified order-review screen (Tasks 12). ONE collapsible
// surface: the IssuesPanel on top + the EXISTING MapperWorkbench enhanced (it is
// already the full 3-pane mapper, so we DO NOT compose separate
// ReceivedZone/OutputZone/MappingPanel wrappers — that would double its panes).
//
// Architecture (the corrected one, per the plan's "ARCHITECTURE CORRECTION"):
//   OrderWorkshop = IssuesPanel (issuesSlot) + <MapperWorkbench …enhanced/>
//     • collapse/focus of the mapper's incoming + preview panes, from useWorkshopLayout;
//     • attention-first default on the outgoing pane (collapse the AI-auto-mapped);
//     • onFocusField from the IssuesPanel → the mapper's existing ?field= deep-link.
//
// Data wiring REUSES the existing review hooks (useOrderReview / useResolveActions /
// useAcceptanceValidation / useSendFlow / useOrderDirection) so there is exactly ONE
// send path and ONE server-truth send guard — the workshop is a new VIEW over the same
// engine, not a second engine. Send is gated on issues.length === 0 && invariants.
//
// The drag mapper shows on a real laptop (lg, ≥1024) so a 13"/14" screen (or a split
// window down to 1024) keeps the full field mapper. Below lg we render <MobileTriage/>
// — an honest reduced REVIEW-AND-SEND surface (order summaries + the full issue list +
// one-click fixes + a sticky Send bar); field-by-field mapping stays on a wider screen.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getMappingOverride, previewMappingOverride } from "@/lib/api-client";
import { getFieldValidation } from "@/lib/api/mapper-ai";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { OrderMappingOverride } from "@/lib/api/types";
import type { CalibrationSummary } from "@/types/procurement";
import { MapperWorkbench, type MapperWorkbenchLayout, type MapperToolbarState } from "../mapper/MapperWorkbench";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { OrderProblemPanel } from "../problem/OrderProblemPanel";
import { problemFor } from "../problem/problemCopy";
import { ConfirmDialog } from "../review/ConfirmDialog";
import { buildFixQueue, type FixQueueCard } from "../review/buildFixQueue";
import { orderGrandTotalLabel, outputArtifactType, buyerLabel, orderDeliveryFormat } from "../review/orderDisplay";
import { useOrderReview } from "../review/hooks/useOrderReview";
import { useResolveActions } from "../review/hooks/useResolveActions";
import { useAcceptanceValidation } from "../review/hooks/useAcceptanceValidation";
import { useSendFlow } from "../review/hooks/useSendFlow";
import { useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";
import { InboxBackChip, WorkshopGateShell, poTitleFrom } from "./WorkshopGateChrome";
import { ParsingGate } from "./ParsingGate";
import { IssuesPanel, type WorkshopIssue, type IssuesResolveApi } from "./IssuesPanel";
import { CatalogHintCard } from "../review/CatalogHintCard";
import { WorkshopLinesView, WorkshopLinesToggle } from "./WorkshopLinesView";
import { showLinesToggle } from "./workshopLinesModel";
import { bulkAcceptCount, type BulkSelectableLine } from "../magicBulkAcceptSelection";
import { MobileTriage } from "./MobileTriage";
import { acceptanceIssues } from "./acceptanceGateModel";
import { WorkshopStepper } from "./WorkshopStepper";
import { WorkshopStatusBar, type BlockerChip } from "./WorkshopStatusBar";
import { BridgePageLoader } from "../BridgeLoader";
import { OrderDetailsDrawer, type OrderDetailsTab } from "./OrderDetailsDrawer";

/** The default trust threshold when no calibration history exists (mirrors mappingListModel). */
const DEFAULT_TRUSTED_THRESHOLD = 0.85;

/**
 * The trust threshold for the attention-first split = the LOWEST trusted bucket's
 * lower bound (the smallest confidence the org's history says it can rely on). No
 * trusted bucket / cold start → the 0.85 default.
 */
export function deriveTrustedThreshold(calibration: CalibrationSummary | null | undefined): number {
  if (!calibration?.isActive) return DEFAULT_TRUSTED_THRESHOLD;
  const trusted = calibration.buckets.filter((b) => b.isTrusted);
  if (trusted.length === 0) return DEFAULT_TRUSTED_THRESHOLD;
  return Math.min(...trusted.map((b) => b.lowerInclusive));
}

/**
 * Map the server-truth Fix Queue onto the IssuesPanel's WorkshopIssue shape:
 *   • severity: a warning-level rule failure → "warning"; everything else blocks send.
 *   • ref:      the card's owning line id (deep-links the mapper) or its stable key.
 *   • title/why ← the card's title / detail.
 *   • fixAction: ONLY for AI-suggestion cards (a deterministic one-click accept).
 * Resolved (collapsed-in-place) cards are dropped — the panel shows open work only.
 */
export function fixQueueToIssues(queue: FixQueueCard[]): WorkshopIssue[] {
  return queue
    .filter((c) => !c.resolved)
    .map((c) => {
      // buildFixQueue encodes a warning rule-failure as severity 4 (rule base 3 + 1).
      const isWarning = c.kind === "rule-failure" && c.severity === 4;
      return {
        code: c.key,
        severity: isWarning ? "warning" : "blocking",
        // A line card ("needs a supplier code") points onFocusField at the
        // SupplierItemCode OUTPUT field so the cross-column highlight lands on a
        // real mapper row — a bare lineId does not resolve for collapsed
        // multi-line orders. Rule-failures keep their key (it carries the
        // fieldPath, which resolveRowRef resolves directly).
        ref: c.kind === "rule-failure" ? c.key : "SupplierItemCode",
        title: c.title,
        why: c.detail,
        // Only the AI-suggestion card has a deterministic one-click fix.
        fixAction: c.kind === "ai-suggestion" ? { label: "Accept suggestion" } : undefined,
        // Carry the kind + owning line so the IssuesPanel can render the right
        // inline resolution control (manual-code input / accept / confirm).
        kind: c.kind,
        lineId: c.lineId,
        // The real AI-suggested code (buildFixQueue puts it in `detail` for
        // ai-suggestion cards). The card also reads it from `lines` when present;
        // carrying it here keeps the value honest even for pure-view callers.
        suggestedCode: c.kind === "ai-suggestion" ? c.detail ?? null : undefined,
      } satisfies WorkshopIssue;
    });
}

/**
 * Phase 4 — amber pill shown when the document classifier detected an invoice
 * (these orders are force-held to pending_review server-side). Ported from the
 * legacy SpineReview so the *visible explanation* survives the workshop swap.
 * Renders nothing for non-invoice documents.
 */
function InvoiceBadge({ documentType }: { documentType?: string | null }) {
  if (documentType !== "invoice") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      title="This looks like an invoice, not a purchase order. Review it carefully before sending — the supplier may reject it if they expect a PO."
      style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", background: "#FAF1DD", color: "#8A5310", whiteSpace: "nowrap" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#B36D14", flexShrink: 0 }} />
      Looks like an invoice
    </span>
  );
}

export function OrderWorkshop({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();

  // ── Live order + the same hooks the classic screen uses (ONE send path) ─────
  const { order, isLoading, isError, refetchOrder, exceptionCount, isStuck } = useOrderReview(orderId);

  // ── Audit events — only fetched for a failed order, to seed the problem panel's
  //    server-detail block when the order row itself carries no errorMessage (the
  //    parser writes the reason into the ParseFailed audit payload). Ported from
  //    the legacy SpineReview (same query key + gate). ──────────────────────────
  const { data: auditEvents = [] } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => apiClient.getOrderAudit(orderId),
    enabled: queryEnabled && order?.status === "failed",
    retry: 1,
    staleTime: 60_000,
  });
  const parseErrorFromAudit =
    (auditEvents.find((e) => e.action === "ParseFailed")?.payload?.["error"] as string | undefined) ?? null;

  const {
    flowNotice, flowSeverity, setFlow,
    sendState, crossed, confirmSend,
    showConfirm, setShowConfirm,
  } = useSendFlow({ orderId, order, labels, refetchOrder });

  // Resolution actions — header/line nodes aren't needed here (the mapper owns the
  // canonical line nodes), so we pass an empty node list; acceptSuggestion is the
  // only action the IssuesPanel one-click fix uses.
  const resolve = useResolveActions({ orderId, order, nodes: [], labels, setFlow, refetchOrder });

  // ── WP-18 — the supplier acceptance answer, at EVERY breakpoint ─────────────
  //    This query used to live in useMapperModel, which only MapperWorkbench
  //    builds — and the workshop mounts that inside `hidden lg:flex`. The count it
  //    derived fed the mapper's own canDeliver and stopped there, so `canSend`
  //    below never saw the supplier's rules and an operator on a tablet was
  //    offered a Send that WP-17's server-side gate refuses. Owned here, above any
  //    breakpoint-conditional subtree, it evaluates identically at 390/768/1440.
  //
  //    We DEFER to the server rather than mirror it: WP-17 derives each row's
  //    `blocking` flag from the same GetBlockingFailuresAsync the acceptance gate
  //    acts on, so this counts rows the server already decided. No rule is
  //    re-implemented client-side and the two cannot drift.
  //
  //    commitVersion is IN THE KEY (not an invalidate) so a fix re-evaluates the
  //    gate, and `placeholderData` keeps the previous blockers on screen while it
  //    refetches — a momentary empty result must never flash a green Send.
  const acceptanceQuery = useQuery({
    queryKey: ["order-acceptance-validation", orderId, resolve.commitVersion],
    queryFn: () => getFieldValidation(orderId),
    enabled: queryEnabled,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
    retry: 1,
  });
  const acceptanceBlockers = useMemo(
    () => acceptanceIssues(acceptanceQuery.data, labels.counterpartyNoun),
    [acceptanceQuery.data, labels.counterpartyNoun],
  );

  const validation = useAcceptanceValidation(orderId, {
    commitVersion: resolve.commitVersion,
    // Wire (not delete): validate() has no caller anywhere in src/, so this hook's
    // result was permanently null and the confirm dialog always claimed zero
    // failing rules. Seeding it from the live server answer makes that dialog
    // truthful without adding a POST on page load.
    serverBlockingCount: acceptanceBlockers.length,
    serverRevalidating: acceptanceQuery.isFetching,
  });
  const { validationResult, failingRuleCount } = validation;

  // ── AI calibration → the trust threshold for the attention-first split ──────
  const { data: calibration } = useQuery<CalibrationSummary>({
    queryKey: ["ai-calibration"],
    queryFn: () => apiClient.getAiCalibration(),
    enabled: queryEnabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const trustedThreshold = useMemo(() => deriveTrustedThreshold(calibration), [calibration]);

  // ── The per-order mapping override (seed for the mapper, same as the classic) ─
  const { data: mappingOverride } = useQuery<OrderMappingOverride | null>({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: queryEnabled,
    staleTime: 10_000,
  });

  // ── The ONE issue list — derived from the SAME validator the send guard reads.
  //    Frozen against the previous queue so it never reshuffles under the cursor. ─
  const prevQueueRef = useRef<FixQueueCard[] | null>(null);
  const fixQueue = useMemo(() => {
    const next = order ? buildFixQueue(order, validationResult, prevQueueRef.current) : [];
    prevQueueRef.current = next;
    return next;
  }, [order, validationResult]);
  // The ONE issue list every surface reads. The server's blocking acceptance rows
  // lead: they are the only entries that are certain to be refused on send, and
  // folding them in here is what carries them to the desktop IssuesPanel, the
  // status-bar blocker chips, the reduced sub-lg MobileTriage list, and
  // `blockingIssues` → `canSend` — one merge, every breakpoint.
  const issues = useMemo(
    () => [...acceptanceBlockers, ...fixQueueToIssues(fixQueue)],
    [acceptanceBlockers, fixQueue],
  );

  // ── Mobile triage summary counts ("What we received") — distinct populated
  //    header fields + the per-line fields that carry a value, from the SAME order
  //    object. Never fabricated: a field counts only when it actually has data. ──
  const receivedFieldCount = useMemo(() => {
    if (!order) return 0;
    const headerFields = [
      order.poNumber, order.orderDate, order.buyerName, order.supplierName,
      order.currency, order.grandTotal, order.subTotal, order.taxTotal, order.paymentTerms,
    ];
    let count = headerFields.filter((v) => v !== null && v !== undefined && v !== "").length;
    for (const l of order.lines) {
      const lineFields = [l.buyerItemCode, l.supplierItemCode, l.description, l.quantity, l.unit, l.unitPrice];
      count += lineFields.filter((v) => v !== null && v !== undefined && v !== "").length;
    }
    return count;
  }, [order]);

  // ── Live "What we will send" preview for the mobile card — the SAME read-only
  //    render the desktop preview uses, seeded with the persisted override and the
  //    order's actual delivery format. Read-only; never changes delivery. ────────
  const mobilePreviewFormat = order ? orderDeliveryFormat(order) : null;
  const { data: mobilePreview } = useQuery({
    queryKey: ["mobile-send-preview", orderId, mobilePreviewFormat ?? "csv"],
    queryFn: () => previewMappingOverride(
      orderId,
      mappingOverride ?? { customFields: [] },
      mobilePreviewFormat ?? "csv",
      mobilePreviewFormat != null,
    ),
    enabled: queryEnabled && order != null,
    staleTime: 30_000,
    retry: 0,
  });
  const mobilePreviewContent = mobilePreview?.error ? null : (mobilePreview?.content ?? null);

  // ── Layout (collapse/focus) ─────────────────────────────────────────────────
  const lay = useWorkshopLayout();
  const mapperLayout = useMemo<MapperWorkbenchLayout>(() => ({
    incoming: lay.grid.left,
    preview: lay.grid.right,
    // The per-pane collapse carets drive the SAME focus the All/Mapping/Output tabs do, so the tab
    // highlight always matches what's on screen: collapse the preview → Mapping (received+output);
    // collapse received → Output (output+preview); expand either rail → All (all three).
    onExpandIncoming: () => lay.setFocus("all"),
    onExpandPreview: () => lay.setFocus("all"),
    onCollapseIncoming: () => lay.setFocus("output"),
    onCollapsePreview: () => lay.setFocus("mapping"),
  }), [lay]);

  // ── Focus a field in the mapper (IssuesPanel "Where →") — bumped signal so the
  //    same field can be re-focused on a repeat click. ─────────────────────────
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [sendTip, setSendTip] = useState(false);
  // The mapper's toolbar state + handlers, published by MapperWorkbench
  // (onToolbarState) so the consolidated status bar can re-host the same
  // controls (mapped count, save state, layout/template/catalog/connections).
  const [mapperToolbar, setMapperToolbar] = useState<MapperToolbarState | null>(null);

  // ── Middle-column view: "Fields" (the existing mapper, default + unchanged) vs
  //    "Lines" (per-line mapping visibility — one row per order line). The toggle
  //    renders in the "What we'll send" pane header, only when the order has lines. ─
  const [midView, setMidView] = useState<"fields" | "lines">("fields");

  const onFocusField = useCallback((ref: string) => {
    // The Lines body-override unmounts every output-row anchor this jump scrolls
    // to — route back to Fields first. Both setState calls batch into ONE commit,
    // and the mapper consumes the signal in an effect (post-commit), so the
    // anchors exist by the time it scrolls. No-op when Fields is already active.
    setMidView("fields");
    setFocusFieldId(ref);
    setFocusSignal((n) => n + 1);
    // Always show the mapper columns when jumping to a field.
    lay.setFocus("all");
  }, [lay]);

  // An IssuesPanel line jump: switch to Lines and expand + scroll to that row.
  // Bumped signal so the same line can be re-jumped on a repeat click.
  const [lineJump, setLineJump] = useState<{ lineId: string; n: number } | null>(null);
  const onJumpToLine = useCallback((lineId: string) => {
    setMidView("lines");
    setLineJump((prev) => ({ lineId, n: (prev?.n ?? 0) + 1 }));
  }, []);
  // The Lines view reports the jump's scroll as done → clear the signal. Leaving
  // it set replays the last jump (scroll + flash to a stale row) every time the
  // Lines view is re-entered, because re-entering REMOUNTS the view.
  const onLineJumpConsumed = useCallback(() => setLineJump(null), []);

  // The status bar's "Fill from catalog" is the workbench's scroll-to-first-hint —
  // another action whose output-row target the Lines override unmounts. Wrap it so
  // it first returns to Fields, then runs the workbench's own scroll after that
  // view has committed and painted (double rAF — the same deferral the Lines jump
  // uses). When Fields is already active the wrap is just a deferred call.
  const statusBarMapper = useMemo<MapperToolbarState | null>(() => {
    if (!mapperToolbar?.fillFromCatalog) return mapperToolbar;
    const fill = mapperToolbar.fillFromCatalog;
    return {
      ...mapperToolbar,
      fillFromCatalog: () => {
        setMidView("fields");
        requestAnimationFrame(() => requestAnimationFrame(fill));
      },
    };
  }, [mapperToolbar]);

  // ── Order details drawer (audit / standards / supplier response) ────────────
  //    Secondary, lower-frequency trust surfaces relocated from the old screen's
  //    Passport/Conformance/Response tabs. Opened from a quiet header trigger.
  //    detailsTab is seeded from the ?tab= query param so a deep link
  //    (e.g. ExceptionDetail's "Check conformance" → ?tab=conformance) opens the
  //    matching drawer tab on first paint.
  const searchParams = useSearchParams();
  // ?sample=1 is appended by useSampleOrder when navigating to a practice order.
  // Reading it once on mount is sufficient — the param never changes during the session.
  const isSampleOrder = searchParams?.get("sample") === "1";
  const [detailsTab, setDetailsTab] = useState<OrderDetailsTab | null>(() => {
    const t = searchParams?.get("tab");
    return t === "passport" || t === "conformance" || t === "response" ? t : null;
  });
  // Read the live query string at call time (not the searchParams snapshot) so these
  // stay referentially stable — otherwise every ?tab= write would re-identify them and
  // needlessly re-attach the drawer's Esc/focus-trap listeners while it is open.
  const openDetails = useCallback((t: OrderDetailsTab) => {
    setDetailsTab(t);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", t);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  }, [router]);
  const closeDetails = useCallback(() => {
    setDetailsTab(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false });
  }, [router]);

  // Seed the conformance profile from the supplier's delivered format when it maps to
  // a named standard (cXML / UBL / X12); otherwise leave it for the panel to default.
  const defaultConformanceFormat = useMemo<"cxml" | "ubl" | "x12" | undefined>(() => {
    const f = (order ? orderDeliveryFormat(order) : null)?.toLowerCase() ?? "";
    if (f.includes("cxml")) return "cxml";
    if (f.includes("ubl") || f === "peppol") return "ubl";
    if (f.includes("x12") || f.includes("850")) return "x12";
    return undefined;
  }, [order]);

  // ── One-click fix for an AI-suggestion issue → the real server-path accept ──
  const onFix = useCallback((issue: WorkshopIssue) => {
    // Resolve against the OWNING LINE. `issue.ref` is NOT the line id — it's the
    // "SupplierItemCode" output-field ref used for the cross-column chip jump
    // (see fixQueueToIssues). acceptSuggestion(id) looks the line up by id
    // (order.lines.find(l => l.id === id)), so it must get issue.lineId; passing
    // ref made the one-click "Accept suggestion" a silent no-op.
    resolve.acceptSuggestion(issue.lineId ?? issue.ref);
  }, [resolve]);

  // ── The inline per-line resolution subset handed to the IssuesPanel cards.
  //    SAME server-truth path (commit → refetch) as the classic screen — the
  //    panel never resolves a line in local state. ─────────────────────────────
  const issuesResolve = useMemo<IssuesResolveApi>(() => ({
    lineEditId: resolve.lineEditId,
    lineDraft: resolve.lineDraft,
    setLineDraft: resolve.setLineDraft,
    startLineEdit: resolve.startLineEdit,
    commitLineCode: resolve.commitLineCode,
    cancelLineEdit: resolve.cancelLineEdit,
    confirmFlaggedLine: resolve.confirmFlaggedLine,
    acceptingLineId: resolve.acceptingLineId,
    // Bulk-accept parity with the /upload/preview step — the same server endpoint
    // (POST /accept-ai-suggestions) the MagicMappingPreview bulk button uses.
    bulkAcceptSuggestions: resolve.bulkAcceptSuggestions,
    bulkAccepting: resolve.bulkAccepting,
  }), [
    resolve.lineEditId, resolve.lineDraft, resolve.setLineDraft, resolve.startLineEdit,
    resolve.commitLineCode, resolve.cancelLineEdit, resolve.confirmFlaggedLine, resolve.acceptingLineId,
    resolve.bulkAcceptSuggestions, resolve.bulkAccepting,
  ]);

  // ── The catalog hint's facts (server truth, not a guess). It teaches the
  //    catalog cliff exactly when it bites: lines still need codes and NOTHING
  //    resolved automatically. The card itself stays silent until its own probe
  //    proves the supplier's catalog is empty. ────────────────────────────────
  const anyLineResolved = useMemo(
    () => !!order?.lines.some((l) => !!l.supplierItemCode),
    [order],
  );
  const catalogHint = order ? (
    <CatalogHintCard
      supplierId={order.supplierId}
      supplierName={order.supplierName}
      hasUnresolvedLines={exceptionCount > 0}
      anyLineResolved={anyLineResolved}
    />
  ) : null;

  // ── Bulk-accept scope counts — derived from order.lines, mapped to the SAME
  //    BulkSelectableLine shape MagicMappingPreview feeds bulkAcceptCount, so the
  //    workshop's "Accept all"/"Accept ≥85%" badges match the preview's semantics
  //    exactly. A line is suggestable when it's still unresolved (needsReview) AND
  //    carries an AI-suggested supplier code; the ≥85% subset uses the suggestion's
  //    own confidence (falling back to the line confidence). The workshop has no
  //    local "rejected" set (useResolveActions removed it) → empty rejection set. ─
  const { suggestableCount, highConfCount } = useMemo(() => {
    const selectable: BulkSelectableLine[] = order
      ? order.lines.map((l) => ({
          lineNumber: l.lineNumber,
          status: l.needsReview ? "suggested" : "resolved",
          aiSuggestedSupplierCode: l.aiSuggestion?.supplierItemCode ?? null,
          confidence: l.aiSuggestion?.confidence ?? l.confidence ?? null,
        }))
      : [];
    const empty: ReadonlySet<number> = new Set();
    return {
      suggestableCount: bulkAcceptCount({ lines: selectable, minConfidence: 0, rejectedLineNumbers: empty }),
      highConfCount: bulkAcceptCount({ lines: selectable, minConfidence: 0.85, rejectedLineNumbers: empty }),
    };
  }, [order]);

  // The IssuesPanel now lives in the preview column's "Issues" tab. A send-readiness
  // chip jump (a) surfaces that tab via a bumped signal, then (b) — on the next
  // frame, once the card is actually rendered/visible — scrolls to + flashes the
  // card (anchored data-issue-ref={code}).
  const [showIssuesSignal, setShowIssuesSignal] = useState(0);
  const onJumpToIssueCard = useCallback((code: string) => {
    if (typeof document === "undefined") return;
    // Guide the user to the EXACT field: light where the data originates across all
    // three columns (received / send / preview) via the mapper's focus→highlight,
    // then open the Issues tab and scroll to the card that explains the issue.
    const issue = issues.find((i) => i.code === code);
    if (issue) onFocusField(issue.ref);
    setShowIssuesSignal((s) => s + 1);
    const scroll = () => {
      const el = document.querySelector(`[data-issue-ref="${CSS.escape(code)}"]`);
      if (el) {
        el.scrollIntoView?.({ behavior: "smooth", block: "center" });
        (el as HTMLElement).animate?.(
          [{ background: "#FFF6E0" }, { background: "transparent" }],
          { duration: 1100, easing: "ease-out" },
        );
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  }, [issues, onFocusField]);

  // ── Send gate: zero issues AND server-truth exceptionCount clear AND the order
  //    is not in one of the eight problem states.
  //
  //    That last clause is ONE derived boolean instead of eight conditionals, and
  //    it is the fix for two shipped defects at once: a dead-lettered order and a
  //    supplier-rejected order both fell through every gate to this mapper and
  //    rendered a live green Send whose handler calls POST /redeliver — an
  //    endpoint whose guard set contains neither status, so the click could only
  //    ever 400. While a problem is live the panel owns the only action on screen.
  const problem = problemFor(order?.status);
  const blockingIssues = issues.filter((i) => i.severity === "blocking").length;
  const canSend = !problem && !crossed && sendState === "idle" && blockingIssues === 0 && exceptionCount === 0;
  const sendReady = blockingIssues === 0 && exceptionCount === 0;

  // ── v3 chrome derivations (pipeline stepper + send-readiness strip) ──────────
  // Parse + Normalize are always done (the order is parsed); the active stage walks
  // forward as work clears: needs-work → Validate, ready → Transform, sending →
  // Transform/Deliver, delivered → complete (5).
  const stepperStage = crossed ? 5 : sendState === "delivering" ? 4 : sendState === "transforming" ? 4 : sendReady ? 3 : 2;
  const stepperFailed = flowSeverity === "error";
  // The chip id is the issue CODE (the card's data-issue-ref anchor), so the strip
  // chip scrolls to the actionable card — not the dead line-GUID mapper jump.
  const blockerChips: BlockerChip[] = issues
    .filter((i) => i.severity === "blocking")
    .map((i) => ({ id: i.code, name: i.title }));
  const noteCount = issues.filter((i) => i.severity === "warning").length;

  // ── Display helpers for the header + confirm dialog ──────────────────────────
  // "" when the total is genuinely unknown (nothing extracted AND no priced lines
  // yet) — the header then hides the value entirely rather than showing "€ 0.00".
  const grandTotalLabel = order ? orderGrandTotalLabel(order) : "";
  // Visible header title = the PO number ("PO 4091678643"). No double prefix when
  // the extracted number already starts with "PO" (including separator-less
  // "PO12345"); "Order" when it is empty. Shared with the gate headers.
  const poTitle = poTitleFrom(order?.poNumber);
  const outputFormatLabel = order ? outputArtifactType(order.artifacts) : "";
  // The supplier's ACTUAL delivery output format — used in the Send confirmation
  // modal so it always reflects what will be delivered, not whichever format the
  // user last previewed (exploratory previews set outputFormatLabel to that tab's
  // format, which caused the modal to say "XML" when the supplier receives CSV).
  const sendModalFormat = (order ? orderDeliveryFormat(order) : "") || outputFormatLabel;

  // ── Loading / error gates (after all hooks) ─────────────────────────────────
  //    Every gate return below wraps itself in WorkshopGateShell: BridgeTopbar
  //    suppresses its breadcrumb on this route, so the shell's compact header
  //    (← Inbox · PO number · status badge where known) is the ONLY navigation
  //    context these states have.
  if (!queryEnabled || isLoading || order === undefined)
    return (
      <WorkshopGateShell>
        <BridgePageLoader
          label="Preparing your order…"
          sub="Reading your file and preparing it for review."
        />
      </WorkshopGateShell>
    );
  if (isError || order === null) {
    return (
      <WorkshopGateShell>
      <div className="flex flex-col items-center justify-center h-full gap-3.5 px-6 text-center" style={{ background: "#F6F7FA" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "#FFFFFF", border: "1px solid #E5E8EE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#CBD0DA" strokeWidth="1.6" />
            <path d="M6 6 18 18" stroke="#CBD0DA" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>
          {order === null ? "Order not found" : "Failed to load order"}
        </p>
        <p className="text-[12.5px]" style={{ color: "#5E6779", maxWidth: 340, lineHeight: 1.5 }}>
          {order === null
            ? "This order may have been delivered and archived, or the link is out of date."
            : "Something went wrong loading this order. Try again in a moment."}
        </p>
      </div>
      </WorkshopGateShell>
    );
  }

  // ── The ONE problem gate. Every problem state renders <OrderProblemPanel>; the
  //    panel's own PROBLEM_COPY decides whether that is a full-page gate or a
  //    banner over the live workshop, and only `failed` is a gate.
  //
  //    Why the other seven stopped gating: parsing produced nothing for `failed`,
  //    so there is genuinely nothing underneath to read. For every other state the
  //    extracted order, its item codes and (where it exists) the generated output
  //    are real, and they are the evidence the operator needs to act. Hiding them
  //    is what left transform_failed with a primary CTA that linked to
  //    /inbox/{id} — the page it had already replaced — so the only way out of a
  //    recoverable failure was the back chip. Rendering the workshop underneath is
  //    safe because `canSend` above is false for all eight statuses.
  //
  //    The parse error can live in the ParseFailed audit payload when the order
  //    row carries no errorMessage, so that fallback is passed through.
  if (problem?.presentation === "gate") {
    return (
      <WorkshopGateShell poNumber={order.poNumber} status={order.status}>
        <div style={{ padding: "0 24px 32px" }}>
          <OrderProblemPanel order={order} mode="gate" detailFallback={parseErrorFromAudit} />
        </div>
      </WorkshopGateShell>
    );
  }

  // ── Parsing gate — the order page is opened the instant the upload redirects,
  //    while the document is still being read server-side. Until parsing finishes
  //    the header/lines are empty (zeros / blanks), so rendering the mapper +
  //    issues here would show a half-populated, confusing screen. Show a calm,
  //    dedicated "we're reading your order" state instead. useOrderReview already
  //    polls every 3s while status === "parsing", so this auto-advances to the
  //    real review the moment the parse completes — no manual refresh needed.
  //
  //    `isStuck` is the stall escalation (parseStall.ts, 2 min). It was computed
  //    by useOrderReview and rendered NOWHERE, so a parse that never completed —
  //    the canonical symptom of a Worker outage — showed an unbounded spinner
  //    under copy promising "a few seconds". No timer is needed to make it
  //    appear: the 3s poll returns a fresh order object, which re-runs the memo. ──
  if (order.status === "parsing") {
    return (
      <WorkshopGateShell poNumber={order.poNumber} status={order.status}>
        <ParsingGate stalled={isStuck} />
      </WorkshopGateShell>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }} data-testid="order-workshop">
      {/* ── Row 1 · identity + actions (~54px): ← Inbox chip · PO title · status ·
          buyer → supplier · total — then Details / focus / Send. The topbar's
          breadcrumb row is gone on this route (BridgeTopbar suppresses it — the
          ← Inbox chip carries the 2-level path), and the old title sentence
          lives on as the sr-only h1 so heading semantics + text queries survive. */}
      <div className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E8EE" }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 lg:px-6" style={{ minHeight: 54, paddingTop: 5, paddingBottom: 5 }}>
          {/* Back chip — same target + aria as the old icon-only button; ≥44px hit
              area around the compact visible chip. Shared with the gate panels
              (WorkshopGateChrome). */}
          <InboxBackChip />
          {/* The page keeps ONE h1 — the old title sentence, screen-reader only. */}
          <h1 className="sr-only">Review and send this order</h1>
          {/* Visible title = the PO number itself (full number; raw number on title).
              min-width 0 + ellipsis so a long PO number truncates gracefully in the
              flex row at 390px instead of hard-clipping (restores the pre-compression
              truncation contract). */}
          <span
            title={order.poNumber}
            style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.15, whiteSpace: "nowrap", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {poTitle}
          </span>
          <UnifiedStatusBadge size="md" status={crossed ? "delivered" : exceptionCount > 0 ? "pending_review" : order.status} />
          <InvoiceBadge documentType={order.documentType} />
          {/* The dead-letter header chip used to live here, instructing the operator
              to "Open the order and click 'Send again' to retry" — a button that
              answers 400 from this status. The problem panel below now carries the
              real recovery (the ops requeue), so the chip has nothing left to say. */}
          {/* Buyer → supplier · total — inline on the same row (the old second line). */}
          <span className="flex items-center" style={{ minWidth: 0, fontSize: 12.5, columnGap: 7, overflow: "hidden" }}>
            <span title={buyerLabel(order)} style={{ fontWeight: 600, color: "#1E66C9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 270 }}>{buyerLabel(order)}</span>
            <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>→</span>
            <span title={order.supplierName} style={{ fontWeight: 600, color: "#2E8E3A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 270 }}>{order.supplierName}</span>
            {/* Total slot renders ONLY when a real total is known — never a fake "€ 0.00". */}
            {grandTotalLabel && (
              <>
                <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#566982", whiteSpace: "nowrap" }}>{grandTotalLabel}</span>
              </>
            )}
          </span>

          {/* Focus + Send — right-aligned. The pipeline stepper now lives at the right end of
              the ready-banner below (app.jsx structure), not the header center.
              flex-wrap so the Details/Focus/Send controls reflow instead of
              overflowing on the narrowest headers; no effect once they fit. */}
          <div className="flex flex-wrap items-center justify-end gap-3.5 flex-shrink-0 ml-auto">
            {/* Order details (audit · standards · response) — quiet secondary trigger
                that opens the relocated Passport/Conformance/Response surfaces.
                Desktop mapper (lg+): below lg the body is <MobileTriage> (review-and-send
                only), and these controls would only eat the header and clip Send. */}
            <div className="hidden lg:inline-flex">
              <button
                type="button"
                onClick={() => openDetails("passport")}
                aria-label="Order details — audit trail, standards check, and response"
                style={{ height: 33, padding: "0 13px", borderRadius: 8, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0, transition: "border-color .12s, color .12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.color = "#0B1A2F"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E5E8EE"; e.currentTarget.style.color = "#5E6779"; }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Details
              </button>
            </div>

            {/* All / Mapping / Output segmented control (app.jsx ViewTabs). It drives the
                SAME collapse/focus the per-pane carets do (they're kept too), but as a
                LABELLED control instead of an invisible chevron-only toggle:
                  • All     → both side columns open (received + output + preview);
                  • Mapping → received + output (preview rails);
                  • Output  → output + preview (received rails).
                Desktop mapper only (lg+): below lg the body is <MobileTriage>. */}
            <div className="hidden lg:inline-flex">
              <FocusControl focus={lay.focus} onFocus={lay.setFocus} />
            </div>

            {/* Send — gated by canSend (issues clear + server-truth exceptions clear).
                While blocked the button label carries the count ("Send · N blockers")
                — the old separate caption line is folded into the button itself. */}
            <div style={{ position: "relative", display: "flex", alignItems: "center" }} onMouseEnter={() => setSendTip(true)} onMouseLeave={() => setSendTip(false)}>
              <button
                type="button"
                onClick={() => canSend && setShowConfirm(true)}
                disabled={!canSend}
                /* While a problem is live the control is disabled AND renamed to
                   what the order actually needs, so a screen reader never reads
                   "Send to supplier" on an order that cannot be sent. */
                aria-label={problem ? problem.rowAction : labels.primaryCta}
                style={{
                  height: 36, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: canSend ? "#297F34" : "#5A7660", color: "#FFFFFF",
                  border: `1px solid ${canSend ? "#1E6D29" : "#5A7660"}`,
                  cursor: canSend ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0,
                  display: "inline-flex", alignItems: "center", gap: 8, transition: "filter .12s",
                }}
                onMouseEnter={(e) => { if (canSend) e.currentTarget.style.filter = "brightness(1.07)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M14.5 1.5 7.2 8.8M14.5 1.5 9.8 14.5 7.2 8.8 1.5 6.2 14.5 1.5Z" stroke="#FFFFFF" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {crossed
                  ? labels.doneLabel
                  : sendState === "transforming"
                    ? "Preparing the file…"
                    : sendState === "delivering"
                      ? labels.primaryCtaProgress
                      : !canSend && blockingIssues > 0
                        ? `Send · ${blockingIssues} ${blockingIssues === 1 ? "blocker" : "blockers"}`
                        : labels.primaryCta}
              </button>
              {sendTip && !canSend && !crossed && sendState === "idle" && (blockingIssues > 0 || exceptionCount > 0) && (
                <div
                  role="tooltip"
                  style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 230, background: "#0B1A2F", color: "#FFFFFF", borderRadius: 8, padding: "9px 12px", fontSize: 11.5, lineHeight: 1.5, boxShadow: "0 12px 30px rgba(11,26,47,.28)", zIndex: 60 }}
                >
                  Fix the {Math.max(blockingIssues, exceptionCount)} issue{Math.max(blockingIssues, exceptionCount) > 1 ? "s" : ""} below — tap each one to jump to its field. Everything must be filled before you can send.
                  <span style={{ position: "absolute", top: -5, right: 24, width: 10, height: 10, background: "#0B1A2F", transform: "rotate(45deg)" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Needs-a-supplier banner — the resolver for an order parked `unrouted`.
          Keyed on order.status and nothing else: the status badge a few lines above
          reads "Needs review" for these orders (the line-level exception flag
          outranks the routing one), so any signal derived from the issue count
          would hide this banner exactly when it is needed. Deliberately NOT a gate
          in the chain above — the extracted header and lines underneath are the
          evidence the operator uses to answer "whose order is this?". ────────── */}
      {/* ── The problem banner. Sits directly under the identity header, above the
          three columns and above MobileTriage, for all seven non-gate problem
          states (`unrouted` included — the panel delegates that one to the shipped
          AssignSupplierBanner, which owns the picker and its 409 race). The
          workshop renders read-only-for-sending underneath, so there is no control
          left to misfire while this is on screen. ─────────────────────────────── */}
      {problem && (
        <div className="flex-shrink-0 px-4 lg:px-6" style={{ paddingTop: 10, paddingBottom: 4 }}>
          <OrderProblemPanel order={order} />
        </div>
      )}

      {/* ── Practice-order banner — shown when ?sample=1 is in the URL. Mirrors the
          copy in OnboardingChecklist so the wording is consistent across all entry
          points (upload page, checklist, inbox empty state, Cmd+K). Pre-warns that
          delivery stops at "delivery not set up" — expected for the sample order,
          and honest rather than surprising. Never shown on real orders. ──────── */}
      {isSampleOrder && (
        <div
          role="note"
          aria-label="Practice order"
          className="flex-shrink-0"
          style={{
            padding: "9px 16px",
            background: "#E9F1EA",
            borderBottom: "1px solid #BFE0C2",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>🟢</span>
          <span>
            <strong style={{ color: "#1E6D29" }}>Practice order</strong>
            <span style={{ color: "#2E7D38" }}>
              {" "}— free, doesn&apos;t count against your plan.
              Sending stops at &ldquo;delivery not set up&rdquo; (expected for a practice run).
            </span>
          </span>
        </div>
      )}

      {/* ── Flow notice (send progress / errors) ─────────────────────────────── */}
      {flowNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex-shrink-0 px-4 lg:px-6"
          style={{
            padding: "8px 16px",
            background: flowSeverity === "error" ? "#FBE3E3" : flowSeverity === "success" ? "#E9F1EA" : "#EFF4FB",
            color: flowSeverity === "error" ? "#B43838" : flowSeverity === "success" ? "#1E6D29" : "#0F4FAB",
            fontSize: 12.5, fontWeight: 600,
            borderBottom: "1px solid #EEF0F4",
          }}
        >
          {flowNotice}
        </div>
      )}

      {/* ── Row 2 · ONE consolidated status bar (~42px). Replaces the old red
          SendReadinessStrip AND the mapper's "MAP THIS ORDER" toolbar row — the
          mapper is passed hideToolbar and publishes its handlers via
          onToolbarState (see mapperToolbar). Blocker chips still scroll to the
          actionable issue CARD (data-issue-ref); zero blockers → single white
          row. Desktop only — below lg MobileTriage carries its own issue list. */}
      <div className="hidden lg:block flex-shrink-0">
        <WorkshopStatusBar
          blockers={blockerChips}
          notes={noteCount}
          onJump={onJumpToIssueCard}
          onReviewIssues={() => setShowIssuesSignal((s) => s + 1)}
          onResolveAll={issuesResolve.bulkAcceptSuggestions ? () => issuesResolve.bulkAcceptSuggestions!(0) : undefined}
          resolveAllCount={suggestableCount}
          resolving={issuesResolve.bulkAccepting}
          mapper={statusBarMapper}
          pipeline={<WorkshopStepper stage={stepperStage} failed={stepperFailed} />}
        />
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Desktop mapper (lg+, ≥1024): the enhanced MapperWorkbench with the
            IssuesPanel on top. No min-width clamp — the canvas tracks (incoming
            minmax + 56px gutter + flex outgoing) fit within ~1000px so a 13"/14"
            laptop at 1024 gets the full field mapper with no horizontal scroll;
            the docked preview wraps below it until ~1440 (2-pane canvas). */}
        <div className="hidden lg:flex flex-col px-6 py-[18px]" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* The actionable issue list now lives in the preview column's "Issues"
              tab (passed as issuesSlot below), not above the mapper. */}
          <MapperWorkbench
            variant="order"
            orderId={orderId}
            supplierId={order.supplierId}
            supplierName={order.supplierName}
            initialOverride={mappingOverride}
            order={order}
            layout={mapperLayout}
            attentionFirstOutput
            mappingMode="picker"
            previewDefaultFormat={orderDeliveryFormat(order)}
            autoFilledFields={order}
            trustedThreshold={trustedThreshold}
            focusFieldId={focusFieldId}
            focusFieldSignal={focusSignal}
            onValidate={() => openDetails("conformance")}
            reviewSignal={order.lines.filter((l) => l.needsReview).length}
            hideToolbar
            onToolbarState={setMapperToolbar}
            outgoingHeaderExtra={
              showLinesToggle(order.lines.length) ? (
                <WorkshopLinesToggle
                  view={midView}
                  onView={setMidView}
                  lineCount={order.lines.length}
                  lines={order.lines}
                />
              ) : undefined
            }
            outgoingBodyOverride={
              midView === "lines" && showLinesToggle(order.lines.length) ? (
                <WorkshopLinesView
                  order={order}
                  onAcceptSuggestion={resolve.acceptSuggestion}
                  onCommitCode={resolve.confirmFlaggedLine}
                  acceptingLineId={resolve.acceptingLineId}
                  onBulkApply={
                    issuesResolve.bulkAcceptSuggestions
                      ? () => issuesResolve.bulkAcceptSuggestions!(0)
                      : undefined
                  }
                  bulkAccepting={issuesResolve.bulkAccepting}
                  jumpSignal={lineJump}
                  onJumpConsumed={onLineJumpConsumed}
                />
              ) : undefined
            }
            issuesSlot={
              <>
                {catalogHint}
                <IssuesPanel
                  issues={issues}
                  onFocusField={onFocusField}
                  onFix={onFix}
                  resolve={issuesResolve}
                  lines={order.lines}
                  suggestableCount={suggestableCount}
                  highConfCount={highConfCount}
                  onJumpToLine={onJumpToLine}
                />
              </>
            }
            issuesOpenCount={issues.length}
            issuesBlockingCount={blockingIssues}
            showIssuesSignal={showIssuesSignal}
          />
        </div>

        {/* Below xl — the v3 reduced MOBILE TRIAGE: review summaries, clear issues
            with a one-click fix, and send. Field mapping stays on the desktop
            mapper (above); this is an honest review-and-send-only surface. */}
        <MobileTriage
          poNumber={order.poNumber}
          buyerName={buyerLabel(order)}
          supplierName={order.supplierName}
          grandTotalLabel={grandTotalLabel}
          status={order.status}
          receivedFieldCount={receivedFieldCount}
          lineCount={order.lines.length}
          outputFormatLabel={outputFormatLabel}
          previewContent={mobilePreviewContent}
          issues={issues}
          blockingIssues={blockingIssues}
          exceptionCount={exceptionCount}
          canSend={canSend}
          crossed={crossed}
          sendState={sendState}
          primaryCta={labels.primaryCta}
          primaryCtaProgress={labels.primaryCtaProgress}
          doneLabel={labels.doneLabel}
          onFix={onFix}
          onFocusField={onFocusField}
          onSend={() => setShowConfirm(true)}
          resolve={issuesResolve}
          lines={order.lines}
          suggestableCount={suggestableCount}
          highConfCount={highConfCount}
          hintSlot={catalogHint}
        />
      </div>

      {/* ── Confirm dialog — the SAME one the classic screen uses (one send path). */}
      {showConfirm && (
        <ConfirmDialog
          exceptionCount={exceptionCount}
          onConfirm={confirmSend}
          onCancel={() => setShowConfirm(false)}
          supplierName={order.supplierName}
          outputFormat={sendModalFormat}
          grandTotal={grandTotalLabel || "—"}
          lineCount={order.lines.length}
          labels={labels}
          failingRuleCount={failingRuleCount}
          validationStale={validation.isStale}
        />
      )}

      {/* ── Order details (audit · standards · response) — relocated from the old
           Passport/Conformance/Response tabs; deep-linkable via ?tab=. ───────── */}
      <OrderDetailsDrawer
        open={detailsTab !== null}
        onClose={closeDetails}
        tab={detailsTab ?? "passport"}
        onTab={openDetails}
        orderId={orderId}
        poNumber={order.poNumber}
        supplierName={order.supplierName}
        currency={order.currency}
        status={order.status}
        errorMessage={order.errorMessage}
        counterpartyNoun={labels.counterpartyNoun}
        defaultConformanceFormat={defaultConformanceFormat}
      />
    </div>
  );
}

// ── Focus: All / Mapping / Output segmented control ───────────────────────────
function FocusControl({ focus, onFocus }: { focus: WorkshopFocus; onFocus: (f: WorkshopFocus) => void }) {
  const items: { id: WorkshopFocus; label: string }[] = [
    { id: "all", label: "All" },
    { id: "mapping", label: "Mapping" },
    { id: "output", label: "Output" },
  ];
  return (
    <div role="group" aria-label="Focus" style={{ display: "inline-flex", borderRadius: 8, background: "#F1F3F7", padding: 2, gap: 2, flexShrink: 0 }}>
      {items.map((it) => {
        const active = focus === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onFocus(it.id)}
            aria-pressed={active}
            style={{
              fontSize: 12.5, fontWeight: active ? 600 : 500, padding: "6px 13px", borderRadius: 6,
              background: active ? "#FFFFFF" : "transparent", color: active ? "#0B1A2F" : "#5E6779",
              border: "none", cursor: "pointer", transition: "all .12s",
              boxShadow: active ? "0 1px 2px rgba(11,26,47,0.1)" : "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
