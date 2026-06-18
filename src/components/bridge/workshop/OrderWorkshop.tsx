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
// Desktop only (the drag mapper is xl). Reduced-mobile is P2, not here — below xl we
// render an honest "open on desktop" note plus the issue list + send.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getMappingOverride } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { OrderMappingOverride } from "@/lib/api/types";
import type { CalibrationSummary } from "@/types/procurement";
import { MapperWorkbench, type MapperWorkbenchLayout } from "../mapper/MapperWorkbench";
import { SpineReviewSkeleton } from "../Skeletons";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { ConfirmDialog } from "../review/ConfirmDialog";
import { buildFixQueue, type FixQueueCard } from "../review/buildFixQueue";
import { formatMoney, resolvedGrandTotal, outputArtifactType } from "../review/orderDisplay";
import { useOrderReview } from "../review/hooks/useOrderReview";
import { useResolveActions } from "../review/hooks/useResolveActions";
import { useAcceptanceValidation } from "../review/hooks/useAcceptanceValidation";
import { useSendFlow } from "../review/hooks/useSendFlow";
import { useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";

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
        ref: c.lineId ?? c.key,
        title: c.title,
        why: c.detail,
        // Only the AI-suggestion card has a deterministic one-click fix.
        fixAction: c.kind === "ai-suggestion" ? { label: "Accept suggestion" } : undefined,
      } satisfies WorkshopIssue;
    });
}

export function OrderWorkshop({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();

  // ── Live order + the same hooks the classic screen uses (ONE send path) ─────
  const { order, isLoading, isError, refetchOrder, exceptionCount } = useOrderReview(orderId);

  const {
    flowNotice, flowSeverity, setFlow,
    sendState, crossed, confirmSend,
    showConfirm, setShowConfirm,
  } = useSendFlow({ orderId, order, labels, refetchOrder });

  // Resolution actions — header/line nodes aren't needed here (the mapper owns the
  // canonical line nodes), so we pass an empty node list; acceptSuggestion is the
  // only action the IssuesPanel one-click fix uses.
  const resolve = useResolveActions({ orderId, order, nodes: [], labels, setFlow, refetchOrder });

  const validation = useAcceptanceValidation(orderId, { commitVersion: resolve.commitVersion });
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
  const issues = useMemo(() => fixQueueToIssues(fixQueue), [fixQueue]);

  // ── Layout (collapse/focus) ─────────────────────────────────────────────────
  const lay = useWorkshopLayout();
  const mapperLayout = useMemo<MapperWorkbenchLayout>(() => ({
    incoming: lay.grid.left,
    preview: lay.grid.right,
    onExpandIncoming: () => { lay.setFocus("all"); if (lay.leftCollapsed) lay.toggleLeft(); },
    onExpandPreview: () => { lay.setFocus("all"); if (lay.rightCollapsed) lay.toggleRight(); },
  }), [lay]);

  // ── Focus a field in the mapper (IssuesPanel "Where →") — bumped signal so the
  //    same field can be re-focused on a repeat click. ─────────────────────────
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const onFocusField = useCallback((ref: string) => {
    setFocusFieldId(ref);
    setFocusSignal((n) => n + 1);
    // Always show the mapper columns when jumping to a field.
    lay.setFocus("all");
  }, [lay]);

  // ── One-click fix for an AI-suggestion issue → the real server-path accept ──
  const onFix = useCallback((issue: WorkshopIssue) => {
    // ref is the line id for line-scoped cards (acceptSuggestion resolves it).
    resolve.acceptSuggestion(issue.ref);
  }, [resolve]);

  // ── Send gate: zero issues AND server-truth exceptionCount clear. ───────────
  const blockingIssues = issues.filter((i) => i.severity === "blocking").length;
  const canSend = !crossed && sendState === "idle" && blockingIssues === 0 && exceptionCount === 0;

  // ── Display helpers for the header + confirm dialog ──────────────────────────
  const grandTotalLabel = order ? formatMoney(order.currency, resolvedGrandTotal(order)) : "";
  const outputFormatLabel = order ? outputArtifactType(order.artifacts) : "";

  // ── Loading / error gates (after all hooks) ─────────────────────────────────
  if (!queryEnabled || isLoading || order === undefined) return <SpineReviewSkeleton />;
  if (isError || order === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ background: "#F6F7FA" }}>
        <div style={{ fontSize: 28, color: "#C6CDDA" }}>⊘</div>
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>
          {order === null ? "Order not found" : "Failed to load order"}
        </p>
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="rounded-[6px] px-4 text-[12.5px] font-semibold"
          style={{ height: 34, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          ← Back to inbox
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }} data-testid="order-workshop">
      {/* ── Header: back · PO · status · buyer→supplier · focus control · Send ── */}
      <div className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-3.5 pb-3.5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3 lg:flex-1">
            <button
              onClick={() => router.push("/inbox")}
              aria-label="Back to inbox"
              style={{ width: 30, height: 30, border: "1px solid #E2E6EE", borderRadius: 7, background: "#FFFFFF", color: "#56627A", cursor: "pointer", fontSize: 14, flexShrink: 0 }}
            >
              ←
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.1, whiteSpace: "nowrap" }}>
                  {order.poNumber}
                </h1>
                <UnifiedStatusBadge size="md" status={crossed ? "delivered" : exceptionCount > 0 ? "pending_review" : order.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5" style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#0F4FAB", whiteSpace: "nowrap" }}>{order.buyerName ?? "(parsing…)"}</span>
                <span style={{ color: "#C6CDDA" }}>→</span>
                <span style={{ fontWeight: 600, color: "#1E6D29", whiteSpace: "nowrap" }}>{order.supplierName}</span>
                <span style={{ color: "#C6CDDA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#566982", whiteSpace: "nowrap" }}>{grandTotalLabel}</span>
              </div>
            </div>
          </div>

          {/* Focus: All / Mapping / Output — the progressive-disclosure control. */}
          <FocusControl focus={lay.focus} onFocus={lay.setFocus} />

          {/* Send — gated by canSend (issues clear + server-truth exceptions clear). */}
          <button
            type="button"
            onClick={() => canSend && setShowConfirm(true)}
            disabled={!canSend}
            aria-label={labels.primaryCta}
            style={{
              height: 36, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: canSend ? "#2E8E3A" : "#96C69C", color: "#FFFFFF", border: "none",
              cursor: canSend ? "pointer" : "default", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {crossed
              ? labels.doneLabel
              : sendState === "transforming"
                ? "Generating…"
                : sendState === "delivering"
                  ? labels.primaryCtaProgress
                  : blockingIssues > 0 || exceptionCount > 0
                    ? `Fix ${Math.max(blockingIssues, exceptionCount)} to send`
                    : labels.primaryCta}
          </button>
        </div>
      </div>

      {/* ── Flow notice (send progress / errors) ─────────────────────────────── */}
      {flowNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex-shrink-0 px-4 lg:px-6"
          style={{
            padding: "8px 16px",
            background: flowSeverity === "error" ? "#FBE3E3" : flowSeverity === "success" ? "#E2F1E2" : "#EFF4FB",
            color: flowSeverity === "error" ? "#C53A3A" : flowSeverity === "success" ? "#1E6D29" : "#0F4FAB",
            fontSize: 12.5, fontWeight: 600,
            borderBottom: "1px solid #EEF0F4",
          }}
        >
          {flowNotice}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "auto" }}>
        {/* Desktop (xl): the enhanced MapperWorkbench with the IssuesPanel on top. */}
        <div className="hidden xl:block min-w-[1120px] px-6 py-[18px]">
          <MapperWorkbench
            variant="order"
            orderId={orderId}
            supplierId={order.supplierId}
            supplierName={order.supplierName}
            initialOverride={mappingOverride}
            order={order}
            issuesSlot={
              <IssuesPanel
                issues={issues}
                onFocusField={onFocusField}
                onFix={onFix}
                readyLabel={`Every blocker is cleared — ready to send to ${order.supplierName}.`}
              />
            }
            layout={mapperLayout}
            attentionFirstOutput
            trustedThreshold={trustedThreshold}
            focusFieldId={focusFieldId}
            focusFieldSignal={focusSignal}
          />
        </div>

        {/* Below xl — reduced (P2 will flesh this out). The issue list + an honest
            "open on desktop to map fields" note + the Send affordance still work. */}
        <div className="xl:hidden px-4 py-4 flex flex-col gap-4">
          <IssuesPanel issues={issues} onFocusField={onFocusField} onFix={onFix} />
          <div style={{ borderRadius: 10, border: "1px solid #E2E6EE", background: "#FFFFFF", padding: "14px 16px", fontSize: 12.5, color: "#56627A", lineHeight: 1.5 }}>
            Open this order on a larger screen to drag-wire fields. You can still review issues and send from here.
          </div>
          <button
            type="button"
            onClick={() => canSend && setShowConfirm(true)}
            disabled={!canSend}
            style={{ height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 700, background: canSend ? "#2E8E3A" : "#96C69C", color: "#FFFFFF", border: "none", cursor: canSend ? "pointer" : "default" }}
          >
            {crossed ? labels.doneLabel : blockingIssues > 0 || exceptionCount > 0 ? `Fix ${Math.max(blockingIssues, exceptionCount)} to send` : labels.primaryCta}
          </button>
        </div>
      </div>

      {/* ── Confirm dialog — the SAME one the classic screen uses (one send path). */}
      {showConfirm && (
        <ConfirmDialog
          exceptionCount={exceptionCount}
          onConfirm={confirmSend}
          onCancel={() => setShowConfirm(false)}
          supplierName={order.supplierName}
          outputFormat={outputFormatLabel}
          grandTotal={grandTotalLabel}
          lineCount={order.lines.length}
          labels={labels}
          failingRuleCount={failingRuleCount}
          validationStale={validation.isStale}
        />
      )}
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
    <div role="group" aria-label="Focus" style={{ display: "inline-flex", borderRadius: 7, border: "1px solid #E2E6EE", overflow: "hidden", flexShrink: 0 }}>
      {items.map((it) => {
        const active = focus === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onFocus(it.id)}
            aria-pressed={active}
            style={{
              fontSize: 11.5, fontWeight: active ? 700 : 500, padding: "5px 12px",
              background: active ? "#0B1A2F" : "#FFFFFF", color: active ? "#FFFFFF" : "#56627A",
              border: "none", cursor: "pointer",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
