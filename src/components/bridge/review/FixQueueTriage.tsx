"use client";

// FixQueueTriage — the "Fix Queue + Context Stage" sub-view of the Review tab
// (batch 9 Phase A foundation; spec: docs/strategy/2026-06-11-SPINE-REDESIGN-SPEC.md).
//
// Two-region grid: a stable, server-truth FIX QUEUE rail (360px at xl, 400px at
// 2xl) + a sticky CONTEXT area (Phase C grows this into the full Context Stage;
// for now it shows the selected card's canonical line row + the SAME AI/manual
// controls the classic spine uses — extracted, not reimplemented).
//
// Invariants:
//   • Every mutation routes through useResolveActions (commitMappings /
//     acceptAiSuggestions) — a card collapses to done ONLY after the order
//     refetch confirms (gates G1/G2).
//   • Queue order is FROZEN (buildFixQueue): resolved cards collapse in place,
//     new server flags APPEND with an aria-live "new issue" pill.
//   • No wire-layer involvement at all (gate G5) — this view draws no wires.
//
// Phase B additions (same spec):
//   • Focus auto-advance — after a card resolves (SERVER-confirmed collapse),
//     selection + focus move to the next open card's primary control.
//   • Roving tabindex on the rail (one tab stop; ↑/↓ navigate open cards).
//   • aria-live progress ("3 of 9 resolved") on the queue header counter.
//   • "Skip — keep flagged (S)" — advances selection, card stays OPEN with a
//     skipped badge. Pure UI state; it NEVER marks a line resolved (gate G2).
//   • Keyboard map: A accept / confirm · E enter manually · S skip · Enter
//     commits the open input · ↑/↓ navigate · ? shortcut overlay.
//   • &line=N deep link selects that line's card on mount.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Order, OrderLine } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { buildFixQueue, openCardCount, adjacentOpenKey, type FixQueueCard, type FixCardKind } from "./buildFixQueue";
import { AiSuggestionContent } from "./AiSuggestionContent";
import { ManualCodeRow, type LineEditApi } from "./ManualCodeRow";
import { KbdLight } from "./Kbd";
import type { ResolveActionsApi } from "./hooks/useResolveActions";
import type { AcceptanceValidationApi } from "./hooks/useAcceptanceValidation";

// ── Local helpers ────────────────────────────────────────────────────────────

function formatMoney(currency: string, amount: number): string {
  const prefix = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency;
  return `${prefix} ${amount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
}

const KIND_CHIP: Record<FixCardKind, { label: string; bg: string; color: string }> = {
  "ai-suggestion": { label: "AI",      bg: "#EEE7FB", color: "#5E3DB0" },
  "manual-code":   { label: "Manual",  bg: "#FBE3E3", color: "#C53A3A" },
  "review-flag":   { label: "Flagged", bg: "#FAEFD6", color: "#C97A14" },
  "rule-failure":  { label: "Rule",    bg: "#EFF5FE", color: "#0F4FAB" },
};

const FILTERS: Array<{ id: "all" | FixCardKind; label: string }> = [
  { id: "all",           label: "All" },
  { id: "ai-suggestion", label: "AI" },
  { id: "manual-code",   label: "Manual" },
  { id: "review-flag",   label: "Flagged" },
  { id: "rule-failure",  label: "Rules" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function FixQueueTriage({ order, labels, lineEdit, resolve, validation, keysEnabled }: {
  order: Order;
  labels: PartyLabels;
  /** Shared manual-code entry API (catalog ∪ mappings datalist) — same instance the classic spine uses. */
  lineEdit: LineEditApi;
  resolve: ResolveActionsApi;
  validation: AcceptanceValidationApi;
  /** False while a modal/inline edit elsewhere owns the keyboard (confirm dialog, header edit). */
  keysEnabled: boolean;
}) {
  // ── Frozen queue (server truth in, stable order out) ───────────────────────
  const [queue, setQueue] = useState<FixQueueCard[]>([]);
  const { validationResult } = validation;
  useEffect(() => {
    setQueue(prev => buildFixQueue(order, validationResult, prev));
  }, [order, validationResult]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | FixCardKind>("all");
  // Skipped cards — a pure UI badge + advance marker. NEVER feeds `resolved`
  // (gate G2): the card stays open and keeps blocking Send until the SERVER
  // clears it through the normal resolve paths.
  const [skippedKeys, setSkippedKeys] = useState<ReadonlySet<string>>(new Set());
  // '?' keyboard-shortcut overlay.
  const [helpOpen, setHelpOpen] = useState(false);
  // Card key whose PRIMARY CONTROL should receive focus once its context stage
  // has rendered (focus auto-advance after resolve / skip).
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  // Rail card buttons (roving tabindex targets), keyed by card key.
  const cardEls = useRef<Record<string, HTMLButtonElement | null>>({});
  // The selected card's primary control in the context stage (Accept / Set
  // supplier code / Confirm values / Re-validate) — assigned each render.
  const primaryControlRef = useRef<HTMLButtonElement | null>(null);
  const setPrimaryControl = useCallback((el: HTMLButtonElement | null) => {
    primaryControlRef.current = el;
  }, []);

  // Keep a sane selection. Phase B: when the SELECTED card resolves
  // (server-confirmed collapse), auto-advance to the NEXT open card in the
  // frozen order (wrapping) and move focus to its primary control. Other
  // invalid-selection states (initial load, card vanished) still fall back to
  // the first open card WITHOUT stealing focus.
  useEffect(() => {
    const sel = queue.find(c => c.key === selectedKey);
    if (sel && !sel.resolved) return;
    if (sel && sel.resolved) {
      const nextKey = adjacentOpenKey(queue, selectedKey, 1);
      setSelectedKey(nextKey);
      if (nextKey) setPendingFocusKey(nextKey);
    } else {
      const firstOpen = queue.find(c => !c.resolved);
      setSelectedKey(firstOpen ? firstOpen.key : null);
    }
  }, [queue, selectedKey]);

  // ── &line=N deep link — select that line's card once, on first queue build ──
  const searchParams = useSearchParams();
  const deepLinkDoneRef = useRef(false);
  useEffect(() => {
    if (deepLinkDoneRef.current || queue.length === 0) return;
    deepLinkDoneRef.current = true;
    const raw = searchParams.get("line");
    if (!raw) return;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const match = queue.find(c => !c.resolved && c.lineNumber === n) ?? queue.find(c => c.lineNumber === n);
    if (match && !match.resolved) setSelectedKey(match.key);
  }, [queue, searchParams]);

  // Focus auto-advance: once the pending card is the selected one and its
  // context stage has rendered, focus its primary control (rail card as
  // fallback). Runs after render, so primaryControlRef points at the NEW card.
  useEffect(() => {
    if (!pendingFocusKey || pendingFocusKey !== selectedKey) return;
    const el = primaryControlRef.current ?? cardEls.current[pendingFocusKey] ?? null;
    el?.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey, selectedKey]);

  const lineById = useMemo(() => new Map(order.lines.map(l => [l.id, l])), [order]);

  const total = queue.length;
  const open = openCardCount(queue);
  const done = total - open;
  const newCount = queue.filter(c => c.isNew && !c.resolved).length;

  const openByKind = useMemo(() => {
    const m: Record<FixCardKind, number> = { "ai-suggestion": 0, "manual-code": 0, "review-flag": 0, "rule-failure": 0 };
    for (const c of queue) if (!c.resolved) m[c.kind]++;
    return m;
  }, [queue]);

  // Bulk-accept eligibility (≥90% confidence, unresolved, no code yet).
  const bulkEligible = useMemo(
    () => order.lines.filter(l => l.needsReview && !l.supplierItemCode && l.aiSuggestion && l.aiSuggestion.confidence >= 0.9).length,
    [order],
  );

  const visible = filter === "all" ? queue : queue.filter(c => c.kind === filter || c.resolved);
  const selected = queue.find(c => c.key === selectedKey) ?? null;
  const selectedLine: OrderLine | null = selected?.lineId ? (lineById.get(selected.lineId) ?? null) : null;

  // Roving tabindex anchor: the selected card when it's visible in the current
  // filter, else the first visible open card — exactly ONE tab stop in the rail.
  const rovingKey = useMemo(() => {
    const visibleOpen = visible.filter(c => !c.resolved);
    if (selectedKey && visibleOpen.some(c => c.key === selectedKey)) return selectedKey;
    return visibleOpen[0]?.key ?? null;
  }, [visible, selectedKey]);

  // ── Skip — keep flagged (S). Advances selection + focus; the card stays
  // open with a "skipped" badge and is NEVER locally resolved (gate G2). ──────
  const skipSelected = useCallback(() => {
    if (!selected || selected.resolved) return;
    const key = selected.key;
    setSkippedKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const nextKey = adjacentOpenKey(visible, key, 1);
    if (nextKey && nextKey !== key) {
      setSelectedKey(nextKey);
      setPendingFocusKey(nextKey);
    }
  }, [selected, visible]);

  // ── Keyboard map (capture phase so the help overlay can swallow keys before
  // the parent SpineReview window listener sees them):
  //   A accept (AI) / confirm values (flagged) · E enter manually · S skip ·
  //   ↑/↓ navigate open cards · ? help overlay · Esc close help.
  // Enter-commits-input lives in ManualCodeRow itself.
  useEffect(() => {
    if (!keysEnabled) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      // While the shortcut overlay is open it owns the keyboard: Esc / ? close
      // it; everything except Tab is swallowed (Tab keeps the close button
      // reachable). stopPropagation in CAPTURE phase prevents the parent's
      // C-to-send window listener from firing underneath the overlay.
      if (helpOpen) {
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          setHelpOpen(false);
        }
        if (e.key !== "Tab") e.stopPropagation();
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // Roving tabindex: one tab stop, arrows move selection + focus between
        // open cards in the current (filtered) rail view.
        e.preventDefault();
        const nextKey = adjacentOpenKey(visible, selectedKey, e.key === "ArrowDown" ? 1 : -1);
        if (nextKey) {
          setSelectedKey(nextKey);
          cardEls.current[nextKey]?.focus();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") {
        // A = the selected card's accept-style action: accept the AI suggestion,
        // or confirm a flagged-but-coded line (same server resolve path). Falls
        // back to the first open AI card when the selection has no accept action.
        if (resolve.acceptingLineId !== null) return;
        if (selected && !selected.resolved && selected.kind === "review-flag" && selected.lineId) {
          const line = lineById.get(selected.lineId);
          if (line?.supplierItemCode) {
            e.preventDefault();
            resolve.confirmFlaggedLine(line);
          }
          return;
        }
        const card = (selected && !selected.resolved && selected.kind === "ai-suggestion")
          ? selected
          : queue.find(c => !c.resolved && c.kind === "ai-suggestion");
        if (card?.lineId) {
          e.preventDefault();
          setSelectedKey(card.key);
          resolve.acceptSuggestion(card.lineId);
        }
      } else if (k === "e") {
        if (selected && !selected.resolved && selected.lineId) {
          const line = lineById.get(selected.lineId);
          if (line) {
            e.preventDefault();
            resolve.startLineEdit(line.id, line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? "");
          }
        }
      } else if (k === "s") {
        if (selected && !selected.resolved) {
          e.preventDefault();
          skipSelected();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [keysEnabled, helpOpen, selected, selectedKey, queue, visible, resolve, lineById, skipSelected]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)] gap-5 px-4 py-4 lg:px-6 pb-[88px] xl:pb-4"
      data-testid="fix-queue-triage"
    >
      {/* ── FIX QUEUE rail ──────────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
          {/* Queue header: progress + bulk accept + filters + kbd hints */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #EEF0F4" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0B1A2F" }}>
                Fix queue
              </span>
              {/* aria-live progress — announces "3 of 9 resolved" as cards collapse. */}
              <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{done} of {total} resolved</span>
              {/* Newly server-flagged issues are APPENDED, announced here. */}
              <span aria-live="polite" style={{ marginLeft: "auto" }}>
                {newCount > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#EFF5FE", color: "#0F4FAB" }}>
                    {newCount} new issue{newCount !== 1 ? "s" : ""}
                  </span>
                )}
              </span>
            </div>
            {/* Progress bar */}
            <div aria-hidden style={{ marginTop: 8, height: 4, borderRadius: 2, background: "#EEF0F4", overflow: "hidden" }}>
              <div style={{ width: total === 0 ? "100%" : `${Math.round((done / Math.max(total, 1)) * 100)}%`, height: "100%", background: "linear-gradient(90deg,#1E6D29,#2E8E3A)", transition: "width 250ms" }} />
            </div>
            {/* Bulk accept — ONE call to the existing endpoint + ONE refetch. */}
            <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => resolve.bulkAcceptSuggestions(0.9)}
                disabled={bulkEligible === 0 || resolve.bulkAccepting}
                title="Accept every AI suggestion at ≥90% confidence in one step"
                style={{
                  fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 6, border: "none",
                  background: bulkEligible === 0 || resolve.bulkAccepting ? "#C9BCE8" : "#6F4FCE",
                  color: "#FFFFFF", cursor: bulkEligible === 0 || resolve.bulkAccepting ? "default" : "pointer",
                  minHeight: 30,
                }}
              >
                {resolve.bulkAccepting ? "Accepting…" : `Accept all ≥90% (${bulkEligible})`}
              </button>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--ink-faint)" }}>
                <KbdLight>A</KbdLight> accept · <KbdLight>E</KbdLight> manual · <KbdLight>S</KbdLight> skip · <KbdLight>C</KbdLight> send
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  aria-label="Show keyboard shortcuts"
                  title="Keyboard shortcuts (?)"
                  style={{
                    marginLeft: 2, width: 20, height: 20, borderRadius: 5, border: "1px solid #E2E6EE",
                    background: "#FFFFFF", color: "#56627A", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  ?
                </button>
              </span>
            </div>
            {/* Filter chips */}
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {FILTERS.map(f => {
                const count = f.id === "all" ? open : openByKind[f.id];
                const active = filter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={active}
                    style={{
                      fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                      border: `1px solid ${active ? "#0B1A2F" : "#E2E6EE"}`,
                      background: active ? "#0B1A2F" : "#FFFFFF",
                      color: active ? "#FFFFFF" : "#56627A",
                      cursor: "pointer",
                    }}
                  >
                    {f.label} {count}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card list — FROZEN order; resolved collapse in place. */}
          <div role="list" aria-label="Open issues">
            {visible.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: 12.5, color: "var(--ink-faint)" }}>
                {total === 0 ? "No open issues — this order has nothing blocking it." : "No issues match this filter."}
              </div>
            )}
            {visible.map(card => {
              const line = card.lineId ? lineById.get(card.lineId) : undefined;
              const isSelected = card.key === selectedKey;
              const chip = KIND_CHIP[card.kind];
              if (card.resolved) {
                // Collapsed-in-place resolved row (28px) — keeps its index.
                return (
                  <div
                    key={card.key}
                    role="listitem"
                    style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px", borderTop: "1px solid #F5F6F9", background: "#FAFBFC" }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#1E6D29" }}>✓</span>
                    <span style={{ fontSize: 11, color: "#8A94A6", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {card.lineNumber != null ? `Line ${card.lineNumber} · ` : ""}{card.title}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: "#1E6D29", flexShrink: 0 }}>Resolved</span>
                  </div>
                );
              }
              const isSkipped = skippedKeys.has(card.key);
              return (
                <div key={card.key} role="listitem" style={{ borderTop: "1px solid #F5F6F9" }}>
                  <button
                    type="button"
                    ref={(el) => { cardEls.current[card.key] = el; }}
                    tabIndex={card.key === rovingKey ? 0 : -1}
                    onClick={() => setSelectedKey(card.key)}
                    aria-current={isSelected ? "true" : undefined}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "9px 12px",
                      background: isSelected ? "rgba(46,142,58,0.06)" : "#FFFFFF",
                      border: "none", borderLeft: `3px solid ${isSelected ? "#2E8E3A" : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.03em", padding: "1px 6px", borderRadius: 4, background: chip.bg, color: chip.color, flexShrink: 0 }}>
                        {chip.label}
                      </span>
                      {card.lineNumber != null && (
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", flexShrink: 0 }}>#{card.lineNumber}</span>
                      )}
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {line?.description ?? line?.buyerItemCode ?? card.title}
                      </span>
                      {(card.isNew || isSkipped) && (
                        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, flexShrink: 0 }}>
                          {/* Skipped = still open + still blocking; just visited and deferred. */}
                          {isSkipped && (
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", padding: "1px 5px", borderRadius: 4, background: "#F0F2F7", color: "#56627A", border: "1px solid #E2E6EE" }}>
                              skipped
                            </span>
                          )}
                          {card.isNew && (
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", padding: "1px 5px", borderRadius: 4, background: "#EFF5FE", color: "#0F4FAB" }}>
                              new
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#56627A" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {card.kind === "ai-suggestion" && line?.aiSuggestion
                          ? <>Suggests <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: "#5E3DB0" }}>{line.aiSuggestion.supplierItemCode}</span> · {Math.round(line.aiSuggestion.confidence * 100)}%</>
                          : card.kind === "review-flag" && line?.supplierItemCode
                          ? <>Has code <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: "#C97A14" }}>{line.supplierItemCode}</span> — flagged for review</>
                          : card.kind === "rule-failure"
                          ? <>{card.title}{card.detail ? ` · ${card.detail}` : ""}</>
                          : card.title}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Supplier acceptance (compact strip — replaces the deleted always-on panel) ── */}
        <div style={{ marginTop: 12, borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: "1px solid #EEF0F4" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#56627A" }}>
              Supplier acceptance
            </span>
            <button
              type="button"
              onClick={() => validation.validate()}
              disabled={validation.isValidating}
              style={{
                minHeight: 26, padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: "#0B1A2F", color: "#FFFFFF", border: "none",
                cursor: validation.isValidating ? "default" : "pointer", opacity: validation.isValidating ? 0.7 : 1,
              }}
            >
              {validation.isValidating ? "Validating…" : validation.validationResult ? "Re-validate" : "Validate against profile"}
            </button>
          </div>
          <div style={{ padding: "8px 12px", fontSize: 11.5 }}>
            {validation.isValidateError ? (
              <span style={{ color: "#C53A3A" }}>
                {validation.validateError instanceof Error
                  ? validation.validateError.message.includes("404") || validation.validateError.message.includes("no acceptance")
                    ? `No acceptance profile configured for this ${labels.counterpartyNoun.toLowerCase()}.`
                    : `Validation failed: ${validation.validateError.message}`
                  : "Validation failed."}
              </span>
            ) : validation.isStale ? (
              <span style={{ color: "#C97A14" }}>Re-checking after your change…</span>
            ) : validation.validationResult ? (
              validation.validationResult.passed ? (
                <span style={{ color: "#1E6D29", fontWeight: 600 }}>✓ Passed — order meets all acceptance rules</span>
              ) : (
                <span style={{ color: "#C53A3A", fontWeight: 600 }}>
                  ✗ {validation.failingRuleCount} rule{validation.failingRuleCount !== 1 ? "s" : ""} failing — see the Rules cards above
                </span>
              )
            ) : (
              <span style={{ color: "var(--ink-faint)" }}>Run validation to check this order against the supplier&apos;s acceptance rules.</span>
            )}
          </div>
        </div>
      </div>

      {/* ── CONTEXT area (Phase C grows this into the full Context Stage) ────── */}
      <div className="xl:sticky xl:top-2 self-start" style={{ minWidth: 0 }}>
        <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
          {selected && !selected.resolved ? (
            <>
              {/* Breadcrumb + Skip (the honest third action — advance without
                  resolving; the card stays open and keeps blocking Send). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid #EEF0F4" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
                  {selected.lineNumber != null ? `Line ${selected.lineNumber}` : selected.headerLevel ? "Order header" : "Acceptance rule"}
                </span>
                <span style={{ fontSize: 10.5, color: "#C6CDDA" }}>·</span>
                <span style={{ fontSize: 10.5, color: "#56627A", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {KIND_CHIP[selected.kind].label === "AI" ? "AI suggestion" : selected.title}
                </span>
                <button
                  type="button"
                  onClick={skipSelected}
                  aria-label="Skip — keep flagged, move to the next issue"
                  title="Skip — keep flagged (S). The issue stays open and still blocks Send."
                  style={{
                    marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 10.5, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
                    border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A",
                    cursor: "pointer", minHeight: 26,
                  }}
                >
                  Skip — keep flagged
                  <KbdLight>S</KbdLight>
                </button>
              </div>

              <div style={{ padding: "12px 14px" }}>
                {selectedLine ? (
                  <>
                    {/* Canonical line row — same information shape as the classic spine row. */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#A8B0BF", flexShrink: 0 }}>
                        {selectedLine.lineNumber}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", minWidth: 0 }}>
                        {selectedLine.description ?? selectedLine.buyerItemCode}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#A8B0BF" }}>
                        <span>{selectedLine.buyerItemCode}</span>
                        <span style={{ color: "#C6CDDA" }}>·</span>
                        <span>×{selectedLine.quantity}</span>
                        {selectedLine.lineAmount != null && (
                          <>
                            <span style={{ color: "#C6CDDA" }}>·</span>
                            <span title="Line amount">{formatMoney(order.currency, selectedLine.lineAmount)}</span>
                          </>
                        )}
                      </span>
                      <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                        {selectedLine.supplierItemCode ? (
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: "#1E6D29" }}>{selectedLine.supplierItemCode}</span>
                        ) : (
                          <span style={{ fontSize: 10.5, fontWeight: 700, background: "#FBE3E3", color: "#C53A3A", borderRadius: 4, padding: "1px 6px" }}>missing</span>
                        )}
                      </span>
                    </div>

                    {/* Controls — the SAME extracted components the classic spine binds. */}
                    <div style={{ marginTop: 12 }}>
                      {selected.kind === "ai-suggestion" && selectedLine.aiSuggestion && (
                        <AiSuggestionContent
                          sn={{
                            id: selectedLine.id,
                            lineNo: selectedLine.lineNumber,
                            sku: selectedLine.buyerItemCode,
                            pct: Math.round(selectedLine.aiSuggestion.confidence * 100),
                            aiSuggestedCode: selectedLine.aiSuggestion.supplierItemCode,
                            aiReason: selectedLine.aiSuggestion.reason,
                          }}
                          showAcceptKbd
                          showManualKbd
                          accepting={resolve.acceptingLineId === selectedLine.id}
                          onAccept={resolve.acceptSuggestion}
                          lineEdit={lineEdit}
                          acceptButtonRef={setPrimaryControl}
                        />
                      )}

                      {selected.kind === "manual-code" && (
                        lineEdit.editId === selectedLine.id ? (
                          <ManualCodeRow
                            sn={{ id: selectedLine.id, lineNo: selectedLine.lineNumber, sku: selectedLine.buyerItemCode }}
                            lineEdit={lineEdit}
                            saving={resolve.acceptingLineId === selectedLine.id}
                          />
                        ) : (
                          <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <span style={{ width: 4, height: 4, borderRadius: 1, background: "#C53A3A", display: "inline-block" }} />
                              Needs a supplier code
                            </span>
                            <button
                              type="button"
                              ref={setPrimaryControl}
                              onClick={() => resolve.startLineEdit(selectedLine.id, "")}
                              aria-label={`Set supplier code for line ${selectedLine.lineNumber}`}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "1px solid #1E66C9", background: "#FFFFFF", color: "#1E66C9", cursor: "pointer", minHeight: 32 }}
                            >
                              Set supplier code
                              <KbdLight>E</KbdLight>
                            </button>
                          </div>
                        )
                      )}

                      {selected.kind === "review-flag" && (
                        <div style={{ borderRadius: 8, padding: "10px 12px", background: "#FFF8EA", border: "1px solid #F0D39A" }}>
                          <div style={{ fontSize: 11.5, color: "#7A4D0A", lineHeight: 1.45, marginBottom: 8 }}>
                            This line was flagged during import — it already has a supplier code, but the
                            values couldn&apos;t be verified automatically. Check quantity, price and code,
                            then confirm.
                          </div>
                          {lineEdit.editId === selectedLine.id ? (
                            <ManualCodeRow
                              sn={{ id: selectedLine.id, lineNo: selectedLine.lineNumber, sku: selectedLine.buyerItemCode }}
                              lineEdit={lineEdit}
                              saving={resolve.acceptingLineId === selectedLine.id}
                            />
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                ref={setPrimaryControl}
                                onClick={() => resolve.confirmFlaggedLine(selectedLine)}
                                disabled={resolve.acceptingLineId === selectedLine.id}
                                aria-label={`Confirm values for line ${selectedLine.lineNumber}`}
                                style={{ fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none", background: "#2E8E3A", color: "#FFFFFF", cursor: resolve.acceptingLineId === selectedLine.id ? "default" : "pointer", opacity: resolve.acceptingLineId === selectedLine.id ? 0.6 : 1, minHeight: 32 }}
                              >
                                {resolve.acceptingLineId === selectedLine.id ? "Saving…" : "✓ Confirm values"}
                              </button>
                              <button
                                type="button"
                                onClick={() => resolve.startLineEdit(selectedLine.id, selectedLine.supplierItemCode ?? "")}
                                disabled={resolve.acceptingLineId === selectedLine.id}
                                aria-label={`Edit supplier code for line ${selectedLine.lineNumber}`}
                                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A", cursor: "pointer", minHeight: 32 }}
                              >
                                Edit code
                                <KbdLight>E</KbdLight>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : selected.kind === "rule-failure" ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: "#0B1A2F" }}>{selected.title}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C53A3A", textTransform: "capitalize" }}>failing</span>
                    </div>
                    {selected.detail && (
                      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#56627A", lineHeight: 1.5 }}>{selected.detail}</p>
                    )}
                    <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                      From the last acceptance-profile validation. Fix the order data (or accept the risk in
                      the send confirmation) and re-validate.
                    </p>
                    <button
                      type="button"
                      ref={setPrimaryControl}
                      onClick={() => validation.validate()}
                      disabled={validation.isValidating}
                      style={{ marginTop: 10, minHeight: 28, padding: "5px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: validation.isValidating ? "default" : "pointer", opacity: validation.isValidating ? 0.7 : 1 }}
                    >
                      {validation.isValidating ? "Validating…" : "Re-validate"}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>This line is no longer on the order.</div>
                )}
              </div>
            </>
          ) : (
            /* Empty / all-resolved state */
            <div style={{ padding: "28px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 22, color: open === 0 && total > 0 ? "#2E8E3A" : "#C6CDDA", marginBottom: 8 }}>
                {open === 0 && total > 0 ? "✓" : "○"}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>
                {total === 0 ? "Nothing to fix" : "All issues resolved"}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#56627A", lineHeight: 1.5 }}>
                {total === 0
                  ? "This order has no open issues. Use Full document to inspect the source, canonical and output views."
                  : `Every blocker is cleared — ${labels.primaryCta.toLowerCase()} when ready, or switch to Full document to inspect the mapping.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── '?' keyboard-shortcut overlay ──────────────────────────────────── */}
      {helpOpen && <ShortcutOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── Keyboard-shortcut overlay ('?') ──────────────────────────────────────────
// Lists the triage keyboard map. Esc / ? / backdrop / button close it; while it
// is open the triage keydown handler swallows everything else (capture phase).

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["A"],     label: "Accept the AI suggestion · confirm a flagged line" },
  { keys: ["E"],     label: "Enter a supplier code manually" },
  { keys: ["S"],     label: "Skip — keep flagged, move to the next issue" },
  { keys: ["Enter"], label: "Commit the open code input" },
  { keys: ["↑", "↓"], label: "Move between open issues" },
  { keys: ["C"],     label: "Send (when nothing blocks)" },
  { keys: ["?"],     label: "Show / hide this overlay" },
  { keys: ["Esc"],   label: "Close" },
];

function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(11,26,47,0.45)", backdropFilter: "blur(2px)", zIndex: 9980 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: 360, maxWidth: "calc(100vw - 32px)", background: "#FFFFFF", borderRadius: 12,
          boxShadow: "0 24px 64px rgba(11,26,47,0.22)", border: "1px solid #E2E6EE",
          zIndex: 9981, overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "13px 16px", borderBottom: "1px solid #EEF0F4" }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 15, fontWeight: 700, color: "#0B1A2F" }}>
            Keyboard shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A", fontSize: 13, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "10px 16px 14px" }}>
          {SHORTCUTS.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <span style={{ display: "inline-flex", gap: 4, flexShrink: 0, minWidth: 64 }}>
                {s.keys.map((k) => <KbdLight key={k}>{k}</KbdLight>)}
              </span>
              <span style={{ fontSize: 12, color: "#56627A", lineHeight: 1.4 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
