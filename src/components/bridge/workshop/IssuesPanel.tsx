"use client";

// IssuesPanel — the ONE plain-language issue list that sits on top of the mapper
// in the Order Workshop center column (spec §"Locked decisions" #1).
//
// It is a PURE VIEW: issues come in as a prop, already derived from the unified
// validator + the order's review flags (the orchestrator maps the existing
// `FixQueueCard` set — see review/buildFixQueue.ts — onto `WorkshopIssue`). This
// panel does NOT re-implement the validator and does NO data fetching.
//
//   • N issues → N plain-language rows (title + why), each with a "where →"
//     affordance that calls onFocusField(ref) to scroll+highlight the field in
//     the mapper below.
//   • A deterministic `fixAction` renders a one-click button → onFix(issue).
//   • 0 issues → the green "ready to send" bar (the list collapses).
//
// Bridge Layer styling: green = the ready/supplier-out signal; danger/amber for
// blocking vs warning; AI violet is intentionally NOT used here (this is the
// validator's voice, not an AI suggestion).

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

const SEVERITY_STYLE: Record<IssueSeverity, { bg: string; border: string; chipBg: string; chipColor: string; label: string }> = {
  blocking: { bg: "#FFFFFF", border: "#F0C8C8", chipBg: "#FBE3E3", chipColor: "#B43838", label: "Must fix" },
  warning: { bg: "#FFFFFF", border: "#F1E2BE", chipBg: "#FAF1DD", chipColor: "#B36D14", label: "Warning" },
};

const cardStyle: CSSProperties = {
  borderRadius: 10,
  background: "#FFFFFF",
  border: "1px solid #E5E8EE",
  overflow: "hidden",
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
          gap: 9,
          borderRadius: 10,
          background: "#E9F1EA",
          border: "1px solid #BFE0C2",
          color: "#1E6D29",
          padding: "11px 14px",
        }}
      >
        <span aria-hidden style={{ fontSize: 14, fontWeight: 800 }}>✓</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Ready to send</span>
        <span style={{ fontSize: 11.5, color: "#2E7D38", fontWeight: 500 }}>
          {readyLabel ?? "No open issues — every blocker is cleared."}
        </span>
      </div>
    );
  }

  const blocking = issues.filter((i) => i.severity === "blocking").length;

  return (
    <div data-testid="issues-panel" data-issues={issues.length} style={cardStyle}>
      {/* Header — count + blocking summary */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid #EEF0F4",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#0B1A2F",
          }}
        >
          Fix these to send
        </span>
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          {issues.length} {issues.length === 1 ? "issue" : "issues"}
          {blocking > 0 ? ` · ${blocking} blocking` : ""}
        </span>
      </div>

      {/* Bulk-accept parity with the /upload/preview "Confirm item codes" step — the
          SAME server-side POST /accept-ai-suggestions endpoint, surfaced here so the
          workshop is a strict superset. Shown only when there's a bulk handler AND at
          least one suggestable line. No local "rejected" set exists in the workshop's
          resolution model (useResolveActions removed it), so the plain accept-all is
          correct (no reject-aware commitMappings branch). Feedback flows through the
          parent's setFlow, so no separate notice is rendered here. */}
      {resolve?.bulkAcceptSuggestions && suggestableCount > 0 && (
        <div
          data-testid="issues-bulk-accept"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "9px 12px",
            borderBottom: "1px solid #EEF0F4",
            background: "#FAFBFD",
          }}
        >
          <button
            type="button"
            onClick={() => resolve.bulkAcceptSuggestions!(0)}
            disabled={resolve.bulkAccepting}
            style={{ ...primaryBtn, opacity: resolve.bulkAccepting ? 0.6 : 1, cursor: resolve.bulkAccepting ? "wait" : "pointer" }}
          >
            {resolve.bulkAccepting ? "Accepting…" : "Accept all AI suggestions"}
            <span
              style={{
                marginLeft: 6,
                background: "rgba(255,255,255,0.28)",
                borderRadius: 8,
                padding: "0 5px",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {suggestableCount}
            </span>
          </button>
          {highConfCount > 0 && highConfCount < suggestableCount && (
            <button
              type="button"
              onClick={() => resolve.bulkAcceptSuggestions!(0.85)}
              disabled={resolve.bulkAccepting}
              style={{ ...ghostBtn, opacity: resolve.bulkAccepting ? 0.6 : 1, cursor: resolve.bulkAccepting ? "wait" : "pointer" }}
            >
              {resolve.bulkAccepting ? "Accepting…" : "Accept ≥85% only"}
              <span
                style={{
                  marginLeft: 6,
                  background: "#F1F3F7",
                  borderRadius: 8,
                  padding: "0 5px",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {highConfCount}
              </span>
            </button>
          )}
        </div>
      )}

      {/* The one ordered issue list */}
      <ul role="list" aria-label="Open issues" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {issues.map((issue) => {
          const tone = SEVERITY_STYLE[issue.severity];
          const line = issue.lineId && lines ? lines.find((l) => l.id === issue.lineId) : undefined;
          return (
            <li
              key={issue.code}
              role="listitem"
              data-testid="issue-row"
              data-issue-ref={issue.code}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderTop: "1px solid #F5F6F9",
                borderLeft: `3px solid ${tone.chipColor}`,
                background: tone.bg,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  marginTop: 1,
                  fontSize: 9,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: tone.chipBg,
                  color: tone.chipColor,
                }}
              >
                {tone.label}
              </span>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0B1A2F", lineHeight: 1.35 }}>
                  {issue.title}
                </div>
                {issue.why && (
                  <div style={{ marginTop: 2, fontSize: 11.5, color: "#5E6779", lineHeight: 1.45 }}>
                    {issue.why}
                  </div>
                )}
              </div>

              <IssueActions
                issue={issue}
                line={line}
                onFocusField={onFocusField}
                onFix={onFix}
                resolve={resolve}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Shared inline button styles ───────────────────────────────────────────────
const primaryBtn: CSSProperties = {
  height: 26,
  padding: "0 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  border: "none",
  background: "#2E8E3A",
  color: "#FFFFFF",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const ghostBtn: CSSProperties = {
  height: 26,
  padding: "0 9px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  border: "1px solid #DCE0E8",
  background: "#FFFFFF",
  color: "#345470",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * The right-hand action cluster for one issue, chosen by `kind`:
 *   • manual-code → the inline supplier-code input (the #1 review action) — REPLACES
 *     the dead "Where →" as the primary affordance. When in edit mode it renders the
 *     input + Save; otherwise an "Enter code" button opens it.
 *   • ai-suggestion → keep the green one-click "Accept suggestion" (onFix) + "Enter manually".
 *   • review-flag → "Confirm" (re-commit existing code) + "Change code".
 *   • rule-failure (header) / no resolve API → the read-only "Where →" jump (unchanged).
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

  // No inline resolution available → the read-only jump (header rule-failures + the
  // pure-view fallback used by the panel's own unit tests). A deterministic
  // one-click fixAction (e.g. an AI accept) still renders here so a pure-view
  // caller keeps that button.
  if (!canResolveLine || issue.kind === "rule-failure") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {issue.fixAction && onFix && (
          <button type="button" onClick={() => onFix(issue)} style={primaryBtn}>
            {issue.fixAction.label}
          </button>
        )}
        {whereButton}
      </div>
    );
  }

  if (issue.kind === "manual-code") {
    // Primary, inline: open the code input. (Replaces the dead "Where →".)
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => resolve!.startLineEdit(lineId!, line!.supplierItemCode ?? "")}
          disabled={busy}
          style={{ ...primaryBtn, background: "#0F4FAB", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Saving…" : "Enter code"}
        </button>
      </div>
    );
  }

  if (issue.kind === "ai-suggestion") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {issue.fixAction && onFix && (
          <button type="button" onClick={() => onFix(issue)} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
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
    );
  }

  if (issue.kind === "review-flag") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => resolve!.confirmFlaggedLine({ id: line!.id, lineNumber: line!.lineNumber, supplierItemCode: line!.supplierItemCode })}
          disabled={busy || !line!.supplierItemCode}
          style={{ ...primaryBtn, opacity: busy || !line!.supplierItemCode ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
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
  return <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>{whereButton}</div>;
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
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
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
          height: 26,
          width: 132,
          padding: "0 8px",
          borderRadius: 6,
          fontSize: 11.5,
          fontFamily: "'JetBrains Mono',monospace",
          border: "1px solid #BFD0E8",
          background: busy ? "#F3F5F9" : "#FFFFFF",
          color: "#0B1A2F",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" style={ghostBtn}>
        Esc
      </button>
    </div>
  );
}
