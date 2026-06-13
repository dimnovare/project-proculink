"use client";

// AiSuggestionContent — the violet AI suggestion card (confidence + reason +
// provenance + actions). Extracted as-is from SpineReview.tsx (batch 9 Phase A)
// minus the Reject button: per the 2026-06-11 spine-redesign spec the local
// "Reject" was a P0 dead-end (local-state strike-through, recoverable only by
// reload, never reflected on the server). "Enter manually" replaces it as the
// honest alternative — it routes through the SAME commitMappings server path.

import { useState } from "react";
import { Kbd } from "./Kbd";
import { ManualCodeRow, type LineEditApi } from "./ManualCodeRow";

/** The minimal line shape the AI card needs (subset of SpineReview's SubNode). */
export interface AiSuggestionLineRef {
  id: string;
  lineNo?: number | null;
  sku: string;
  /**
   * AI confidence 0–100 to DISPLAY. V9: this is the EFFECTIVE confidence —
   * calibrated when `calibrated` is true, raw otherwise (SpineReview derives it
   * via confidenceDisplay so the chip and the bulk threshold never disagree).
   */
  pct?: number;
  aiSuggestedCode?: string;
  aiReason?: string;
  // ── V9 confidence calibration (display-only; never invented client-side) ────
  /** True only when the backend marked this suggestion calibrated. */
  calibrated?: boolean;
  /** Raw model confidence 0–100 — shown in the "raw → calibrated" detail. */
  rawPct?: number;
  /** Backend's honest basis string, shown verbatim in the tooltip/popover. */
  calibrationBasis?: string | null;
}

export function AiSuggestionContent({ sn, showAcceptKbd, showManualKbd, accepting, onAccept, lineEdit, acceptButtonRef }: {
  sn: AiSuggestionLineRef;
  /** Render the "A" kbd hint on the Accept button (first card only in the classic spine). */
  showAcceptKbd?: boolean;
  /** Render the "E" kbd hint on Enter manually (triage cards). */
  showManualKbd?: boolean;
  /** True while THIS line's resolve is committing to the server. */
  accepting: boolean;
  onAccept: (lineId: string) => void;
  /** Manual supplier-code entry API; when present, "Enter manually" is offered. */
  lineEdit?: LineEditApi;
  /** Optional ref to the Accept button — the triage focus auto-advance targets it as the card's primary control. */
  acceptButtonRef?: (el: HTMLButtonElement | null) => void;
}) {
  // Calibration explainer popover (the "ⓘ" affordance next to the confidence).
  const [basisOpen, setBasisOpen] = useState(false);
  const pct = sn.pct ?? 0;
  // Default honest basis when the backend didn't send one (older order / AI off):
  // never imply calibration we don't have.
  const basisText = sn.calibrationBasis ?? (sn.calibrated
    ? "Calibrated from your past decisions."
    : "Model estimate — not enough history yet.");
  return (
    <div
      style={{
        marginLeft: 21,
        borderRadius: 8,
        padding: "9px 11px",
        background: "#EEE7FB",
        border: "1px solid #DACEF3",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: "#5E3DB0" }}>AI</span>
        <span style={{ color: "#C4ABE8" }}>·</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#6F4FCE" }}>{pct}%</span>
        {/* V9: the "calibrated" affordance shows ONLY when the backend calibrated
            this suggestion — never implied otherwise. A button opens the honest
            basis (and raw vs calibrated). When NOT calibrated the same basis is
            still reachable on hover so the number is never presented as more
            trustworthy than it is. */}
        <button
          type="button"
          onClick={() => setBasisOpen(o => !o)}
          aria-expanded={basisOpen}
          aria-label={sn.calibrated ? "How this confidence is calibrated" : "Why this confidence is an estimate"}
          title={basisText}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, padding: sn.calibrated ? "0 5px" : 0,
            height: 14, borderRadius: 999, border: sn.calibrated ? "1px solid #C9B6EC" : "none",
            background: sn.calibrated ? "#E2D4F7" : "transparent", cursor: "pointer", lineHeight: 1,
          }}
        >
          {sn.calibrated && (
            <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.04em", color: "#5E3DB0" }}>CALIBRATED</span>
          )}
          <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: sn.calibrated ? "#6F4FCE" : "#A593CE" }}>ⓘ</span>
        </button>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#8E7CB8" }}>
          {pct >= 85 ? "high confidence" : pct >= 70 ? "good match" : "low confidence"}
        </span>
      </div>
      {basisOpen && (
        <div
          role="note"
          style={{
            marginBottom: 7, padding: "7px 9px", borderRadius: 6, background: "#FFFFFF",
            border: "1px solid #DACEF3", fontSize: 10.5, color: "#5A4A82", lineHeight: 1.45,
          }}
        >
          <div>{basisText}</div>
          {sn.calibrated && typeof sn.rawPct === "number" && sn.rawPct !== pct && (
            <div style={{ marginTop: 3, color: "#8E7CB8", fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
              raw {sn.rawPct}% → calibrated {pct}%
            </div>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#3A2A66", marginBottom: 7, lineHeight: 1.35 }}>
        Suggested supplier code{" "}
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: "#5E3DB0" }}>{sn.aiSuggestedCode ?? sn.sku}</span>
      </div>
      {/* AI reason / provenance — fetched + mapped since Group E but
          never displayed. One muted line so the reviewer sees WHY. */}
      {sn.aiReason && (
        <div style={{ fontSize: 11, color: "#6F5BA8", marginTop: -4, marginBottom: 7, lineHeight: 1.4 }}>
          {sn.aiReason}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          ref={acceptButtonRef}
          aria-label={`Accept AI suggestion for line ${sn.lineNo ?? sn.sku}`}
          onClick={() => onAccept(sn.id)}
          disabled={accepting}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none", background: "#6F4FCE", color: "#FFFFFF", cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.6 : 1 }}
          title="Accept the AI-suggested code (shortcut: A)"
        >
          {accepting ? "Saving…" : "✓ Accept"}
          {!accepting && showAcceptKbd && <Kbd>A</Kbd>}
        </button>
        {lineEdit && lineEdit.editId !== sn.id && (
          <button
            type="button"
            aria-label={`Enter a supplier code manually for line ${sn.lineNo ?? sn.sku}`}
            onClick={() => lineEdit.onStart(sn.id, sn.aiSuggestedCode ?? "")}
            disabled={accepting}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "none", background: "transparent", color: "#6F4FCE", cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.6 : 1 }}
          >
            Enter manually
            {showManualKbd && !accepting && <Kbd>E</Kbd>}
          </button>
        )}
      </div>
      {lineEdit && lineEdit.editId === sn.id && (
        <div style={{ marginTop: 8, marginLeft: -21 }}>
          <ManualCodeRow sn={sn} lineEdit={lineEdit} saving={accepting} />
        </div>
      )}
    </div>
  );
}
