"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DetectFormatResult } from "@/lib/api-client";
import type { AuditEvent, Order } from "@/types/procurement";
import { useRetryDelivery } from "./review/hooks/useRetryDelivery";

// ─── Design tokens (Bridge Layer) ────────────────────────────────────────────

const T = {
  danger:      "#B43838",
  dangerSoft:  "#FBE3E3",
  amber:       "#B36D14",
  amberSoft:   "#FAF1DD",
  blueDeep:    "#0F4FA8",
  blueSoft:    "#E3EDFB",
  navy:        "#0B1A2F",
  ink:         "#0B1A2F",
  inkMuted:    "#5E6779",
  inkFaint:    "var(--ink-faint)",
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E5E8EE",
  bg:          "#F6F7FA",
  ui:          '"Inter", system-ui, sans-serif',
  mono:        '"JetBrains Mono", ui-monospace, monospace',
};

const SRC_META: Record<string, { bg: string; color: string; label: string }> = {
  pdf:   { bg: "#FEE2E2", color: "#B91C1C", label: "PDF"   },
  csv:   { bg: "#DBEAFE", color: "#1D4ED8", label: "CSV"   },
  xlsx:  { bg: "#E9F1EA", color: "#15803D", label: "XLSX"  },
  cxml:  { bg: "#CCFBF1", color: "#0F766E", label: "cXML"  },
  edi:   { bg: "#FEF3C7", color: "#B45309", label: "EDI"   },
  ubl:   { bg: "#CCFBF1", color: "#0F766E", label: "UBL"   },
  x12:   { bg: "#FEF3C7", color: "#B45309", label: "X12"   },
};

function deriveSourceFormat(fileKey: string | null | undefined): string | null {
  if (!fileKey) return null;
  const ext = fileKey.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "xml" || ext === "cxml") return "cxml";
  if (ext === "edi" || ext === "x12") return "edi";
  return null;
}

// ─── ParseFailedPanel ─────────────────────────────────────────────────────────

export function ParseFailedPanel({
  order,
  auditEvents,
}: {
  order: Order;
  auditEvents?: AuditEvent[];
}) {
  const [detectResult, setDetectResult] = useState<DetectFormatResult | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`detectResult:${order.id}`);
      if (raw) setDetectResult(JSON.parse(raw) as DetectFormatResult);
    } catch {
      // sessionStorage unavailable or JSON invalid — ignore
    }
  }, [order.id]);

  const errorMessage =
    order.errorMessage ??
    (auditEvents
      ?.find((e) => e.action === "ParseFailed")
      ?.payload?.["error"] as string | undefined) ??
    "The file could not be parsed. Try a different format or check the file contents.";

  const sourceFmt = deriveSourceFormat(order.sourceFileKey);
  const srcMeta = sourceFmt ? (SRC_META[sourceFmt] ?? null) : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "32px 24px",
        background: T.bg,
        fontFamily: T.ui,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.danger}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${T.border}`,
            background: T.dangerSoft,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.danger} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.danger }}>
              Parsing failed
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {srcMeta && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 18,
                  padding: "0 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  background: srcMeta.bg,
                  color: srcMeta.color,
                }}
              >
                {srcMeta.label}
              </span>
            )}
            {detectResult && (
              <span
                style={{
                  fontSize: 10.5,
                  color: T.inkFaint,
                  fontFamily: T.mono,
                }}
              >
                {Math.round((detectResult.confidence ?? 0) * 100)}% confidence
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 12px" }}>
            {errorMessage}
          </p>
          <p style={{ fontSize: 12, color: T.inkFaint, margin: "0 0 20px", lineHeight: 1.5 }}>
            Your source file is still stored and visible to support if you need help.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link
              href={`/upload?supplierId=${order.supplierId}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "9px 18px",
                borderRadius: 7,
                background: T.navy,
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Re-upload — try a different format
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M6 3l5 5-5 5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href="/inbox"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "7px 14px",
                borderRadius: 7,
                background: "transparent",
                border: `1px solid ${T.border}`,
                color: T.inkMuted,
                fontSize: 12.5,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              ← Back to orders
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FailedPanel ──────────────────────────────────────────────────────────────

/**
 * True when a delivery failure is the "no delivery config" cliff (task 7).
 * Matches the backend DeliveryService message ("Supplier delivery config is
 * missing. Add a delivery endpoint before sending this order.") plus close
 * variants, case-insensitively — retrying can NEVER fix this state, so the
 * panel leads with "Set up delivery" and demotes Retry.
 */
export function isDeliveryConfigMissing(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return /delivery\s+config(uration)?\s+is\s+missing|missing\s+(supplier\s+)?delivery\s+config/i.test(errorMessage);
}

export function FailedPanel({
  order,
  stage,
}: {
  order: Order;
  stage: "transform" | "delivery";
}) {
  // The retry POST + the short poll that watches for the Worker's claim. Owning the
  // poll is the difference between the operator seeing the retry take effect and the
  // panel re-rendering "Delivery to supplier failed" a beat after the click — the
  // endpoint answers 202 while the row is still delivery_failed BY DESIGN, so a bare
  // refetch here just races the Worker and re-reads the failure. See useRetryDelivery.
  const { phase: retryPhase, error: retryError, start: startRetry, isRetrying } = useRetryDelivery(order.id);

  const isTransform  = stage === "transform";
  // Config-missing is a SETUP gap, not a transient failure — Retry cannot
  // succeed until a delivery config exists, so the primary CTA becomes
  // "Set up delivery" (deep link to the supplier's Delivery tab).
  const configMissing = !isTransform && isDeliveryConfigMissing(order.errorMessage);
  const accentColor  = isTransform ? T.amber : T.danger;
  const bgColor      = isTransform ? T.amberSoft : T.dangerSoft;
  const title        = isTransform ? "Output generation failed" : "Delivery to supplier failed";
  const errorMessage =
    order.errorMessage ??
    (isTransform
      ? "The transform step could not complete. Review the order and try again."
      : "The delivery attempt failed. Check the delivery config and try again.");

  // The retry button's label. "Retry queued…" — not "Sending…" / "Retrying…" — is
  // the honest word for what is true at that moment: a job is enqueued and the row
  // has not moved yet. The panel unmounts the moment it does.
  //
  // `slow` keeps the SAME label (and stays disabled) because it is the same fact: our
  // job is still queued. An earlier draft said "Retry again" here, which invited the
  // one click that can dead-letter the order — a duplicate enqueue burns the retry
  // budget when the supplier is down. See useRetryDelivery's inFlight guard.
  const retryLabel = retryPhase === "idle" ? "Retry delivery" : "Retry queued…";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "32px 24px",
        background: T.bg,
        fontFamily: T.ui,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${accentColor}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: `1px solid ${T.border}`,
            background: bgColor,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: accentColor }}>
            {title}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "0 0 12px" }}>
            {errorMessage}
          </p>

          {/* Retry accepted, Worker hasn't claimed the row yet. Deliberately blue-
              neutral and deliberately NOT a status: the header above still says the
              delivery failed, because it did and the row still says so. This strip
              reports the REQUEST — the 202 said `retrying: true` — and nothing more.
              It clears by this panel unmounting when the status actually moves. */}
          {retryPhase === "queued" && (
            <p
              role="status"
              style={{
                fontSize: 12, color: T.blueDeep, margin: "0 0 12px",
                padding: "8px 12px", background: T.blueSoft, borderRadius: 6,
                border: `1px solid ${T.blueDeep}22`, lineHeight: 1.5,
              }}
            >
              Retry queued — waiting for the sender to pick it up. This page updates on its own; you don&apos;t need to click again.
            </p>
          )}

          {/* The claim window elapsed. Still not a failure: the job is enqueued and
              will run. Says so plainly rather than reverting to an untouched-looking
              panel, which is what made the original click read as a no-op. The button
              stays disabled — a second retry cannot make this start any sooner, and it
              can dead-letter the order (see useRetryDelivery). So this copy explains
              the wait instead of offering a click. */}
          {retryPhase === "slow" && (
            <p
              role="status"
              style={{
                fontSize: 12, color: T.amber, margin: "0 0 12px",
                padding: "8px 12px", background: T.amberSoft, borderRadius: 6,
                border: `1px solid ${T.amber}30`, lineHeight: 1.5,
              }}
            >
              Your retry is queued but hasn&apos;t started yet. It stays queued and will still run — sending it again won&apos;t make it start sooner. Check the{" "}
              <Link href="/operations/log" style={{ color: T.amber, fontWeight: 600 }}>Delivery Log</Link>
              {" "}if it hasn&apos;t sent shortly.
            </p>
          )}

          {retryError && (
            <p
              style={{
                fontSize: 12,
                color: T.danger,
                margin: "0 0 12px",
                padding: "8px 12px",
                background: T.dangerSoft,
                borderRadius: 6,
                border: `1px solid ${T.danger}30`,
              }}
            >
              {retryError}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {isTransform ? (
              <Link
                href={`/inbox/${order.id}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "9px 18px",
                  borderRadius: 7,
                  background: T.navy,
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Back to review
              </Link>
            ) : configMissing ? (
              <>
                {/* Config-missing variant (task 7): the fix is setup, not a
                    retry — primary CTA deep-links to the Delivery tab; Retry
                    stays available but demoted, with an honest helper. */}
                <Link
                  href={`/library/suppliers/${order.supplierId}?tab=delivery`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "9px 18px",
                    borderRadius: 7,
                    background: T.navy,
                    color: "#FFFFFF",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Set up delivery
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M6 3l5 5-5 5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <button
                  onClick={() => void startRetry()}
                  // Retry can NEVER succeed while delivery config is missing — keep it visible (so the
                  // path is discoverable) but disabled, so the user can't fire a guaranteed-to-fail retry.
                  disabled={isRetrying || configMissing}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "7px 14px",
                    borderRadius: 7,
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    color: T.inkMuted,
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: "not-allowed",
                    fontFamily: T.ui,
                    opacity: 0.6,
                  }}
                >
                  {retryLabel}
                </button>
                <p style={{ fontSize: 11.5, color: T.inkFaint, margin: 0, textAlign: "center" }}>
                  Retry won&apos;t succeed until delivery is set up.
                </p>
              </>
            ) : (
              <button
                onClick={() => void startRetry()}
                disabled={isRetrying}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "9px 18px",
                  borderRadius: 7,
                  background: isRetrying ? T.inkFaint : T.navy,
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  cursor: isRetrying ? "not-allowed" : "pointer",
                  fontFamily: T.ui,
                  // 390px: the panel is a 520-max column with 20px side padding, so the
                  // button owns the full row and the longest label ("Retry queued…")
                  // has ~300px to sit in. Wrap rather than push the card wide if the
                  // viewport is narrower still.
                  whiteSpace: "normal",
                  textAlign: "center",
                }}
              >
                {retryLabel}
              </button>
            )}
            <Link
              href="/inbox"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "7px 14px",
                borderRadius: 7,
                background: "transparent",
                border: `1px solid ${T.border}`,
                color: T.inkMuted,
                fontSize: 12.5,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              ← Back to orders
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
