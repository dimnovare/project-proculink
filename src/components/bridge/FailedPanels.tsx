"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DetectFormatResult } from "@/lib/api-client";
import type { AuditEvent, Order } from "@/types/procurement";

// ─── Design tokens (Bridge Layer) ────────────────────────────────────────────

const T = {
  danger:      "#C53A3A",
  dangerSoft:  "#FBE3E3",
  amber:       "#C97A14",
  amberSoft:   "#FAEFD6",
  navy:        "#0B1A2F",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E2E6EE",
  bg:          "#F6F7FA",
  ui:          '"Inter", system-ui, sans-serif',
  mono:        '"JetBrains Mono", ui-monospace, monospace',
};

const SRC_META: Record<string, { bg: string; color: string; label: string }> = {
  pdf:   { bg: "#FEE2E2", color: "#B91C1C", label: "PDF"   },
  csv:   { bg: "#DBEAFE", color: "#1D4ED8", label: "CSV"   },
  xlsx:  { bg: "#E2F1E2", color: "#15803D", label: "XLSX"  },
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

export function FailedPanel({
  order,
  stage,
}: {
  order: Order;
  stage: "transform" | "delivery";
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isTransform  = stage === "transform";
  const accentColor  = isTransform ? T.amber : T.danger;
  const bgColor      = isTransform ? T.amberSoft : T.dangerSoft;
  const title        = isTransform ? "Output generation failed" : "Delivery to supplier failed";
  const errorMessage =
    order.errorMessage ??
    (isTransform
      ? "The transform step could not complete. Review the order and try again."
      : "The delivery attempt failed. Check the delivery config and try again.");

  async function handleRedeliver() {
    if (isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      await apiClient.retryDelivery(order.id);
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed. Check the delivery config.");
    } finally {
      setIsRetrying(false);
    }
  }

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
            ) : (
              <button
                onClick={() => void handleRedeliver()}
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
                }}
              >
                {isRetrying ? "Retrying…" : "Retry delivery"}
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
