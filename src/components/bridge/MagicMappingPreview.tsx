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
 * commits via the existing resolve endpoint.  Bulk accept ("Accept all AI
 * suggestions" / "Accept ≥85% only") runs server-side via
 * POST /accept-ai-suggestions and persists immediately — no separate Commit
 * needed for those lines.  Nothing irreversible happens until
 * transform/deliver.
 */

import type React from "react";
import Link from "next/link";
import { useState, useEffect, useReducer, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { MappingPreviewLine } from "@/lib/api-client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { isParseStalled } from "./parseStall";
import { bulkAcceptCount, bulkAcceptResolutions } from "./magicBulkAcceptSelection";

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
  onParseFailed?: (orderId: string) => void;
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
      : ["#EFF2F7", "#56627A", "var(--ink-faint)"];

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
      <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
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

/**
 * InfoDisclosure — tap-toggle "i" affordance for AI provenance/reason.
 *
 * Replaces native `title=` tooltips, which never surface on touch devices.
 * The circle is a real button (keyboard + screen-reader accessible) and the
 * panel toggles open on click/tap, closing on outside-tap or Escape.
 */
function InfoDisclosure({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          padding: 0,
          borderRadius: "50%",
          border: "1px solid #C5B8F0",
          background: open ? "#EEE7FB" : "transparent",
          fontSize: 9,
          color: "#6F4FCE",
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            width: "max-content",
            maxWidth: 260,
            padding: "8px 10px",
            borderRadius: 6,
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            boxShadow: "0 4px 14px rgba(11,26,47,0.12)",
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.4,
            color: "#3D4A5C",
            textAlign: "left",
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Maps-to affordance (mobile card) ─────────────────────────────────────────

/** Compact "maps to → {counterparty} item code" row shown above the supplier control on mobile. */
function MapsToAffordance({ counterpartyNoun }: { counterpartyNoun: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }} aria-hidden>
      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
        <defs>
          <linearGradient id="mapsto-grad" x1="0" y1="0" x2="20" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1E66C9" />
            <stop offset="100%" stopColor="#2E8E3A" />
          </linearGradient>
        </defs>
        <line x1="0" y1="5" x2="14" y2="5" stroke="url(#mapsto-grad)" strokeWidth="2" />
        <path d="M12 1.5 L20 5 L12 8.5" fill="none" stroke="#2E8E3A" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {counterpartyNoun} item code
      </span>
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

export function MagicMappingPreview({ orderId, onCommitted, onParseFailed }: Props) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  // Direction-aware labels so inbound orgs see "Customer code" rather than a
  // split-brain "Supplier code". Lowercased form for inline prose.
  const { labels } = useOrderDirection();
  const counterpartyNoun = labels.counterpartyNoun;            // "Supplier" | "Customer"
  const counterpartyLower = counterpartyNoun.toLowerCase();    // "supplier" | "customer"

  // ── Data fetch ────────────────────────────────────────────────────────────
  const { data: preview, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["mapping-preview", orderId],
    queryFn: () => apiClient.getMappingPreview(orderId),
    retry: 1,
    staleTime: 60_000,
  });

  // Worker-down honesty (task 10 / G9): if the order sits in `parsing` beyond
  // the 90s threshold, escalate the copy to "processing may be paused" with a
  // /operations/health link. Polling CONTINUES unchanged — this is never a
  // false "failed" (the Worker may just be catching up). The start mark and
  // flag reset whenever the status leaves `parsing`.
  const [parseStalled, setParseStalled] = useState(false);
  const parseStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (preview?.orderStatus !== "parsing") {
      parseStartRef.current = null;
      setParseStalled(false);
      return;
    }
    if (parseStartRef.current === null) parseStartRef.current = Date.now();
    const timer = window.setInterval(() => {
      void refetch();
      if (
        parseStartRef.current !== null &&
        isParseStalled(Date.now() - parseStartRef.current)
      ) {
        setParseStalled(true);
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [preview?.orderStatus, refetch]);

  useEffect(() => {
    if (preview?.orderStatus !== "failed") return;
    onParseFailed?.(orderId);
  }, [onParseFailed, orderId, preview?.orderStatus]);

  // ── Per-row state ─────────────────────────────────────────────────────────
  const [rows, dispatch] = useReducer(rowReducer, new Map<number, RowState>());

  // B11: line numbers the user locally REJECTED this session. A rejection never changes the
  // server `status`, so without this set the bulk-accept count + action still included them and
  // re-accepted exactly what the user just rejected. Both the badge and the action filter on it.
  const rejectedLineNumbers = new Set<number>();
  for (const [lineNumber, state] of rows) {
    if (state.mode === "rejected") rejectedLineNumbers.add(lineNumber);
  }

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

  // ── Bulk accept — ONE unified server-side path (audit item 8) ─────────────
  // Previously TWO overlapping buttons coexisted: a purple CLIENT-side
  // "Accept all AI suggestions" (local row state only — needed a separate
  // Commit to persist) and a green SERVER-side "Accept all high-confidence"
  // (persisted immediately). Overlapping scopes + contradicting counts read
  // as a bug on the most-repeated action. Both now run through the SAME
  // backend endpoint (POST /accept-ai-suggestions?minConfidence=) so the
  // result is persisted immediately: minConfidence=0 accepts EVERY suggested
  // line (the old purple scope — the backend treats null confidence as 0.0),
  // 0.85 is the conservative secondary option (the old green scope).
  //
  // Any local per-row decision (an accepted code or an in-progress edit
  // draft — exactly what the Commit button would send) is committed FIRST so
  // a code the user already chose by hand is never clobbered by the bulk
  // accept (the backend would otherwise re-accept those still-unresolved
  // lines with the AI's code).
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const {
    mutate: bulkAccept,
    isPending: isBulkAccepting,
    variables: bulkThreshold,
  } = useMutation({
    mutationFn: async (minConfidence: number) => {
      const local = buildResolutions();
      if (local.length > 0) await apiClient.commitMappings(orderId, local);

      // B11: the broad accept-all endpoint has no per-line exclusion, so if the user locally
      // REJECTED any suggested line it would re-accept exactly that line. When there ARE such
      // rejections, accept the SURVIVING suggested lines explicitly via commitMappings (an
      // existing route, no API change) so rejected lines are skipped. With no rejections, keep
      // the cheaper server-side accept-all (unchanged behaviour).
      const lines = preview?.lines ?? [];
      const wouldReAcceptRejected = lines.some(
        (l) =>
          l.status !== "resolved" &&
          l.aiSuggestedSupplierCode !== null &&
          (l.confidence ?? 0) >= minConfidence &&
          rejectedLineNumbers.has(l.lineNumber),
      );

      if (wouldReAcceptRejected) {
        const resolutions = bulkAcceptResolutions({ lines, minConfidence, rejectedLineNumbers });
        // A code the user already set by hand (in `local`) overrides the AI code for that line.
        const localByLine = new Map(local.map((r) => [r.lineNumber, r]));
        const toAccept = resolutions.filter((r) => !localByLine.has(r.lineNumber));
        if (toAccept.length > 0) await apiClient.commitMappings(orderId, toAccept);
        return { accepted: toAccept.length, committed: local.length };
      }

      const result = await apiClient.acceptAiSuggestions(orderId, minConfidence);
      return { accepted: result.accepted, committed: local.length };
    },
    onSuccess: ({ accepted, committed }) => {
      const parts = [
        `${accepted} suggestion${accepted === 1 ? "" : "s"} accepted and saved`,
      ];
      if (committed > 0)
        parts.push(`${committed} manual code${committed === 1 ? "" : "s"} saved`);
      setBulkNotice(`${parts.join(" · ")}.`);
      queryClient.invalidateQueries({ queryKey: ["mapping-preview", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err: Error) => setBulkNotice(`Accept failed: ${err.message}`),
  });

  // Counts for the two bulk actions, measured against SERVER state (preview line status) MINUS
  // any line the user locally rejected (B11) — so the badge always matches what the action will
  // actually accept. The selection helper is shared with the action so they can never drift.
  const suggestedUnresolved = preview
    ? bulkAcceptCount({ lines: preview.lines, minConfidence: 0, rejectedLineNumbers })
    : 0;
  const highConf = preview
    ? bulkAcceptCount({ lines: preview.lines, minConfidence: 0.85, rejectedLineNumbers })
    : 0;

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

  // The exact payload the Continue button would POST. Computed ONCE here (not twice via two
  // buildResolutions() calls) so the disabled gate and the onClick handler can never disagree.
  // buildResolutions() SKIPS lines already resolved server-side, so it returns [] when the user
  // has made no in-session decision — including the dominant case where EVERY line is already
  // auto-resolved. Posting [] hits the backend's "At least one line resolution required" 400,
  // which surfaced as the founder's "Resolution failed: {error: …}" toast. We guard both ends.
  const toResolve = buildResolutions();
  // Genuinely fully mapped server-side with nothing new to send → advancing must NOT POST.
  const allAlreadyResolved = toResolve.length === 0 && unresolved === 0;
  // Lines remain unmapped AND the user has acted on none of them → there's nothing valid to send;
  // show an inline hint instead of letting the request 400.
  const nothingToSubmitYet = toResolve.length === 0 && unresolved > 0;

  // While the Worker is still parsing the uploaded file the preview legitimately
  // has 0 lines yet — show an honest in-progress state (the 1.5s poll above keeps
  // refetching until parsing finishes) instead of the alarming "no lines / upload
  // a corrected file" empty state. Checked regardless of line count and BEFORE the
  // empty-state branch so a normal in-progress parse never flashes the false error.
  if (preview.orderStatus === "parsing") {
    return (
      <div
        style={{
          padding: "40px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
          background: "#FFFFFF",
          border: "1px solid #E2E6EE",
          borderRadius: 8,
        }}
      >
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden style={{ animation: "spin 1s linear infinite" }}>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <circle cx="14" cy="14" r="11" stroke="#E2E6EE" strokeWidth="2.5" />
          <path d="M14 3 A11 11 0 0 1 25 14" stroke="url(#spin-grad-parsing)" strokeWidth="2.5" strokeLinecap="round" />
          <defs>
            <linearGradient id="spin-grad-parsing" x1="14" y1="3" x2="25" y2="14" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E66C9" />
              <stop offset="1" stopColor="#2E8E3A" />
            </linearGradient>
          </defs>
        </svg>
        <p style={{ fontSize: 13.5, color: "#0B1A2F", fontWeight: 600, margin: 0 }}>
          Parsing your order…
        </p>
        <p style={{ fontSize: 12, color: "#56627A", maxWidth: 340, margin: 0, lineHeight: 1.45 }}>
          We&apos;re reading your file and extracting its order lines. This usually takes a
          few seconds — the mapping preview will appear automatically when it&apos;s ready.
        </p>
        {/* 90s+ in `parsing` → escalate honestly (task 10): processing MAY be
            paused; never claim failure. Polling keeps running underneath. */}
        {parseStalled && (
          <p
            role="status"
            style={{
              fontSize: 12,
              color: "#7A4D0A",
              background: "#FAEFD6",
              border: "1px solid #F0D39A",
              borderRadius: 6,
              padding: "8px 12px",
              maxWidth: 360,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            This is taking longer than usual. Order processing may be paused —{" "}
            <Link href="/operations/health" style={{ color: "#7A4D0A", fontWeight: 700, textDecoration: "underline" }}>
              check system health
            </Link>
            . We&apos;ll keep checking automatically.
          </p>
        )}
      </div>
    );
  }

  // Genuine empty state — only when parsing is FINISHED (not parsing, not failed)
  // and there are still no lines. `failed` is routed away by the onParseFailed
  // effect above; we also exclude it here so the misleading "upload a corrected
  // file" copy can never flash if the parent keeps this mounted during a failure.
  if (totalLines === 0 && preview.orderStatus !== "failed") {
    return (
      <div
        style={{
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
          background: "#FFFFFF",
          border: "1px solid #E2E6EE",
          borderRadius: 8,
        }}
      >
        <p style={{ fontSize: 13, color: "#C53A3A", fontWeight: 600 }}>
          No order lines were found
        </p>
        <p style={{ fontSize: 12, color: "#56627A", maxWidth: 360 }}>
          Upload a corrected file with at least one purchase-order line.
        </p>
      </div>
    );
  }

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
            {preview.lines.length > 0 ? `your ${counterpartyLower}` : `the ${counterpartyLower}`}
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

        {/* Bulk-accept + stats row — ONE primary action (audit item 8).
            Primary accepts and SAVES every AI-suggested line (server path, no
            separate Commit needed for them); the quieter secondary narrows
            the same persisted action to ≥85%-confidence suggestions only, and
            is hidden when its scope equals the primary's (identical effect). */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {suggestedUnresolved > 0 && (
            <button
              onClick={() => bulkAccept(0)}
              disabled={isBulkAccepting}
              title={`Accepts and saves all ${suggestedUnresolved} AI-suggested codes`}
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
                cursor: isBulkAccepting ? "wait" : "pointer",
                opacity: isBulkAccepting ? 0.6 : 1,
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
              {isBulkAccepting && bulkThreshold === 0
                ? "Accepting…"
                : "Accept all AI suggestions"}
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
                {suggestedUnresolved}
              </span>
            </button>
          )}

          {highConf > 0 && highConf < suggestedUnresolved && (
            <button
              onClick={() => bulkAccept(0.85)}
              disabled={isBulkAccepting}
              title="Accepts and saves only the suggestions with at least 85% confidence"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #C6CDDA",
                background: "#FFFFFF",
                color: "#56627A",
                fontSize: 12,
                fontWeight: 600,
                cursor: isBulkAccepting ? "wait" : "pointer",
                opacity: isBulkAccepting ? 0.6 : 1,
              }}
            >
              {isBulkAccepting && bulkThreshold === 0.85
                ? "Accepting…"
                : "Accept ≥85% only"}
              <span
                style={{
                  background: "#EFF2F7",
                  color: "#56627A",
                  borderRadius: 8,
                  padding: "0 5px",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {highConf}
              </span>
            </button>
          )}
          {bulkNotice && (
            <span
              role="status"
              style={{
                fontSize: 12,
                color: bulkNotice.startsWith("Accept failed") ? "#C53A3A" : "#1E6D29",
                fontWeight: 500,
              }}
            >
              {bulkNotice}
            </span>
          )}

          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
            {resolved}/{totalLines} mapped
            {unresolved > 0 && (
              <span style={{ color: "#C97A14", fontWeight: 600 }}>
                {" "}· {unresolved} need attention
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Column headers — desktop grid; mobile shows a single label since each line is a card */}
      {isMobile ? (
        <div
          style={{
            padding: "8px 16px",
            background: "#EFF2F7",
            borderBottom: "1px solid #E2E6EE",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Order lines
          </span>
        </div>
      ) : (
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
            Order field
          </span>
          <span />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {counterpartyNoun} code
          </span>
        </div>
      )}

      {/* Lines — vertical scroll for long lists; horizontal scroll as a floor so dense desktop rows never clip */}
      <div style={{ overflowY: "auto", overflowX: "auto", maxHeight: 480 }}>
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
                ...(isMobile
                  ? { display: "flex", flexDirection: "column", gap: 10 }
                  : {
                      display: "grid",
                      gridTemplateColumns: "1fr 36px 120px 36px 1fr",
                      alignItems: "start",
                      gap: 0,
                    }),
                padding: "12px 16px",
                background: rowBg,
                borderBottom: idx < preview.lines.length - 1 ? `1px solid ${borderColor}` : "none",
              }}
            >
              {/* Source */}
              <SourceCell line={line} />

              {/* Mobile: compact maps-to affordance replaces the arrow + canonical columns */}
              {isMobile && <MapsToAffordance counterpartyNoun={counterpartyNoun} />}

              {/* Arrow 1 (desktop only) */}
              {!isMobile && <ArrowBridge />}

              {/* Canonical field label (desktop only) */}
              {!isMobile && (
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
                      color: "var(--ink-faint)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      textAlign: "center",
                    }}
                  >
                    {counterpartyNoun}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--ink-faint)",
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
              )}

              {/* Arrow 2 (desktop only) */}
              {!isMobile && <ArrowBridge />}

              {/* Supplier code cell */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, width: isMobile ? "100%" : undefined }}>
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
                        <InfoDisclosure
                          label="Why this code was suggested"
                          text={[line.provenance, line.reason].filter(Boolean).join("\n")}
                        />
                      )}
                    </div>

                    {/* Accept / Edit / Reject row — only for unresolved rows */}
                    {rowState.mode !== "editing" && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button
                          onClick={() =>
                            dispatch({
                              lineNumber: line.lineNumber,
                              type: "accept",
                              code: line.aiSuggestedSupplierCode!,
                            })
                          }
                          style={{
                            padding: isMobile ? "9px 14px" : "2px 9px",
                            minHeight: isMobile ? 40 : undefined,
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
                            padding: isMobile ? "9px 14px" : "2px 9px",
                            minHeight: isMobile ? 40 : undefined,
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
                            padding: isMobile ? "9px 14px" : "2px 9px",
                            minHeight: isMobile ? 40 : undefined,
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
                        color: "var(--ink-faint)",
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
                      placeholder={`${counterpartyNoun} item code…`}
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
                        color: "#0B1A2F",
                        flex: "1 1 140px",
                        width: "100%",
                        minWidth: 0,
                        boxSizing: "border-box",
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
                        color: rowState.draft.trim() ? "#1E6D29" : "var(--ink-faint)",
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
                        color: "var(--ink-faint)",
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
                          padding: isMobile ? "10px 14px" : "3px 10px",
                          minHeight: isMobile ? 40 : undefined,
                          borderRadius: 4,
                          border: "1px dashed #C6CDDA",
                          background: "transparent",
                          color: "#56627A",
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        + Enter {counterpartyLower} code
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
                {" "}— {unresolved} still need a {counterpartyLower} code
              </span>
            )}
          </span>
          {commitError && (
            <span style={{ fontSize: 12, color: "#C53A3A" }}>{commitError}</span>
          )}
          {!commitError && !commitSuccess && nothingToSubmitYet && (
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              Unmapped lines will stay flagged in review — or accept a suggestion / enter a {counterpartyLower} code to resolve them now.
            </span>
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
            // Nothing new to POST — either the order is already fully resolved server-side, OR the
            // user is choosing to proceed to the full review with some lines still flagged
            // ("Continue to review (N unmapped)"). An empty resolve POST would 400 ("At least one
            // line resolution required"); just advance to review instead. Only mark "committed"
            // when everything was already resolved.
            if (toResolve.length === 0) {
              if (allAlreadyResolved) setCommitSuccess(true);
              onCommitted?.(orderId);
              return;
            }
            commit(toResolve);
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
                : "#0B1A2F",
            color: isCommitting || commitSuccess ? "var(--ink-faint)" : "#FFFFFF",
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
                <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="#5B6980" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Committing…
            </>
          ) : commitSuccess ? (
            "Committed ✓"
          ) : unresolved > 0 ? (
            `Continue to review (${unresolved} unmapped)`
          ) : (
            "Confirm mapping → review order"
          )}
        </button>
      </div>
    </div>
  );
}
