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

import type { CSSProperties } from "react";

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
}

export interface IssuesPanelProps {
  issues: WorkshopIssue[];
  /** Scroll + highlight the field this issue points at, in the mapper below. */
  onFocusField: (ref: string) => void;
  /** Apply the deterministic one-click fix for an issue (only called for issues with fixAction). */
  onFix?: (issue: WorkshopIssue) => void;
  /** Optional label for the green ready bar's Send affordance context (display only). */
  readyLabel?: string;
}

const SEVERITY_STYLE: Record<IssueSeverity, { bg: string; border: string; chipBg: string; chipColor: string; label: string }> = {
  blocking: { bg: "#FFFFFF", border: "#F0C8C8", chipBg: "#FBE3E3", chipColor: "#C53A3A", label: "Blocking" },
  warning: { bg: "#FFFFFF", border: "#F1E2BE", chipBg: "#FAEFD6", chipColor: "#C97A14", label: "Warning" },
};

const cardStyle: CSSProperties = {
  borderRadius: 10,
  background: "#FFFFFF",
  border: "1px solid #E2E6EE",
  overflow: "hidden",
};

export function IssuesPanel({ issues, onFocusField, onFix, readyLabel }: IssuesPanelProps) {
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
          background: "#E2F1E2",
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

      {/* The one ordered issue list */}
      <ul role="list" aria-label="Open issues" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {issues.map((issue) => {
          const tone = SEVERITY_STYLE[issue.severity];
          return (
            <li
              key={issue.code}
              role="listitem"
              data-testid="issue-row"
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
                  <div style={{ marginTop: 2, fontSize: 11.5, color: "#56627A", lineHeight: 1.45 }}>
                    {issue.why}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {issue.fixAction && onFix && (
                  <button
                    type="button"
                    onClick={() => onFix(issue)}
                    style={{
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
                    }}
                  >
                    {issue.fixAction.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onFocusField(issue.ref)}
                  aria-label={`Show ${issue.title} in the mapper`}
                  title="Scroll to this field in the mapper below"
                  style={{
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
                  }}
                >
                  Where →
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
