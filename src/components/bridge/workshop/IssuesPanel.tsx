"use client";

// IssuesPanel — the ONE plain-language issue list that sits on top of the mapper
// in the Order Workshop center column (spec §"Locked decisions" #1).
//
// It is a PURE VIEW: issues come in as a prop, already derived from the unified
// validator + the order's review flags (the orchestrator maps the existing
// `FixQueueCard` set — see review/buildFixQueue.ts — onto `WorkshopIssue`). This
// panel does NOT re-implement the validator and does NO data fetching.
//
//   • N issues → N plain-language CARDS (severity badge + title + why), each with
//     its inline resolution control (Enter code / Accept / Confirm) and a
//     "Where →" affordance that scroll-highlights the field in the mapper below.
//   • A deterministic `fixAction` renders a one-click button → onFix(issue).
//   • 0 issues → the green "ready to send" bar (the list collapses).
//
// VISUAL: v3 "issues to resolve" redesign — each issue is a card with a severity
// icon box, a Blocker/Warning label + field locator, the title, the explanation,
// and the resolution actions. Mirrors the Claude Design handoff. Bridge Layer
// palette: danger = blocking, amber = warning, green = the ready/accept signal;
// AI violet is intentionally NOT used here (this is the validator's voice).
// The prop contract, test ids, roles, anchors and resolution wiring are unchanged.

import type { CSSProperties, KeyboardEvent } from "react";
import type { FixCardKind } from "../review/buildFixQueue";
import type { OrderLine } from "@/types/procurement";

/** Severity drives row coloring + send-gating (orchestrator gates Send on blocking issues). */
export type IssueSeverity = "blocking" | "warning";

/** One plain-language issue row. Mapped from the unified validator + review flags. */
export interface WorkshopIssue {
  /** Stable identity (e.g. the FixQueueCard key) — React key + dedupe. */
  code: string;
  severity: IssueSeverity;
  /** The field the issue points at — passed to onFocusField for scroll+highlight. */
  ref: string;
  /** Plain-language headline (RuleCatalog title or "Needs a supplier code"). */
  title: string;
  /** One human sentence explaining the issue (the validator message). */
  why?: string;
  /** Present only for deterministically-fixable issues → renders a one-click button. */
  fixAction?: { label: string };
  /** The FixQueueCard kind — drives which inline resolution control renders. */
  kind?: FixCardKind;
  /** The owning order line id (line-scoped cards) — keys the inline code editor. */
  lineId?: string;
  /**
   * The REAL AI-suggested supplier code (ai-suggestion cards), so the card can show
   * what "Accept suggestion" would apply WITHOUT needing the full `lines` array.
   * Never fabricated — carried straight from the line's aiSuggestion.supplierItemCode.
   */
  suggestedCode?: string | null;
  /**
   * The REAL raw model confidence (0–1) for an AI suggestion, shown as "N% match"
   * ONLY when present. Absent → no percentage rendered (never a fake number).
   */
  confidence?: number | null;
}

/**
 * The subset of `ResolveActionsApi` the inline issue-card resolution needs. Kept
 * narrow on purpose so the panel stays a thin view over the SAME server-truth
 * resolution path (commit → refetch) the classic screen uses — it never resolves
 * a line in local state.
 */
export interface IssuesResolveApi {
  /** The line id currently in inline-edit mode (null = none). */
  lineEditId: string | null;
  /** The draft supplier code being typed. */
  lineDraft: string;
  setLineDraft: (v: string) => void;
  /** Open inline edit for a line, seeded with `initial`. */
  startLineEdit: (id: string, initial: string) => void;
  /** Persist the typed code for a line (commit → refetch). */
  commitLineCode: (id: string) => void;
  /** Close inline edit without saving. */
  cancelLineEdit: () => void;
  /** Clear a flagged-but-coded line by re-committing its existing code. */
  confirmFlaggedLine: (line: Pick<OrderLine, "id" | "lineNumber" | "supplierItemCode">) => void;
  /** The line id whose Accept/Save/Confirm is in flight (drives the spinner + disable). */
  acceptingLineId: string | null;
  /**
   * Accept EVERY AI suggestion at/above `minConfidence` in ONE server call (the
   * SAME POST /accept-ai-suggestions endpoint MagicMappingPreview's bulk button
   * uses). This is server-truth only — there is no local "rejected" set in the
   * workshop's resolution model (useResolveActions deliberately removed it), so a
   * plain accept-all is correct here (no reject-aware commitMappings branch). The
   * panel's parent (OrderWorkshop) routes the feedback through setFlow. Optional so
   * pure-view callers and the existing tests render no bulk-accept header.
   */
  bulkAcceptSuggestions?: (minConfidence: number) => void;
  /** True while a bulk accept is in flight (disables both bulk-accept buttons). */
  bulkAccepting?: boolean;
}

export interface IssuesPanelProps {
  issues: WorkshopIssue[];
  /** Scroll + highlight the field this issue points at, in the mapper below. */
  onFocusField: (ref: string) => void;
  /** Apply the deterministic one-click fix for an issue (only called for issues with fixAction). */
  onFix?: (issue: WorkshopIssue) => void;
  /** Optional label for the green ready bar's Send affordance context (display only). */
  readyLabel?: string;
  /** Inline per-line resolution actions (omitted → the panel renders read-only "Where →" jumps only). */
  resolve?: IssuesResolveApi;
  /** The order lines, to read each card's current code / AI suggestion by lineId. */
  lines?: OrderLine[];
  /**
   * Count of unresolved lines that carry an AI suggestion (the "Accept all AI
   * suggestions" scope). The bulk-accept header renders only when this is > 0 AND
   * `resolve?.bulkAcceptSuggestions` is present. Optional → pure-view callers omit it.
   */
  suggestableCount?: number;
  /** The ≥0.85-confidence subset of `suggestableCount` (the "Accept ≥85% only" scope). */
  highConfCount?: number;
}

// ── Bridge Layer palette (verbatim from the design handoff) ───────────────────
const C = {
  ink: "#0B1A2F",
  inkMuted: "#5E6779",
  inkFaint: "#98A0AE",
  border: "#E5E8EE",
  borderFaint: "#EEF0F4",
  surface: "#FFFFFF",
  surface2: "#F1F3F7",
  bg: "#F6F7FA",
  navy: "#0B1A2F",
  danger: "#B43838",
  dangerSoft: "#FAE6E6",
  amber: "#B36D14",
  amberSoft: "#FAF1DD",
  green: "#2E8E3A",
  greenBtn: "#297F34", // solid fill under white text — ≈4.6:1 AA (green is 4.16:1)
  greenDeep: "#1E6D29",
  greenSoft: "#E9F1EA",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

const SEVERITY: Record<IssueSeverity, { accent: string; soft: string; label: string }> = {
  blocking: { accent: C.danger, soft: C.dangerSoft, label: "Blocker" },
  warning: { accent: C.amber, soft: C.amberSoft, label: "Warning" },
};

export function IssuesPanel({ issues, onFocusField, onFix, readyLabel, resolve, lines, suggestableCount = 0, highConfCount = 0 }: IssuesPanelProps) {
  // ── 0 issues → the green "ready to send" bar (the list collapses) ──
  if (issues.length === 0) {
    return (
      <div
        data-testid="issues-panel"
        data-issues="0"
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderRadius: 11,
          background: C.greenSoft,
          border: `1px solid ${C.green}33`,
          color: C.greenDeep,
          padding: "12px 14px",
        }}
      >
        <span
          aria-hidden
          style={{ width: 18, height: 18, borderRadius: "50%", background: C.green, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          <CheckGlyph />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Ready to send</span>
        <span style={{ fontSize: 11.5, color: "#2E7D38", fontWeight: 500 }}>
          {readyLabel ?? "No open issues — every required field is filled and checked."}
        </span>
      </div>
    );
  }

  const blocking = issues.filter((i) => i.severity === "blocking").length;
  const showBulk = !!resolve?.bulkAcceptSuggestions && suggestableCount > 0;
  const showHigh = showBulk && highConfCount > 0 && highConfCount < suggestableCount;

  return (
    <div data-testid="issues-panel" data-issues={issues.length} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header — title + count, with the bulk "resolve all" actions on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>Before you send</div>
          <div role="status" aria-live="polite" style={{ fontSize: 11.5, color: C.inkMuted, marginTop: 1 }}>
            {issues.length} {issues.length === 1 ? "issue" : "issues"}
            {blocking > 0 ? ` · ${blocking} blocking` : ""}
          </div>
        </div>

        {/* Bulk-accept parity with the /upload/preview "Confirm item codes" step — the
            SAME server-side POST /accept-ai-suggestions endpoint, surfaced here so the
            workshop is a strict superset. Shown only when there's a bulk handler AND at
            least one suggestable line. Feedback flows through the parent's setFlow. */}
        {showBulk && (
          <div data-testid="issues-bulk-accept" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => resolve!.bulkAcceptSuggestions!(0)}
              disabled={resolve!.bulkAccepting}
              title="Auto-fills supplier codes for all items using AI. You can still edit any of them afterward."
              style={{ ...navyBtn, opacity: resolve!.bulkAccepting ? 0.6 : 1, cursor: resolve!.bulkAccepting ? "wait" : "pointer" }}
            >
              <SparkleGlyph />
              {resolve!.bulkAccepting ? "Resolving…" : "Resolve all suggested"}
              <span style={countBadge}>{suggestableCount}</span>
            </button>
            {showHigh && (
              <button
                type="button"
                onClick={() => resolve!.bulkAcceptSuggestions!(0.85)}
                disabled={resolve!.bulkAccepting}
                style={{ ...ghostBtn, opacity: resolve!.bulkAccepting ? 0.6 : 1, cursor: resolve!.bulkAccepting ? "wait" : "pointer" }}
              >
                {resolve!.bulkAccepting ? "Accepting…" : "Accept ≥85% only"}
                <span style={{ ...countBadge, background: C.surface2, color: C.ink }}>{highConfCount}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* The one ordered issue list — one CARD per issue */}
      <ul role="list" aria-label="Open issues" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {issues.map((issue) => {
          const tone = SEVERITY[issue.severity];
          const line = issue.lineId && lines ? lines.find((l) => l.id === issue.lineId) : undefined;
          return (
            <li
              key={issue.code}
              role="listitem"
              data-testid="issue-row"
              data-issue-ref={issue.code}
              style={{
                border: `1px solid ${tone.accent}55`,
                borderRadius: 11,
                background: C.surface,
                overflow: "hidden",
                boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
              }}
            >
              {/* Head: severity icon box + meta + title */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 12px 9px" }}>
                <span
                  aria-hidden
                  style={{ width: 22, height: 22, borderRadius: 6, background: tone.soft, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}
                >
                  <WarnGlyph color={tone.accent} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: tone.accent }}>
                      {tone.label}
                    </span>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.inkFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {issue.ref}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 650, color: C.ink, lineHeight: 1.35 }}>{issue.title}</div>
                </div>
              </div>

              {/* Body: explanation + the resolution actions, indented under the icon */}
              <div style={{ padding: "0 12px 12px 43px" }}>
                {issue.why && (
                  <div style={{ fontSize: 11.5, color: C.inkMuted, lineHeight: 1.5, marginBottom: 10 }}>{issue.why}</div>
                )}
                <IssueActions
                  issue={issue}
                  line={line}
                  onFocusField={onFocusField}
                  onFix={onFix}
                  resolve={resolve}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Glyphs ────────────────────────────────────────────────────────────────────
function CheckGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WarnGlyph({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5l6 10.5H2z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.5V9M8 11v.4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M6 1.2l1.1 3.2 3.2 1.1-3.2 1.1L6 9.8 4.9 6.6 1.7 5.5l3.2-1.1z" fill="#FFFFFF" />
    </svg>
  );
}

// ── Shared inline button styles (v3 redesign) ────────────────────────────────
const baseBtn: CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 7,
  fontSize: 11.5,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
/** Navy = the dominant "do this" action (manual code / confirm / resolve-all). */
const navyBtn: CSSProperties = { ...baseBtn, border: `1px solid ${C.navy}`, background: C.navy, color: "#FFFFFF", fontWeight: 700 };
/** Green = accept / the supplier-out signal (AI suggestion accept, deterministic fix). */
const greenBtn: CSSProperties = { ...baseBtn, border: `1px solid ${C.greenDeep}`, background: C.greenBtn, color: "#FFFFFF", fontWeight: 700 };
/** Ghost = the subordinate alternative. */
const ghostBtn: CSSProperties = { ...baseBtn, border: "1px solid #DCE0E8", background: C.surface, color: "#345470" };
const countBadge: CSSProperties = {
  marginLeft: 2,
  background: "rgba(255,255,255,0.28)",
  borderRadius: 8,
  padding: "0 6px",
  fontSize: 10,
  fontWeight: 700,
};

/**
 * The resolution action cluster for one issue, chosen by `kind`:
 *   • manual-code → the inline supplier-code input (the #1 review action) — the
 *     primary affordance. When in edit mode it renders the input + Save; otherwise
 *     an "Enter code" button opens it.
 *   • ai-suggestion → the green one-click "Accept suggestion" (onFix) + "Enter manually".
 *   • review-flag → "Confirm" (re-commit existing code) + "Change code".
 *   • rule-failure (header) / no resolve API → the read-only "Where →" jump.
 *
 * Without a `resolve` API (or without `lines`), it degrades to the read-only "Where →"
 * so the panel is still usable as a pure view (and existing tests keep passing).
 */
function IssueActions({
  issue,
  line,
  onFocusField,
  onFix,
  resolve,
}: {
  issue: WorkshopIssue;
  line: OrderLine | undefined;
  onFocusField: (ref: string) => void;
  onFix?: (issue: WorkshopIssue) => void;
  resolve?: IssuesResolveApi;
}) {
  const lineId = issue.lineId;
  const canResolveLine = resolve != null && lineId != null && line != null;
  const editing = canResolveLine && resolve!.lineEditId === lineId;
  const busy = canResolveLine && resolve!.acceptingLineId === lineId;

  // While an inline code editor is open, it OWNS the row's action area.
  if (editing) {
    return (
      <LineCodeInput
        title={issue.title}
        value={resolve!.lineDraft}
        busy={busy}
        onChange={resolve!.setLineDraft}
        onSave={() => resolve!.commitLineCode(lineId!)}
        onCancel={resolve!.cancelLineEdit}
      />
    );
  }

  const whereButton = (
    <button
      type="button"
      onClick={() => onFocusField(issue.ref)}
      aria-label={`Show ${issue.title} in the mapper`}
      title="Scroll to this field in the mapper below"
      style={ghostBtn}
    >
      Where →
    </button>
  );

  const actionRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 };

  // No inline resolution available → the read-only jump (header rule-failures + the
  // pure-view fallback used by the panel's own unit tests). A deterministic
  // one-click fixAction (e.g. an AI accept) still renders here so a pure-view
  // caller keeps that button.
  if (!canResolveLine || issue.kind === "rule-failure") {
    return (
      <div style={actionRow}>
        {issue.fixAction && onFix && (
          <button type="button" onClick={() => onFix(issue)} style={greenBtn}>
            {issue.fixAction.label}
          </button>
        )}
        {whereButton}
      </div>
    );
  }

  if (issue.kind === "manual-code") {
    return (
      <div style={actionRow}>
        <button
          type="button"
          onClick={() => resolve!.startLineEdit(lineId!, line!.supplierItemCode ?? "")}
          disabled={busy}
          style={{ ...navyBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Saving…" : "Enter code"}
        </button>
      </div>
    );
  }

  if (issue.kind === "ai-suggestion") {
    // The REAL suggested code + confidence from the line's AI suggestion — shown only
    // when the data actually carries them. No fabricated "98% match": if there is no
    // suggestion payload we fall through to a bare accept (offer⇔works). Confidence is
    // rendered ONLY when the suggestion carries a number.
    const suggestion = line?.aiSuggestion ?? null;
    const suggestedCode = suggestion?.supplierItemCode ?? issue.suggestedCode ?? null;
    const rawConfidence = issue.confidence ?? suggestion?.confidence ?? null;
    const confidencePct =
      typeof rawConfidence === "number" && rawConfidence > 0 && rawConfidence <= 1
        ? Math.round(rawConfidence * 100)
        : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {/* The real suggested value + its real confidence (both honest, from the data). */}
        {suggestedCode && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: C.mono, fontSize: 11.5, fontWeight: 600, color: C.ink, background: C.greenSoft, border: `1px solid ${C.green}33`, borderRadius: 5, padding: "2px 7px" }}>
              {suggestedCode}
            </span>
            {confidencePct != null && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: C.greenDeep }}>{confidencePct}% match</span>
            )}
          </div>
        )}
        <div style={actionRow}>
          {issue.fixAction && onFix && (
            <button type="button" onClick={() => onFix(issue)} disabled={busy} style={{ ...greenBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
              {busy ? "Saving…" : issue.fixAction.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => resolve!.startLineEdit(lineId!, line!.aiSuggestion?.supplierItemCode ?? line!.supplierItemCode ?? "")}
            disabled={busy}
            style={ghostBtn}
          >
            Enter manually
          </button>
        </div>
      </div>
    );
  }

  if (issue.kind === "review-flag") {
    return (
      <div style={actionRow}>
        <button
          type="button"
          onClick={() => resolve!.confirmFlaggedLine({ id: line!.id, lineNumber: line!.lineNumber, supplierItemCode: line!.supplierItemCode })}
          disabled={busy || !line!.supplierItemCode}
          style={{ ...navyBtn, opacity: busy || !line!.supplierItemCode ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => resolve!.startLineEdit(lineId!, line!.supplierItemCode ?? "")}
          disabled={busy}
          style={ghostBtn}
        >
          Change code
        </button>
      </div>
    );
  }

  // Unknown kind → the read-only jump.
  return <div style={actionRow}>{whereButton}</div>;
}

/**
 * The inline supplier-code editor — a focusable text input + Save. Enter commits,
 * Esc cancels; disabled + "Saving…" while the commit is in flight. The same control
 * is reused by manual-code, ai-suggestion ("Enter manually"), and review-flag
 * ("Change code") cards.
 */
function LineCodeInput({
  title,
  value,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* autoFocus: the operator clicked to open this inline editor, so focusing it is the intent. */}
      <input
        type="text"
        autoFocus
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={`Supplier code for ${title}`}
        placeholder="supplier code"
        style={{
          height: 28,
          width: 150,
          padding: "0 9px",
          borderRadius: 7,
          fontSize: 11.5,
          fontFamily: C.mono,
          border: "1px solid #BFD0E8",
          background: busy ? "#F3F5F9" : C.surface,
          color: C.ink,
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        style={{ ...navyBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" style={ghostBtn}>
        Esc
      </button>
    </div>
  );
}
