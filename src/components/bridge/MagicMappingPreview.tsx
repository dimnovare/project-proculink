"use client";

/**
 * MagicMappingPreview
 *
 * Shows a side-by-side preview of how an uploaded order's buyer item codes
 * map to canonical PO fields and supplier codes, with AI suggestions that the
 * user must explicitly Accept / Edit / Reject before committing.
 *
 * Architecture: approach B (persist-then-preview).  The order is already
 * persisted in `pending_review`.  This component renders the preview and
 * commits via the existing resolve endpoint.  Nothing irreversible happens
 * until transform/deliver.
 */

import type React from "react";
import { useState, useCallback, useReducer } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { MappingPreviewLine } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type RowState =
  | { mode: "idle" }
  | { mode: "accepted"; code: string }
  | { mode: "editing"; draft: string }
  | { mode: "rejected" };

interface RowAction {
  lineNumber: number;
  type: "accept" | "edit" | "reject" | "set_draft" | "confirm_edit" | "reset";
  draft?: string;
  code?: string;
}

interface Props {
  orderId: string;
  onCommitted?: (orderId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidencePill(confidence: number | null): React.ReactNode {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const [bg, text, dot] =
    confidence >= 0.8
      ? ["#E2F1E2", "#1E6D29", "#2E8E3A"]
      : confidence >= 0.5
      ? ["#FAEFD6", "#7A4A00", "#C97A14"]
      : ["#EFF2F7", "#56627A", "#8A93A5"];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color: text,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dot,
          flexShrink: 0,
        }}
      />
      {pct}%
    </span>
  );
}

function SourceCell({ line }: { line: MappingPreviewLine }) {
  const sf = line.sourceFields;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          fontWeight: 600,
          color: "#1E66C9",
        }}
      >
        {line.buyerItemCode ?? "(no code)"}
      </span>
      {sf.description && (
        <span style={{ fontSize: 11.5, color: "#56627A", lineHeight: 1.35 }}>
          {sf.description}
        </span>
      )}
      <span style={{ fontSize: 11, color: "#8A93A5" }}>
        {sf.quantity && `×${sf.quantity}`}
        {sf.unit && ` ${sf.unit}`}
        {sf.unitPrice && ` · ${sf.unitPrice}`}
      </span>
    </div>
  );
}

function ArrowBridge() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: 36,
      }}
      aria-hidden
    >
      <svg width="28" height="12" viewBox="0 0 28 12" fill="none">
        <defs>
          <linearGradient id="arrow-grad" x1="0" y1="0" x2="28" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        </defs>
        <line x1="0" y1="6" x2="22" y2="6" stroke="url(#arrow-grad)" strokeWidth="2" />
        <path d="M20 2 L28 6 L20 10" fill="none" stroke="#2E8E3A" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Row state reducer ────────────────────────────────────────────────────────

function rowReducer(
  state: Map<number, RowState>,
  action: RowAction,
): Map<number, RowState> {
  const next = new Map(state);
  const current = next.get(action.lineNumber) ?? { mode: "idle" };

  switch (action.type) {
    case "accept":
      if (action.code != null) {
        next.set(action.lineNumber, { mode: "accepted", code: action.code });
      }
      break;
    case "edit":
      next.set(action.lineNumber, {
        mode: "editing",
        draft:
          current.mode === "accepted"
            ? current.code
            : action.draft ?? "",
      });
      break;
    case "set_draft":
      if (current.mode === "editing") {
        next.set(action.lineNumber, { mode: "editing", draft: action.draft ?? "" });
      }
      break;
    case "confirm_edit":
      if (current.mode === "editing" && current.draft.trim()) {
        next.set(action.lineNumber, { mode: "accepted", code: current.draft.trim() });
      }
      break;
    case "reject":
      next.set(action.lineNumber, { mode: "rejected" });
      break;
    case "reset":
      next.delete(action.lineNumber);
      break;
  }

  return next;
}

// ─── MagicMappingPreview ──────────────────────────────────────────────────────

export function MagicMappingPreview({ orderId, onCommitted }: Props) {
  const queryClient = useQueryClient();

  // ── Data fetch ────────────────────────────────────────────────────────────
  const { data: preview, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["mapping-preview", orderId],
    queryFn: () => apiClient.getMappingPreview(orderId),
    retry: 1,
    staleTime: 60_000,
  });

  // ── Per-row state ─────────────────────────────────────────────────────────
  const [rows, dispatch] = useReducer(rowReducer, new Map<number, RowState>());

  // ── Commit mutation ───────────────────────────────────────────────────────
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState(false);

  const { mutate: commit, isPending: isCommitting } = useMutation({
    mutationFn: (resolutions: { lineNumber: number; supplierItemCode: string }[]) =>
      apiClient.commitMappings(orderId, resolutions),
    onSuccess: (result) => {
      setCommitError(null);
      setCommitSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onCommitted?.(result.order.id);
    },
    onError: (err: Error) => {
      setCommitError(err.message ?? "Commit failed. Please try again.");
    },
  });

  // ── Accept-all handler ────────────────────────────────────────────────────
  const acceptAll = useCallback(() => {
    if (!preview) return;
    let filled = 0;
    for (const line of preview.lines) {
      if (
        line.aiSuggestedSupplierCode !== null &&
        line.status !== "resolved"
      ) {
        const current = rows.get(line.lineNumber);
        if (!current || current.mode === "idle" || current.mode === "rejected") {
          dispatch({
            lineNumber: line.lineNumber,
            type: "accept",
            code: line.aiSuggestedSupplierCode,
          });
          filled++;
        }
      }
    }
    return filled;
  }, [preview, rows]);

  // ── Derived resolution map for commit ─────────────────────────────────────
  function buildResolutions(): { lineNumber: number; supplierItemCode: string }[] {
    if (!preview) return [];
    const result: { lineNumber: number; supplierItemCode: string }[] = [];
    for (const line of preview.lines) {
      if (line.status === "resolved" && line.buyerItemCode) {
        // Already resolved server-side; include to preserve
        // (backend resolve is idempotent with existing code)
        // We skip these since backend already has them.
        continue;
      }
      const rowState = rows.get(line.lineNumber);
      if (rowState?.mode === "accepted") {
        result.push({ lineNumber: line.lineNumber, supplierItemCode: rowState.code });
      } else if (rowState?.mode === "editing" && rowState.draft.trim()) {
        result.push({ lineNumber: line.lineNumber, supplierItemCode: rowState.draft.trim() });
      }
    }
    return result;
  }

  function resolvedCount(): number {
    if (!preview) return 0;
    let n = preview.lines.filter(l => l.status === "resolved").length;
    for (const line of preview.lines) {
      if (line.status === "resolved") continue;
      const rowState = rows.get(line.lineNumber);
      if (rowState?.mode === "accepted") n++;
      else if (rowState?.mode === "editing" && rowState.draft.trim()) n++;
    }
    return n;
  }

  function unresolvedCount(): number {
    if (!preview) return 0;
    return preview.lines.length - resolvedCount();
  }

  function suggestableCount(): number {
    if (!preview) return 0;
    return preview.lines.filter(l => {
      if (l.status === "resolved") return false;
      if (!l.aiSuggestedSupplierCode) return false;
      const rowState = rows.get(l.lineNumber);
      return !rowState || rowState.mode === "idle" || rowState.mode === "rejected";
    }).length;
  }

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        style={{
          padding: "40px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          color: "#56627A",
          fontSize: 13,
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden
          style={{ animation: "spin 1s linear infinite" }}
        >
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <circle cx="14" cy="14" r="11" stroke="#E2E6EE" strokeWidth="2.5" />
          <path
            d="M14 3 A11 11 0 0 1 25 14"
            stroke="url(#spin-grad)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="spin-grad" x1="14" y1="3" x2="25" y2="14" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E66C9" />
              <stop offset="1" stopColor="#2E8E3A" />
            </linearGradient>
          </defs>
        </svg>
        Loading mapping preview…
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (isError || !preview) {
    return (
      <div
        style={{
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 13, color: "#C53A3A", fontWeight: 600 }}>
          Could not load mapping preview
        </p>
        <p style={{ fontSize: 12, color: "#56627A", maxWidth: 340 }}>
          {error instanceof Error ? error.message : "An unexpected error occurred."}
        </p>
        <button
          onClick={() => refetch()}
          style={{
            marginTop: 4,
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #C6CDDA",
            background: "#FFFFFF",
            color: "#0B1A2F",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const totalLines = preview.lines.length;
  const resolved = resolvedCount();
  const unresolved = unresolvedCount();
  const suggestable = suggestableCount();

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#F6F7FA",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #E2E6EE",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 14px",
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E6EE",
        }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontSize: 16,
            fontWeight: 600,
            color: "#0B1A2F",
            margin: 0,
          }}
        >
          Review your order mapping
        </h2>
        <p style={{ fontSize: 12.5, color: "#56627A", margin: "4px 0 0" }}>
          Here&apos;s exactly how we&apos;ll map your order to{" "}
          <strong style={{ color: "#0B1A2F" }}>
            {preview.lines.length > 0 ? "your supplier" : "the supplier"}
          </strong>
          . Review and confirm — nothing is sent yet.
          {preview.sourceFormat && (
            <span
              style={{
                marginLeft: 8,
                padding: "1px 7px",
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 600,
                background: "#EFF2F7",
                color: "#56627A",
              }}
            >
              {preview.sourceFormat.toUpperCase()}
            </span>
          )}
        </p>

        {/* Accept-all + stats row */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {suggestable > 0 && (
            <button
              onClick={acceptAll}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #C5B8F0",
                background: "#EEE7FB",
                color: "#6F4FCE",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M2 6.5L5 9.5L10 3"
                  stroke="#6F4FCE"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Accept all AI suggestions
              <span
                style={{
                  background: "#6F4FCE",
                  color: "#FFFFFF",
                  borderRadius: 8,
                  padding: "0 5px",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {suggestable}
              </span>
            </button>
          )}

          <span style={{ fontSize: 12, color: "#8A93A5" }}>
            {resolved}/{totalLines} mapped
            {unresolved > 0 && (
              <span style={{ color: "#C97A14", fontWeight: 600 }}>
                {" "}· {unresolved} need attention
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 36px 120px 36px 1fr",
          gap: 0,
          padding: "8px 16px",
          background: "#EFF2F7",
          borderBottom: "1px solid #E2E6EE",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Source field &amp; value
        </span>
        <span />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center" }}>
          Canonical
        </span>
        <span />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Supplier code
        </span>
      </div>

      {/* Lines */}
      <div style={{ overflowY: "auto", maxHeight: 480 }}>
        {preview.lines.map((line, idx) => {
          const rowState = rows.get(line.lineNumber) ?? { mode: "idle" };
          const isAlreadyResolved = line.status === "resolved";

          // Effective resolved code for this row
          const effectiveCode =
            isAlreadyResolved
              ? null // server-side resolved; show in supplier code cell directly
              : rowState.mode === "accepted"
              ? rowState.code
              : rowState.mode === "editing"
              ? rowState.draft
              : null;

          const rowIsResolved =
            isAlreadyResolved ||
            rowState.mode === "accepted" ||
            (rowState.mode === "editing" && rowState.draft.trim() !== "");

          const rowBg =
            isAlreadyResolved
              ? "#F4FBF4"
              : rowIsResolved
              ? "#F4FBF4"
              : line.aiSuggestedSupplierCode
              ? "#FFFFF8"
              : "#FFFBF2";

          const borderColor =
            isAlreadyResolved || rowIsResolved
              ? "#C8E6C9"
              : line.aiSuggestedSupplierCode
              ? "#E2E6EE"
              : "#F0D9A0";

          return (
            <div
              key={line.lineNumber}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 36px 120px 36px 1fr",
                alignItems: "start",
                gap: 0,
                padding: "12px 16px",
                background: rowBg,
                borderBottom: idx < preview.lines.length - 1 ? `1px solid ${borderColor}` : "none",
              }}
            >
              {/* Source */}
              <SourceCell line={line} />

              {/* Arrow 1 */}
              <ArrowBridge />

              {/* Canonical field label */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  paddingTop: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#8A93A5",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    textAlign: "center",
                  }}
                >
                  Supplier
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#8A93A5",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    textAlign: "center",
                  }}
                >
                  item code
                </span>
                {/* mini spine node */}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #1E66C9, #2E8E3A)",
                    display: "block",
                    marginTop: 2,
                  }}
                />
              </div>

              {/* Arrow 2 */}
              <ArrowBridge />

              {/* Supplier code cell */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Already resolved (server-side) */}
                {isAlreadyResolved && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1E6D29",
                        background: "#E2F1E2",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {line.resolvedSupplierCode ?? line.buyerItemCode}
                    </span>
                    <span style={{ fontSize: 11, color: "#2E8E3A", fontWeight: 500 }}>
                      ✓ resolved
                    </span>
                  </div>
                )}

                {/* AI suggestion block — only when not yet resolved */}
                {!isAlreadyResolved && line.aiSuggestedSupplierCode && rowState.mode !== "accepted" && (
                  <div
                    style={{
                      borderLeft: "3px solid #6F4FCE",
                      paddingLeft: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: "#6F4FCE",
                          background: "#EEE7FB",
                          padding: "1px 5px",
                          borderRadius: 4,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        AI
                      </span>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#0B1A2F",
                        }}
                      >
                        {line.aiSuggestedSupplierCode}
                      </span>
                      {confidencePill(line.confidence)}
                      {(line.provenance || line.reason) && (
                        <span
                          title={[line.provenance, line.reason].filter(Boolean).join("\n")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            border: "1px solid #C5B8F0",
                            fontSize: 9,
                            color: "#6F4FCE",
                            fontWeight: 700,
                            lineHeight: 1,
                            flexShrink: 0,
                            cursor: "help",
                          }}
                        >
                          i
                        </span>
                      )}
                    </div>

                    {/* Accept / Edit / Reject row — only for unresolved rows */}
                    {rowState.mode !== "editing" && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() =>
                            dispatch({
                              lineNumber: line.lineNumber,
                              type: "accept",
                              code: line.aiSuggestedSupplierCode!,
                            })
                          }
                          style={{
                            padding: "2px 9px",
                            borderRadius: 4,
                            border: "1px solid #2E8E3A",
                            background: "#E2F1E2",
                            color: "#1E6D29",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Accept
                        </button>
                        <button
                          onClick={() =>
                            dispatch({
                              lineNumber: line.lineNumber,
                              type: "edit",
                              draft: line.aiSuggestedSupplierCode ?? "",
                            })
                          }
                          style={{
                            padding: "2px 9px",
                            borderRadius: 4,
                            border: "1px solid #C6CDDA",
                            background: "#FFFFFF",
                            color: "#56627A",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            dispatch({ lineNumber: line.lineNumber, type: "reject" })
                          }
                          style={{
                            padding: "2px 9px",
                            borderRadius: 4,
                            border: "1px solid #EDBBBB",
                            background: "#FBE3E3",
                            color: "#C53A3A",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Accepted — show green accepted code */}
                {!isAlreadyResolved && rowState.mode === "accepted" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1E6D29",
                        background: "#E2F1E2",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {rowState.code}
                    </span>
                    <span style={{ fontSize: 11, color: "#2E8E3A", fontWeight: 500 }}>✓</span>
                    <button
                      onClick={() =>
                        dispatch({
                          lineNumber: line.lineNumber,
                          type: "edit",
                          draft: rowState.code,
                        })
                      }
                      style={{
                        padding: "1px 7px",
                        borderRadius: 4,
                        border: "1px solid #C6CDDA",
                        background: "transparent",
                        color: "#8A93A5",
                        fontSize: 10.5,
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                  </div>
                )}

                {/* Editing mode — inline text input */}
                {!isAlreadyResolved && rowState.mode === "editing" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <input
                      autoFocus
                      type="text"
                      value={rowState.draft}
                      placeholder="Supplier item code…"
                      onChange={e =>
                        dispatch({
                          lineNumber: line.lineNumber,
                          type: "set_draft",
                          draft: e.target.value,
                        })
                      }
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          dispatch({ lineNumber: line.lineNumber, type: "confirm_edit" });
                        } else if (e.key === "Escape") {
                          dispatch({ lineNumber: line.lineNumber, type: "reset" });
                        }
                      }}
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "1.5px solid #1E66C9",
                        outline: "none",
                        color: "#0B1A2F",
                        width: 160,
                      }}
                    />
                    <button
                      onClick={() =>
                        dispatch({ lineNumber: line.lineNumber, type: "confirm_edit" })
                      }
                      disabled={!rowState.draft.trim()}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 4,
                        border: "1px solid #2E8E3A",
                        background: rowState.draft.trim() ? "#E2F1E2" : "#EFF2F7",
                        color: rowState.draft.trim() ? "#1E6D29" : "#8A93A5",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: rowState.draft.trim() ? "pointer" : "default",
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() =>
                        dispatch({ lineNumber: line.lineNumber, type: "reset" })
                      }
                      style={{
                        padding: "3px 7px",
                        borderRadius: 4,
                        border: "1px solid #E2E6EE",
                        background: "transparent",
                        color: "#8A93A5",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* No suggestion + rejected/idle — manual entry */}
                {!isAlreadyResolved &&
                  (line.aiSuggestedSupplierCode === null || rowState.mode === "rejected") &&
                  rowState.mode !== "accepted" &&
                  rowState.mode !== "editing" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {rowState.mode === "rejected" && (
                        <span style={{ fontSize: 11, color: "#C53A3A", fontWeight: 500 }}>
                          Rejected ·{" "}
                        </span>
                      )}
                      <button
                        onClick={() =>
                          dispatch({
                            lineNumber: line.lineNumber,
                            type: "edit",
                            draft: "",
                          })
                        }
                        style={{
                          padding: "3px 10px",
                          borderRadius: 4,
                          border: "1px dashed #C6CDDA",
                          background: "transparent",
                          color: "#56627A",
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        + Enter supplier code
                      </button>
                    </div>
                  )}

                {/* Effective resolved code preview for editing/idle rows with partial resolution */}
                {!isAlreadyResolved &&
                  effectiveCode !== null &&
                  rowState.mode !== "accepted" &&
                  rowState.mode !== "editing" && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: "#56627A",
                      }}
                    >
                      → {effectiveCode}
                    </span>
                  )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky commit bar */}
      <div
        style={{
          padding: "14px 20px",
          background: "#FFFFFF",
          borderTop: "1px solid #E2E6EE",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          position: "sticky",
          bottom: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12.5, color: "#0B1A2F", fontWeight: 500 }}>
            {resolved} of {totalLines} lines mapped
            {unresolved > 0 && (
              <span style={{ color: "#C97A14" }}>
                {" "}— {unresolved} still need a supplier code
              </span>
            )}
          </span>
          {commitError && (
            <span style={{ fontSize: 12, color: "#C53A3A" }}>{commitError}</span>
          )}
          {commitSuccess && (
            <span style={{ fontSize: 12, color: "#2E8E3A", fontWeight: 600 }}>
              ✓ Mappings committed — order is ready for processing.
            </span>
          )}
        </div>

        <button
          disabled={isCommitting || commitSuccess}
          onClick={() => {
            setCommitError(null);
            commit(buildResolutions());
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            background:
              isCommitting || commitSuccess
                ? "#EFF2F7"
                : unresolved > 0
                ? "#0B1A2F"
                : "#0B1A2F",
            color: isCommitting || commitSuccess ? "#8A93A5" : "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            cursor: isCommitting || commitSuccess ? "default" : "pointer",
            fontFamily: "'Inter', sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          {isCommitting ? (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
                style={{ animation: "spin 1s linear infinite" }}
              >
                <circle cx="7" cy="7" r="5.5" stroke="#C6CDDA" strokeWidth="2" />
                <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="#8A93A5" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Committing…
            </>
          ) : commitSuccess ? (
            "Committed ✓"
          ) : unresolved > 0 ? (
            `Looks good → process order (${unresolved} unmapped)`
          ) : (
            "Looks good → process order"
          )}
        </button>
      </div>
    </div>
  );
}
