"use client";

// AiSuggestionContent — the violet AI suggestion card (confidence + reason +
// provenance + actions). Extracted as-is from SpineReview.tsx (batch 9 Phase A)
// minus the Reject button: per the 2026-06-11 spine-redesign spec the local
// "Reject" was a P0 dead-end (local-state strike-through, recoverable only by
// reload, never reflected on the server). "Enter manually" replaces it as the
// honest alternative — it routes through the SAME commitMappings server path.

import { Kbd } from "./Kbd";
import { ManualCodeRow, type LineEditApi } from "./ManualCodeRow";

/** The minimal line shape the AI card needs (subset of SpineReview's SubNode). */
export interface AiSuggestionLineRef {
  id: string;
  lineNo?: number | null;
  sku: string;
  /** AI confidence 0–100 (from the backend suggestion). */
  pct?: number;
  aiSuggestedCode?: string;
  aiReason?: string;
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
        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#6F4FCE" }}>{sn.pct ?? 0}%</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#8E7CB8" }}>
          {(sn.pct ?? 0) >= 85 ? "high confidence" : (sn.pct ?? 0) >= 70 ? "good match" : "low confidence"}
        </span>
      </div>
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
