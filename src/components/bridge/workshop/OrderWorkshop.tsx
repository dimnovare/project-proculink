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
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { ConfirmDialog } from "../review/ConfirmDialog";
import { buildFixQueue, type FixQueueCard } from "../review/buildFixQueue";
import { formatMoney, resolvedGrandTotal, outputArtifactType, buyerLabel, orderDeliveryFormat } from "../review/orderDisplay";
import { useOrderReview } from "../review/hooks/useOrderReview";
import { useResolveActions } from "../review/hooks/useResolveActions";
import { useAcceptanceValidation } from "../review/hooks/useAcceptanceValidation";
import { useSendFlow } from "../review/hooks/useSendFlow";
import { useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";
import { WorkshopStepper } from "./WorkshopStepper";
import { SendReadinessStrip, type BlockerChip } from "./SendReadinessStrip";
import { WorkshopBrandLoader } from "./WorkshopBrandLoader";

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
  const [sendTip, setSendTip] = useState(false);
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
  const sendReady = blockingIssues === 0 && exceptionCount === 0;

  // ── v3 chrome derivations (pipeline stepper + send-readiness strip) ──────────
  // Parse + Normalize are always done (the order is parsed); the active stage walks
  // forward as work clears: needs-work → Validate, ready → Transform, sending →
  // Transform/Deliver, delivered → complete (5).
  const stepperStage = crossed ? 5 : sendState === "delivering" ? 4 : sendState === "transforming" ? 4 : sendReady ? 3 : 2;
  const stepperFailed = flowSeverity === "error";
  const blockerChips: BlockerChip[] = issues
    .filter((i) => i.severity === "blocking")
    .map((i) => ({ id: i.ref, name: i.title }));
  const noteCount = issues.filter((i) => i.severity === "warning").length;

  // ── Display helpers for the header + confirm dialog ──────────────────────────
  const grandTotalLabel = order ? formatMoney(order.currency, resolvedGrandTotal(order)) : "";
  const outputFormatLabel = order ? outputArtifactType(order.artifacts) : "";

  // ── Loading / error gates (after all hooks) ─────────────────────────────────
  if (!queryEnabled || isLoading || order === undefined) return <WorkshopBrandLoader />;
  if (isError || order === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3.5 px-6 text-center" style={{ background: "#F6F7FA" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "#FFFFFF", border: "1px solid #E2E6EE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#C6CDDA" strokeWidth="1.6" />
            <path d="M6 6 18 18" stroke="#C6CDDA" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>
          {order === null ? "Order not found" : "Failed to load order"}
        </p>
        <p className="text-[12.5px]" style={{ color: "#56627A", maxWidth: 340, lineHeight: 1.5 }}>
          {order === null
            ? "This order may have been delivered and archived, or the link is out of date."
            : "Something went wrong loading this order. Try again in a moment."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="rounded-[7px] px-4 text-[12.5px] font-semibold"
          style={{ height: 36, background: "#0B1A2F", color: "#FFFFFF", border: 0, marginTop: 4 }}
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
          <div className="flex min-w-0 items-center gap-3 flex-shrink-0">
            <button
              onClick={() => router.push("/inbox")}
              aria-label="Back to inbox"
              className="plk-back"
              style={{ width: 30, height: 30, minWidth: 44, minHeight: 44, padding: 0, marginInline: -7, border: 0, background: "transparent", color: "#56627A", cursor: "pointer", fontSize: 14, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <span
                aria-hidden
                className="plk-back-box"
                style={{ width: 30, height: 30, border: "1px solid #E2E6EE", borderRadius: 7, background: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "border-color .12s, background .12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.background = "#E3EDFB"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E6EE"; e.currentTarget.style.background = "#FFFFFF"; }}
              >
                ←
              </span>
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.1, whiteSpace: "nowrap" }}>
                  {order.poNumber}
                </h1>
                <UnifiedStatusBadge size="md" status={crossed ? "delivered" : exceptionCount > 0 ? "pending_review" : order.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5" style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#0F4FAB", whiteSpace: "nowrap" }}>{buyerLabel(order)}</span>
                <span style={{ color: "#C6CDDA" }}>→</span>
                <span style={{ fontWeight: 600, color: "#1E6D29", whiteSpace: "nowrap" }}>{order.supplierName}</span>
                <span style={{ color: "#C6CDDA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#566982", whiteSpace: "nowrap" }}>{grandTotalLabel}</span>
              </div>
            </div>
          </div>

          {/* Pipeline stepper — fills the header center on xl+. */}
          <WorkshopStepper stage={stepperStage} failed={stepperFailed} />

          {/* Focus + Send — right-aligned (the stepper fills the gap on xl). */}
          <div className="flex items-center gap-3.5 flex-shrink-0 ml-auto xl:ml-0">
            {/* Focus: All / Mapping / Output — the progressive-disclosure control. */}
            <FocusControl focus={lay.focus} onFocus={lay.setFocus} />

            {/* Send — gated by canSend (issues clear + server-truth exceptions clear). */}
            <div style={{ position: "relative" }} onMouseEnter={() => setSendTip(true)} onMouseLeave={() => setSendTip(false)}>
              <button
                type="button"
                onClick={() => canSend && setShowConfirm(true)}
                disabled={!canSend}
                aria-label={labels.primaryCta}
                style={{
                  height: 36, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: canSend ? "#2E8E3A" : "#5A7660", color: "#FFFFFF",
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
                    ? "Generating…"
                    : sendState === "delivering"
                      ? labels.primaryCtaProgress
                      : blockingIssues > 0 || exceptionCount > 0
                        ? `Fix ${Math.max(blockingIssues, exceptionCount)} to send`
                        : labels.primaryCta}
              </button>
              {sendTip && !canSend && !crossed && sendState === "idle" && (blockingIssues > 0 || exceptionCount > 0) && (
                <div
                  role="tooltip"
                  style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 230, background: "#0B1A2F", color: "#FFFFFF", borderRadius: 8, padding: "9px 12px", fontSize: 11.5, lineHeight: 1.5, boxShadow: "0 12px 30px rgba(11,26,47,.28)", zIndex: 60 }}
                >
                  Fill {Math.max(blockingIssues, exceptionCount)} required field{Math.max(blockingIssues, exceptionCount) > 1 ? "s" : ""} below first — they&apos;re highlighted in <b>what we send</b>.
                  <span style={{ position: "absolute", top: -5, right: 24, width: 10, height: 10, background: "#0B1A2F", transform: "rotate(45deg)" }} />
                </div>
              )}
            </div>
          </div>
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

      {/* ── Send-readiness strip — slim, full-width; replaces the old issues card.
          Desktop only; the mobile view keeps the full IssuesPanel list below. ──── */}
      <div className="hidden xl:block flex-shrink-0">
        <SendReadinessStrip blockers={blockerChips} notes={noteCount} ready={sendReady} onJump={onFocusField} />
      </div>

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
            layout={mapperLayout}
            attentionFirstOutput
            mappingMode="picker"
            previewDefaultFormat={orderDeliveryFormat(order)}
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
            style={{ height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 700, background: canSend ? "#2E8E3A" : "#5A7660", color: "#FFFFFF", border: "none", cursor: canSend ? "pointer" : "not-allowed" }}
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
    <div role="group" aria-label="Focus" style={{ display: "inline-flex", borderRadius: 8, background: "#EFF2F7", padding: 3, gap: 2, flexShrink: 0 }}>
      {items.map((it) => {
        const active = focus === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onFocus(it.id)}
            aria-pressed={active}
            style={{
              fontSize: 11.5, fontWeight: active ? 650 : 500, padding: "5px 14px", borderRadius: 6,
              background: active ? "#FFFFFF" : "transparent", color: active ? "#0B1A2F" : "#56627A",
              border: "none", cursor: "pointer", transition: "all .12s",
              boxShadow: active ? "0 1px 2px rgba(11,26,47,.08)" : "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
