"use client";

// Upload Workbench — XCard dropzone + pipeline picker + recent uploads.
// Translated from Bridge_Upload in v2-prototype.jsx.

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { FileChip } from "./FileChip";
import { ApiHttpError, apiClient, getBillingStatus, isApiMockMode, type DetectFormatResult } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { captureException } from "@/lib/sentry-context";

// Pipeline stages for the upload animation
const PIPELINE_STAGES = ["Parse", "Normalize", "Validate", "Transform"] as const;
const STAGE_MS = 600;

// ─── Types ────────────────────────────────────────────────────────────────────

type FormatKey = "PDF" | "XLSX" | "CSV" | "cXML" | "EDI" | "JSON" | "EMAIL";
type ModeKey   = "auto" | "manual";

// ─── Recent uploads ─────────────────────────────────────────────────────────

type RecentStatus = "processing" | "done" | "failed" | "review" | "ready" | "draft";

interface RecentRow {
  id: string;
  name: string;
  fmt: FormatKey;
  buyer: string;
  supplier: string;
  size: string;
  age: string;
  status: RecentStatus;
}

// Demo rows are dev-only (mock mode). Real users see their own orders from the
// live API, or nothing when there are no recent uploads — never staged data.
const DEMO_RECENT: RecentRow[] = [
  { id: "ord-001", name: "PO-DEMO-001.pdf",   fmt: "PDF",   buyer: "Heinrich Industries",  supplier: "Acme Components",    size: "214 KB", age: "2m",  status: "processing" },
  { id: "ord-002", name: "NRD_orders_may.xlsx",  fmt: "XLSX",  buyer: "Nordmark Logistics",   supplier: "VanDerBerg Metaal",  size: "88 KB",  age: "18m", status: "done"       },
  { id: "ord-003", name: "westmark_q2.csv",      fmt: "CSV",   buyer: "Westmark Tools",       supplier: "Acme Components",    size: "44 KB",  age: "3h",  status: "done"       },
];

const TEMPLATES = ["Standard cXML PO", "SAP IDoc ORDERS05", "ERP Generic v2", "Custom template"];

const STATUS_PILL: Record<RecentStatus, { bg: string; color: string; label: string }> = {
  processing: { bg: "#EEE7FB", color: "#6F4FCE", label: "Processing" },
  done:       { bg: "#E2F1E2", color: "#1E6D29", label: "Delivered"  },
  failed:     { bg: "#FBE3E3", color: "#C53A3A", label: "Failed"     },
  review:     { bg: "#FAEFD6", color: "#9A5F0A", label: "Needs review" },
  ready:      { bg: "#DCFCE7", color: "#1DAF50", label: "Ready"      },
  draft:      { bg: "#EFF2F7", color: "#56627A", label: "Draft"      },
};

/** Map source format string from the orders API → a FileChip format key. */
function formatKeyFromSource(src: string | null | undefined): FormatKey {
  switch ((src ?? "").toLowerCase()) {
    case "pdf":  return "PDF";
    case "xlsx":
    case "xls":  return "XLSX";
    case "cxml":
    case "xml":  return "cXML";
    case "edi":
    case "x12":  return "EDI";
    case "json": return "JSON";
    default:     return "CSV";
  }
}

/** Map an order status → a recent-upload status pill. */
function recentStatusFromOrder(status: string): RecentStatus {
  switch (status) {
    case "delivered":                                  return "done";
    case "failed":
    case "transform_failed":
    case "delivery_failed":                            return "failed";
    case "parsing":
    case "transforming":
    case "delivering":                                 return "processing";
    case "pending_review":                             return "review";
    case "ready":
    case "ready_to_deliver":                           return "ready";
    default:                                           return "draft";
  }
}

/** Compact relative age, e.g. "2m", "3h", "5d". */
function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60)    return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60)    return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)     return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function XCard({
  edge = "none",
  edgeColor = "#2E8E3A",
  children,
  style,
}: {
  edge?: "top" | "left" | "none";
  edgeColor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const borderStyle: React.CSSProperties =
    edge === "top"
      ? { borderTop: `2px solid ${edgeColor}` }
      : edge === "left"
      ? { borderLeft: `2px solid ${edgeColor}` }
      : {};

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
        overflow: "hidden",
        minWidth: 0,
        ...borderStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UploadWorkbench() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const clerkReady = clerkLoaded && !!isSignedIn;
  // Mock mode has no Clerk session — gate on (mock OR clerkReady) so mock-mode
  // dev/e2e still loads suppliers/billing (otherwise the upload button stays disabled).
  const queryEnabled = isApiMockMode || clerkReady;

  const [dragging, setDragging]     = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [template, setTemplate]     = useState(TEMPLATES[0]);
  const [mode, setMode]             = useState<ModeKey>("auto");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [pipelineStage, setPipelineStage] = useState(-1);
  const [uploadError, setUploadError] = useState<{ code: string; title: string; message: string; cta: string } | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectFormatResult | null>(null);
  const [detectionLoading, setDetectionLoading] = useState(false);
  const detectAbortRef = useRef<AbortController | null>(null);

  const { data: billing, isLoading: billingLoading, isError: billingError } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
  });

  const {
    data: suppliers = [],
    isLoading: suppliersLoading,
    isError: suppliersError,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    staleTime: 5 * 60 * 1000,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
  });

  const { data: onboardingStatus } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiClient.getOnboardingStatus(),
    enabled: queryEnabled,
    retry: 1,
    staleTime: 60 * 1000,
  });

  // Recent uploads come from the live orders API. In mock mode we show demo
  // rows for local dev; otherwise the list reflects the user's real orders and
  // the whole card is hidden when there are none.
  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: clerkReady && !isApiMockMode,
  });
  const recentOrders = ordersPage?.items ?? [];

  const recentRows: RecentRow[] = isApiMockMode
    ? DEMO_RECENT
    : [...recentOrders]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 6)
        .map((o) => ({
          id: o.id,
          name: o.poNumber,
          fmt: formatKeyFromSource(o.sourceFormat),
          buyer: o.buyerName ?? "—",
          supplier: o.supplierName,
          size: "—",
          age: relativeAge(o.createdAt),
          status: recentStatusFromOrder(o.status),
        }));

  const openOrder = (id: string) =>
    router.push(`/inbox/${id}`);

  useEffect(() => {
    if (suppliers.length === 0) {
      if (supplierId) setSupplierId("");
      return;
    }
    const stillValid = suppliers.some((s) => s.id === supplierId);
    if (!supplierId || !stillValid) {
      const paramId = searchParams?.get("supplierId");
      if (paramId && suppliers.some((s) => s.id === paramId)) {
        setSupplierId(paramId);
      } else {
        setSupplierId(suppliers[0].id);
      }
    }
  }, [suppliers, supplierId, searchParams]);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const isReadOnly = billing ? !billing.canProcessOrders : false;
  const hasSupplier = Boolean(selectedSupplier?.id);
  const isUploadDisabled = uploading || isReadOnly || !hasSupplier || suppliersLoading;

  async function handleUpload() {
    if (uploading) return;
    if (isReadOnly) {
      setUploadError(getLimitMessage(billing?.isTrialExpired ? "pilot_expired" : "order_limit_reached"));
      return;
    }
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }
    if (!selectedSupplier?.id) {
      setUploadError({
        code: "supplier_required",
        title: "Choose a supplier first.",
        message: "Add a supplier in the library before uploading a purchase order.",
        cta: "Open suppliers",
      });
      return;
    }
    setUploadError(null);
    setUploading(true);
    setPipelineStage(0);

    let uploadedOrderId: string;
    try {
      if (onboardingStatus && !onboardingStatus.hasUpload) {
        const name = selectedFile.name.toLowerCase();
        const fileKind = name.endsWith(".pdf")
          ? "pdf"
          : name.endsWith(".xlsx") || name.endsWith(".xls")
          ? "xlsx"
          : "csv";
        capture("first_upload_started", { file_kind: fileKind });
      }
      const result = await apiClient.uploadPurchaseOrder(selectedFile, selectedSupplier.id);
      uploadedOrderId = result.order.id;
      // Cache the format-detection result so ParseFailedPanel can show it if parsing fails.
      if (detection) {
        try {
          sessionStorage.setItem(`detectResult:${uploadedOrderId}`, JSON.stringify(detection));
        } catch {
          // sessionStorage unavailable — silently skip
        }
      }
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 429) {
        setUploadError(getLimitMessage(getLimitCode(error.body)));
      } else {
        setUploadError({
          code: "upload_failed",
          title: "Upload could not start.",
          message: error instanceof Error ? error.message : "Check the API connection and try again.",
          cta: "Review settings",
        });
      }
      setUploading(false);
      setPipelineStage(-1);
      return;
    }

    // Animate pipeline stages
    PIPELINE_STAGES.forEach((_, i) => {
      const t = setTimeout(() => setPipelineStage(i), i * STAGE_MS);
      timerRefs.current.push(t);
    });
    const previewPath = `/upload/preview/${encodeURIComponent(uploadedOrderId)}`;
    const total = setTimeout(() => {
      router.push(previewPath);
    }, PIPELINE_STAGES.length * STAGE_MS + 200);
    timerRefs.current.push(total);
  }

  async function handleSample() {
    if (sampleLoading || uploading) return;
    capture("sample_order_started", { from_route: "/upload" });
    setSampleError(null);
    setSampleLoading(true);
    try {
      const { orderId } = await apiClient.runSampleOrder();
      router.push(`/inbox/${encodeURIComponent(orderId)}?sample=1`);
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "upload_sample_cta" },
        extra: {
          api_base_url: process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)",
          is_mock_mode: isApiMockMode,
        },
      });
      setSampleError(err instanceof Error ? err.message : "Could not start sample run.");
      setSampleLoading(false);
    }
  }

  function triggerDetection(file: File) {
    // Abort any in-flight detection for a previously selected file.
    detectAbortRef.current?.abort();
    const controller = new AbortController();
    detectAbortRef.current = controller;

    setDetection(null);
    setDetectionLoading(true);

    apiClient.detectFormat(file).then((result) => {
      if (controller.signal.aborted) return;
      setDetection(result);
      setDetectionLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      // Silently swallow — detection is a hint only.
      setDetection(null);
      setDetectionLoading(false);
    });
  }

  // Default output template when cxml is detected.
  useEffect(() => {
    if (!detection) return;
    if (detection.format === "cxml") {
      const match = TEMPLATES.find((t) => t.includes("cXML"));
      if (match) setTemplate(match);
    }
    // ubl has no matching template in TEMPLATES; leave the current selection.
  }, [detection]);

  // Cleanup timers on unmount
  useEffect(() => () => { timerRefs.current.forEach(clearTimeout); }, []);

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background: "#F6F7FA" }}
    >
      {/* Page header — sits on the grey canvas (no white bar, no divider) to match design */}
      <div
        className="flex flex-col items-start gap-1 px-4 pt-5 pb-4 sm:px-6 sm:items-end sm:flex-row sm:gap-4 flex-shrink-0"
        style={{ background: "#F6F7FA" }}
      >
        <div>
          <h1
            className="text-[24px] sm:text-[28px] font-bold tracking-[-0.02em] leading-tight"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: "#0B1A2F",
            }}
          >
            Upload an order
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: "#56627A" }}>
            Upload an order in any shape &mdash; we parse, normalize, and prepare it for review.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex w-full min-w-0 max-w-[860px] flex-col gap-4">
          {/* Centered single column: dropzone hero → sample → config → recent → tip */}
          {/* Phase 10.3 — Pilot Book-a-demo CTA */}
            {billing?.plan === "pilot" && process.env.NEXT_PUBLIC_BOOK_DEMO_URL && (
              <div
                style={{
                  background: "#F6F7FA",
                  border: "1px solid #E2E6EE",
                  borderLeft: "3px solid #28C55E",
                  borderRadius: 8,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <p style={{ margin: 0, fontSize: 13.5, color: "#3D4A5C" }}>
                  On Pilot? Get a guided 15-minute walkthrough with the team.
                </p>
                <a
                  href={process.env.NEXT_PUBLIC_BOOK_DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => capture("book_demo_clicked", { from_route: "/upload", plan: "pilot" })}
                  style={{
                    background: "#0B1A2F",
                    color: "#FFFFFF",
                    padding: "8px 14px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Book a 15-min demo →
                </a>
              </div>
            )}
            {/* Drop zone — single dashed-border card (matches design render exactly) */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files.item(0);
                  if (file) {
                    setSelectedFile(file);
                    setUploadError(null);
                    triggerDetection(file);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-4 px-6 py-10 sm:px-8 sm:py-14"
                style={{
                  border: `1.5px dashed ${dragging ? "#1E66C9" : "#C6CDDA"}`,
                  borderRadius: 10,
                  background: dragging ? "#EFF4FC" : "#FFFFFF",
                  boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
                  opacity: isReadOnly ? 0.62 : 1,
                  transition: "all 0.15s",
                  cursor: isReadOnly ? "not-allowed" : "pointer",
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.xml,.pdf,.json,.edi,.txt"
                  className="hidden"
                  disabled={isReadOnly || uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    setUploadError(null);
                    if (file) triggerDetection(file);
                  }}
                />
                {/* Upload icon — buyer-blue outline (matches design render exactly) */}
                <svg width="38" height="38" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <path
                    d="M11 14V4M11 4L7 8M11 4l4 4"
                    stroke={dragging ? "#1A5DBF" : "#1E66C9"}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
                    stroke={dragging ? "#1A5DBF" : "#1E66C9"}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>

                <div className="text-center" style={{ minWidth: 0, maxWidth: "100%" }}>
                  <p
                    className="text-[18px] font-bold tracking-[-0.01em] break-words"
                    style={{
                      color: "#0B1A2F",
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    }}
                  >
                    {selectedFile ? selectedFile.name : "Drop a purchase order here"}
                  </p>
                  <p className="text-[12.5px] mt-2" style={{ color: "#56627A" }}>
                    {selectedFile
                      ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB ready to send`
                      : "PDF · XLSX · CSV · cXML · UBL · EDIFACT · X12 — up to 10 MB"}
                  </p>
                </div>

                {/* Browse files — prominent accent CTA (also the file-picker trigger) */}
                <button
                  type="button"
                  disabled={isReadOnly || uploading}
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-[6px] px-4 py-2 text-[13px] font-semibold transition-colors"
                  style={{
                    background: isReadOnly || uploading ? "#E2E6EE" : "#1E66C9",
                    color: isReadOnly || uploading ? "#8A93A5" : "#FFFFFF",
                    border: "none",
                    boxShadow: isReadOnly || uploading ? "none" : "0 2px 8px rgba(30,102,201,0.25)",
                    cursor: isReadOnly || uploading ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => { if (!(isReadOnly || uploading)) e.currentTarget.style.background = "#1A5DBF"; }}
                  onMouseLeave={(e) => { if (!(isReadOnly || uploading)) e.currentTarget.style.background = "#1E66C9"; }}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path d="M9 1.5V5.5H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                  {selectedFile ? "Change file" : "Browse files"}
                </button>

                {/* Muted helper caption beneath the button (matches design) */}
                {!selectedFile && (
                  <p className="text-[11.5px] italic" style={{ color: "#99A1C5" }}>
                    {isApiMockMode
                      ? "(Demo: click anywhere to simulate a parsed PDF)"
                      : "or drop a file anywhere in this area"}
                  </p>
                )}

                {/* Format detection pill — shown once a file is selected */}
                {selectedFile && (detectionLoading || detection) && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    {detectionLoading && !detection ? (
                      <span
                        style={{
                          fontSize: 11.5,
                          padding: "6px 10px",
                          borderRadius: 99,
                          background: "#FFFFFF",
                          border: "1px solid #E2E6EE",
                          color: "#8A93A5",
                          userSelect: "none",
                        }}
                      >
                        Detecting format…
                      </span>
                    ) : detection ? (
                      <>
                        <span
                          title={detection.reasoning.join(" · ")}
                          style={{
                            fontSize: 11.5,
                            padding: "6px 10px",
                            borderRadius: 99,
                            background: "#FFFFFF",
                            border: "1px solid #E2E6EE",
                            color: "#0B1A2F",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "default",
                            userSelect: "none",
                          }}
                        >
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              flexShrink: 0,
                              background:
                                detection.confidence >= 0.8
                                  ? "#1DAF50"
                                  : detection.confidence >= 0.5
                                  ? "#C97A14"
                                  : "#8A93A5",
                            }}
                          />
                          Detected:{" "}
                          {detection.format === "csv"
                            ? "CSV"
                            : detection.format === "xlsx"
                            ? "Excel"
                            : detection.format === "pdf"
                            ? "PDF"
                            : detection.format === "cxml"
                            ? "cXML PO"
                            : detection.format === "ubl"
                            ? "UBL Order"
                            : detection.format === "edifact"
                            ? "EDIFACT"
                            : detection.format === "x12"
                            ? "X12"
                            : "Unknown format"}
                          {" · "}
                          {Math.round(detection.confidence * 100)}%
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              border: "1px solid #C6CDDA",
                              fontSize: 9,
                              color: "#8A93A5",
                              fontWeight: 700,
                              lineHeight: 1,
                              flexShrink: 0,
                            }}
                          >
                            i
                          </span>
                        </span>
                        {detection.detectedPoNumber !== null && (
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 11,
                              color: "#56627A",
                            }}
                          >
                            PO {detection.detectedPoNumber} · {detection.estimatedLineCount ?? 0} lines
                          </span>
                        )}
                        {/* Schema fingerprint recognition — org-scoped "we've seen this before" */}
                        {detection.seenCount != null && detection.seenCount > 0 && (
                          <span
                            title="We recognise this column layout from your previous uploads, so we're more confident in the detected format."
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 11.5,
                              padding: "4px 9px",
                              borderRadius: 99,
                              background: "#DCFCE7",
                              border: "1px solid #A6E9BC",
                              color: "#1DAF50",
                              fontWeight: 600,
                              userSelect: "none",
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path
                                d="M2.5 6.2l2.2 2.2 4.8-5"
                                stroke="#1DAF50"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            We&apos;ve seen this layout {detection.seenCount}{" "}
                            {detection.seenCount === 1 ? "time" : "times"} before
                          </span>
                        )}
                      </>
                    ) : null}
                  </div>
                )}

            </div>

            {/* Phase 6.3 — Try with sample order: the zero-friction primary first action */}
            <XCard edge="left" edgeColor="#28C55E">
              <div className="flex flex-col gap-3 px-4 py-4">
                <div style={{ minWidth: 0 }}>
                  <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                    New here? Start with a sample order
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: "#56627A" }}>
                    No purchase order handy? Run one with an example CSV in seconds — it won&apos;t count toward your monthly quota.
                  </p>
                  {sampleError && (
                    <p className="mt-2 text-[12px]" style={{ color: "#C53A3A" }}>
                      {sampleError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSample}
                  disabled={sampleLoading || uploading}
                  className="w-full rounded-[6px] py-2.5 text-[13px] font-semibold transition-all"
                  style={{
                    background: sampleLoading || uploading ? "#E2E6EE" : "#0B1A2F",
                    color: sampleLoading || uploading ? "#8A93A5" : "#FFFFFF",
                    border: "none",
                    boxShadow: sampleLoading || uploading ? "none" : "0 2px 8px rgba(11,26,47,0.18)",
                    cursor: sampleLoading || uploading ? "not-allowed" : "pointer",
                  }}
                >
                  {sampleLoading ? "Starting sample…" : "Try with a sample order →"}
                </button>
              </div>
            </XCard>

            {/* Recent uploads — hidden entirely when there is nothing recent */}
            {recentRows.length > 0 && (
            <XCard edge="left" edgeColor="#E2E6EE">
              <div
                className="flex items-center px-4 py-3"
                style={{ borderBottom: "1px solid #E2E6EE" }}
              >
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "#0B1A2F" }}
                >
                  Recent uploads
                </span>
                <div className="flex-1" />
                <Link
                  href="/inbox"
                  className="text-[12px] font-medium"
                  style={{ color: "#1DAF50" }}
                >
                  View all ↗
                </Link>
              </div>

              <div className="divide-y divide-[#F0F2F6] sm:hidden">
                {recentRows.map((row) => {
                  const pill = STATUS_PILL[row.status];
                  return (
                    <button
                      key={row.id}
                      onClick={() => openOrder(row.id)}
                      className="block w-full px-4 py-3 text-left transition-colors"
                      style={{ background: "transparent", border: "none" }}
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <span
                          className="min-w-0 truncate font-mono text-[11.5px]"
                          style={{ color: "#0B1A2F" }}
                        >
                          {row.name}
                        </span>
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: pill.bg, color: pill.color }}
                        >
                          {pill.label}
                        </span>
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <FileChip type={row.fmt} />
                        <span className="text-[11.5px]" style={{ color: "#8A93A5" }}>
                          {row.size === "—" ? row.age : `${row.size} · ${row.age}`}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px]">
                        <span className="truncate" style={{ color: "#28C55E" }}>
                          {row.buyer}
                        </span>
                        <span className="h-px w-5" style={{ background: "linear-gradient(90deg, #28C55E, #1DAF50)" }} />
                        <span className="truncate text-right" style={{ color: "#1DAF50" }}>
                          {row.supplier}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table
                  className="w-full min-w-[760px] border-collapse"
                  style={{ fontSize: 12.5 }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid #E2E6EE" }}>
                      {["File", "Format", "Route", "Size", "Age", "Status"].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                            style={{ color: "#8A93A5" }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((row) => {
                      const pill = STATUS_PILL[row.status];
                      return (
                        <tr
                          key={row.id}
                          onClick={() => openOrder(row.id)}
                          className="transition-colors cursor-pointer"
                          style={{ borderBottom: "1px solid #F0F2F6" }}
                          onMouseEnter={(e) =>
                            ((e.currentTarget as HTMLElement).style.background =
                              "#F6F7FA")
                          }
                          onMouseLeave={(e) =>
                            ((e.currentTarget as HTMLElement).style.background =
                              "transparent")
                          }
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className="font-mono text-[11.5px]"
                              style={{ color: "#0B1A2F" }}
                            >
                              {row.name}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <FileChip type={row.fmt} />
                          </td>
                          <td className="px-4 py-2.5 min-w-[250px]">
                            <span
                              className="text-[12px]"
                              style={{ color: "#28C55E" }}
                            >
                              {row.buyer}
                            </span>
                            <span
                              className="mx-1 text-[11px]"
                              style={{ color: "#C6CDDA" }}
                            >
                              →
                            </span>
                            <span
                              className="text-[12px]"
                              style={{ color: "#1DAF50" }}
                            >
                              {row.supplier}
                            </span>
                          </td>
                          <td
                            className="px-4 py-2.5 text-[12px]"
                            style={{ color: "#56627A" }}
                          >
                            {row.size}
                          </td>
                          <td
                            className="px-4 py-2.5 text-[12px]"
                            style={{ color: "#8A93A5" }}
                          >
                            {row.age}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
                              style={{ background: pill.bg, color: pill.color }}
                            >
                              {pill.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </XCard>
            )}

            {/* Pipeline configuration — supplier, output template, processing mode */}
            <XCard edge="left" edgeColor="#28C55E">
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid #E2E6EE" }}
              >
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "#0B1A2F" }}
                >
                  Pipeline configuration
                </span>
              </div>

              <div className="px-4 py-4 flex flex-col gap-4">
                {billing && (
                  <div
                    className="rounded-[7px] px-3 py-3"
                    style={{
                      background: isReadOnly ? "#FFF8EA" : "#F6F7FA",
                      border: `1px solid ${isReadOnly ? "#F0D39A" : "#E2E6EE"}`,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#56627A" }}>
                        {billing.plan} plan
                      </span>
                      <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: isReadOnly ? "#FAEFD6" : "#DCFCE7", color: isReadOnly ? "#9A5F0A" : "#1DAF50" }}>
                        {isReadOnly ? "Processing paused" : "Ready"}
                      </span>
                    </div>
                    <UsageLine label="Orders" used={billing.ordersThisMonth} limit={billing.orderLimit} />
                    <UsageLine label="Suppliers" used={billing.suppliersUsed} limit={billing.supplierLimit} />
                    {billing.trialEndsAt && billing.plan === "pilot" && (
                      <p className="mt-2 text-[11.5px]" style={{ color: "#56627A" }}>
                        Pilot ends {new Date(billing.trialEndsAt).toLocaleDateString()}.
                      </p>
                    )}
                    {isReadOnly && (
                      <p className="mt-2 text-[11.5px] leading-5" style={{ color: "#7A4D0B" }}>
                        You can still view previous orders, but new order processing is paused until the plan is upgraded.
                      </p>
                    )}
                  </div>
                )}

                {billingLoading && (
                  <div className="rounded-[7px] px-3 py-3 text-[12px]" style={{ border: "1px solid #E2E6EE", background: "#F6F7FA", color: "#56627A" }}>
                    Checking plan limits...
                  </div>
                )}

                {billingError && (
                  <div className="rounded-[7px] px-3 py-3 text-[12px]" style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}>
                    Plan status is unavailable. Uploads may fail if the API cannot be reached.
                  </div>
                )}

                {/* Buyer — auto-detected from the document during parsing (not a manual choice). */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#56627A" }}
                  >
                    Buyer
                  </label>
                  <div
                    className="w-full rounded-[6px] px-3 py-2 text-[13px]"
                    style={{ border: "1px solid #E2E6EE", background: "#F6F7FA", color: "#56627A" }}
                  >
                    Detected from the uploaded document
                  </div>
                </div>

                {/* Route arrow */}
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        "linear-gradient(90deg, #E2E6EE 0%, rgba(40,197,94,0.5) 100%)",
                    }}
                  />
                  <span
                    className="text-[11px] font-mono"
                    style={{ color: "#8A93A5" }}
                  >
                    routes to
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        "linear-gradient(90deg, rgba(40,197,94,0.5) 0%, #E2E6EE 100%)",
                    }}
                  />
                </div>

                {/* Supplier */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#56627A" }}
                  >
                    Supplier
                  </label>
                  {suppliersLoading && (
                    <div
                      className="rounded-[6px] px-3 py-2 text-[12px]"
                      style={{ border: "1px solid #E2E6EE", background: "#F6F7FA", color: "#56627A" }}
                    >
                      Loading suppliers...
                    </div>
                  )}
                  {suppliersError && !suppliersLoading && (
                    <div
                      className="rounded-[6px] px-3 py-2 text-[12px]"
                      style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
                    >
                      Could not load suppliers. Check the API connection and try again.
                    </div>
                  )}
                  {!suppliersLoading && !suppliersError && suppliers.length === 0 && (
                    <div
                      className="rounded-[6px] px-3 py-2.5 text-[12px] leading-5"
                      style={{ border: "1px solid #E2E6EE", background: "#F6F7FA", color: "#56627A" }}
                    >
                      No suppliers yet.{" "}
                      <Link href="/library/suppliers" className="font-medium underline" style={{ color: "#1DAF50" }}>
                        Add a supplier
                      </Link>{" "}
                      before uploading.
                    </div>
                  )}
                  {!suppliersLoading && suppliers.length > 0 && (
                    <select
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                      style={{
                        border: "1px solid #E2E6EE",
                        background: "#FFFFFF",
                        color: "#0B1A2F",
                        outline: "none",
                      }}
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div
                  style={{ height: 1, background: "#E2E6EE" }}
                />

                {/* Output template */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#8A93A5" }}
                  >
                    Output template
                  </label>
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      outline: "none",
                    }}
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Mode toggle */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#8A93A5" }}
                  >
                    Processing mode
                  </label>
                  <div
                    className="flex rounded-[6px] overflow-hidden text-[12.5px]"
                    style={{ border: "1px solid #E2E6EE" }}
                  >
                    {(["auto", "manual"] as ModeKey[]).map((m) => (
                      <button
                        key={m}
                        className="flex-1 py-2 font-medium capitalize transition-colors"
                        style={{
                          background:
                            mode === m ? "#0B1A2F" : "#FFFFFF",
                          color: mode === m ? "#FFFFFF" : "#56627A",
                          borderRight: m === "auto" ? "1px solid #E2E6EE" : undefined,
                        }}
                        onClick={() => setMode(m)}
                      >
                        {m === "auto" ? "Auto-process" : "Manual review"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto-process warning */}
                {mode === "auto" && (
                  <div
                    className="flex gap-2 rounded-[6px] px-3 py-2.5"
                    style={{ background: "#FAEFD6", border: "1px solid #F0D98A" }}
                  >
                    <span style={{ color: "#C97A14", fontSize: 14, flexShrink: 0 }}>
                      ⚠
                    </span>
                    <p className="text-[11.5px]" style={{ color: "#7A5000" }}>
                      Auto-process will send to the supplier without human review.
                      Enable only for trusted routes.
                    </p>
                  </div>
                )}

                {/* 429 billing error banner */}
                {uploadError && (
                  <div style={{
                    borderRadius: 7,
                    padding: "10px 14px",
                    background: "#FAEFD6",
                    border: "1px solid #C97A14",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    fontSize: 12.5,
                    color: "#7A4A0A",
                  }}>
                    <span>
                      <strong style={{ display: "block", color: "#7A4A0A" }}>{uploadError.title}</strong>
                      <span>{uploadError.message}</span>
                    </span>
                    <a
                      href="/settings"
                      style={{ fontWeight: 600, color: "#C97A14", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      {uploadError.cta} →
                    </a>
                  </div>
                )}

                {/* Pipeline progress (shown while uploading) */}
                {uploading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "space-between" }}>
                      {PIPELINE_STAGES.map((stage, i) => {
                        const done    = i < pipelineStage;
                        const active  = i === pipelineStage;
                        const pending = i > pipelineStage;
                        return (
                          <div key={stage} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{
                              height: 3,
                              borderRadius: 99,
                              width: "100%",
                              background: done    ? "#1DAF50"
                                        : active  ? "#28C55E"
                                        : "#E2E6EE",
                              transition: "background 0.3s",
                              position: "relative",
                              overflow: "hidden",
                            }}>
                              {active && (
                                <div style={{
                                  position: "absolute",
                                  inset: 0,
                                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                                  animation: "pipeline-shimmer 0.8s linear infinite",
                                }} />
                              )}
                            </div>
                            <span style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: "0.04em",
                              color: done ? "#1DAF50" : active ? "#28C55E" : "#C6CDDA",
                              transition: "color 0.2s",
                            }}>
                              {done ? "✓ " : ""}{stage}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <style>{`@keyframes pipeline-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }`}</style>
                  </div>
                )}

                {/* Send button */}
                <button
                  onClick={handleUpload}
                  disabled={isUploadDisabled}
                  className="w-full rounded-[6px] py-2.5 text-[13px] font-semibold transition-all"
                  style={{
                    background: isUploadDisabled
                      ? "#E2E6EE"
                      : "linear-gradient(90deg, #28C55E 0%, #1DAF50 100%)",
                    color: isUploadDisabled ? "#8A93A5" : "#FFFFFF",
                    border: "none",
                    boxShadow: isUploadDisabled ? "none" : "0 2px 8px rgba(40,197,94,0.25)",
                    cursor: isUploadDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  {uploading ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #C6CDDA", borderTopColor: "#28C55E", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      Sending…
                    </span>
                  ) : isReadOnly ? "Processing paused" : selectedFile ? "↑ Upload & send" : "Choose a file to send"}
                </button>
              </div>
            </XCard>

            {/* Tip card */}
            <XCard>
              <div className="px-4 py-3">
                <p
                  className="text-[11.5px] font-semibold mb-1"
                  style={{ color: "#6F4FCE" }}
                >
                  ✦ AI extraction
                </p>
                <p className="text-[11.5px] leading-relaxed" style={{ color: "#56627A" }}>
                  Unstructured PDFs and emails are parsed by our extraction engine.
                  Field confidence is shown per-zone in the Order Review.
                </p>
              </div>
            </XCard>
        </div>
      </div>
    </div>
  );
}

function UsageLine({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const color = unlimited || pct < 75 ? "#1DAF50" : pct < 95 ? "#C97A14" : "#C53A3A";

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span style={{ color: "#56627A" }}>{label}</span>
        <span style={{ color: "#0B1A2F", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
          {used} / {unlimited ? "Custom" : limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "#E2E6EE" }}>
        <div className="h-full rounded-full" style={{ width: `${unlimited ? 100 : pct}%`, background: color }} />
      </div>
    </div>
  );
}

function getLimitCode(body: unknown): string {
  const rawError =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error).toLowerCase()
      : "order_limit_reached";

  if (rawError.includes("pilot") && rawError.includes("expired")) return "pilot_expired";
  if (rawError.includes("supplier")) return "supplier_limit_reached";
  return "order_limit_reached";
}

function getLimitMessage(code: string): { code: string; title: string; message: string; cta: string } {
  if (code === "pilot_expired") {
    return {
      code,
      title: "Your Pilot has ended.",
      message: "You can still view previous orders, but new processing is paused.",
      cta: "Upgrade to Growth",
    };
  }

  if (code === "supplier_limit_reached") {
    return {
      code,
      title: "Your plan includes 1 supplier.",
      message: "Upgrade to Growth to add more supplier flows.",
      cta: "Upgrade plan",
    };
  }

  return {
    code,
    title: "You've reached your plan's order limit.",
    message: "Upgrade to continue processing new orders this month.",
    cta: "Upgrade plan",
  };
}
