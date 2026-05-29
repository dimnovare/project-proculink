"use client";

// Upload Workbench — XCard dropzone + pipeline picker + recent uploads.
// Translated from Bridge_Upload in v2-prototype.jsx.

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

// ─── Mock recent uploads ──────────────────────────────────────────────────────

const RECENT: Array<{
  name: string;
  fmt: FormatKey;
  buyer: string;
  supplier: string;
  size: string;
  age: string;
  status: "processing" | "done" | "failed" | "draft";
}> = [
  { name: "PO-DEMO-001.pdf",   fmt: "PDF",   buyer: "Heinrich Industries",  supplier: "Acme Components",    size: "214 KB", age: "2m",  status: "processing" },
  { name: "NRD_orders_may.xlsx",  fmt: "XLSX",  buyer: "Nordmark Logistics",   supplier: "VanDerBerg Metaal",  size: "88 KB",  age: "18m", status: "done"       },
  { name: "850-99201.edi",        fmt: "EDI",   buyer: "Centralis Pharma",     supplier: "MedicaSupply OY",    size: "12 KB",  age: "1h",  status: "failed"     },
  { name: "westmark_q2.csv",      fmt: "CSV",   buyer: "Westmark Tools",       supplier: "Acme Components",    size: "44 KB",  age: "3h",  status: "done"       },
  { name: "AR-2026-1107.xlsx",    fmt: "XLSX",  buyer: "Atlas Reseller AG",    supplier: "Nordix Distribution",size: "132 KB", age: "3h",  status: "draft"      },
];

const FORMATS: FormatKey[] = ["PDF", "XLSX", "CSV", "cXML", "EDI", "JSON", "EMAIL"];

const BUYERS  = ["Heinrich Industries", "Nordmark Logistics", "Steelhouse Const.", "Centralis Pharma", "Westmark Tools", "Atlas Reseller AG"];
const TEMPLATES = ["Standard cXML PO", "SAP IDoc ORDERS05", "ERP Generic v2", "Custom Nordmark"];

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  processing: { bg: "#EEE7FB", color: "#6F4FCE", label: "Processing" },
  done:       { bg: "#E2F1E2", color: "#1E6D29", label: "Done"       },
  failed:     { bg: "#FBE3E3", color: "#C53A3A", label: "Failed"     },
  draft:      { bg: "#EFF2F7", color: "#56627A", label: "Draft"      },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function XCard({
  edge = "none",
  edgeColor = "#1E66C9",
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
  const [dragging, setDragging]     = useState(false);
  const [buyer, setBuyer]           = useState(BUYERS[0]);
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
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectFormatResult | null>(null);
  const [detectionLoading, setDetectionLoading] = useState(false);
  const detectAbortRef = useRef<AbortController | null>(null);

  const { data: billing, isLoading: billingLoading, isError: billingError } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    retry: false,
  });

  const {
    data: suppliers = [],
    isLoading: suppliersLoading,
    isError: suppliersError,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: onboardingStatus } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiClient.getOnboardingStatus(),
    retry: false,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (suppliers.length === 0) {
      if (supplierId) setSupplierId("");
      return;
    }
    const stillValid = suppliers.some((s) => s.id === supplierId);
    if (!supplierId || !stillValid) {
      setSupplierId(suppliers[0].id);
    }
  }, [suppliers, supplierId]);

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
      const target = isApiMockMode
        ? `/inbox/${encodeURIComponent(orderId)}?sample=1`
        : `/orders/${encodeURIComponent(orderId)}?sample=1`;
      router.push(target);
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
      {/* Page header */}
      <div
        className="flex flex-col items-start gap-1 px-4 py-4 sm:px-6 sm:items-end sm:flex-row sm:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: "#0B1A2F",
            }}
          >
            Upload Workbench
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Drop a source document, set the route, and bridge it across.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* Left column: dropzone + recent */}
          <div className="flex min-w-0 flex-col gap-4">
            {/* Phase 10.3 — Pilot Book-a-demo CTA */}
            {billing?.plan === "pilot" && process.env.NEXT_PUBLIC_BOOK_DEMO_URL && (
              <div
                style={{
                  background: "#F6F7FA",
                  border: "1px solid #E2E6EE",
                  borderLeft: "3px solid #1E66C9",
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
            {/* Drop zone — XCard edge="top" with link-spine gradient */}
            <XCard
              edge="top"
              edgeColor="transparent"
              style={{
                borderTop: dragging
                  ? "2px solid #1E66C9"
                  : "2px solid transparent",
                backgroundImage: dragging
                  ? undefined
                  : "none",
                position: "relative",
              }}
            >
              {/* Gradient top border trick */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: dragging
                    ? "#1E66C9"
                    : "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
                  borderRadius: "8px 8px 0 0",
                }}
              />

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
                style={{
                  margin: 16,
                  marginTop: 18,
                  border: `2px dashed ${dragging ? "#1E66C9" : "#C6CDDA"}`,
                  borderRadius: 6,
                  padding: "32px 16px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  background: dragging ? "#E3EDFB40" : "#F6F7FA",
                  opacity: isReadOnly ? 0.62 : 1,
                  transition: "all 0.15s",
                  cursor: isReadOnly ? "not-allowed" : "pointer",
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
                {/* Upload icon */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#E3EDFB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path
                      d="M11 14V4M11 4L7 8M11 4l4 4"
                      stroke="#1E66C9"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
                      stroke="#1E66C9"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div className="text-center">
                  <p
                    className="text-[14px] font-semibold"
                    style={{ color: "#0B1A2F" }}
                  >
                    {selectedFile ? selectedFile.name : "Drop your source document here"}
                  </p>
                  <p className="text-[12.5px] mt-1" style={{ color: "#56627A" }}>
                    {selectedFile
                      ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB ready to bridge · `
                      : "or "}
                    <button
                      className="font-medium underline underline-offset-2"
                      style={{ color: "#1E66C9" }}
                      type="button"
                      disabled={isReadOnly || uploading}
                      onClick={(event) => {
                        event.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      {selectedFile ? "change file" : "browse files"}
                    </button>
                  </p>
                </div>

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
                                  ? "#2E8E3A"
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
                      </>
                    ) : null}
                  </div>
                )}

                {/* Format chips */}
                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  {FORMATS.map((f) => (
                    <FileChip key={f} type={f} />
                  ))}
                </div>
                <p className="text-[11.5px]" style={{ color: "#8A93A5" }}>
                  Supports CSV, XLSX, and PDF purchase orders. Max 25MB.
                </p>
              </div>
            </XCard>

            {/* Phase 6.3 — Try with sample order */}
            <XCard edge="left" edgeColor="#6F4FCE">
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                  <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                    Don&apos;t have a purchase order handy?
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: "#56627A" }}>
                    Run a sample order with an example CSV. It won&apos;t count toward your monthly quota.
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
                  className="rounded-[6px] px-3 py-2 text-[12.5px] font-semibold transition-all"
                  style={{
                    background: sampleLoading || uploading ? "#EFF2F7" : "#FFFFFF",
                    color: sampleLoading || uploading ? "#8A93A5" : "#6F4FCE",
                    border: "1px solid #C7B5F0",
                    cursor: sampleLoading || uploading ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sampleLoading ? "Starting sample…" : "Try with sample order →"}
                </button>
              </div>
            </XCard>

            {/* Recent uploads */}
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
                <span className="ml-2 text-[11.5px]" style={{ color: "#8A93A5" }}>
                  · last 24 hours
                </span>
                <div className="flex-1" />
                <button
                  className="text-[12px] font-medium"
                  style={{ color: "#1E66C9" }}
                >
                  View all ↗
                </button>
              </div>

              <div className="divide-y divide-[#F0F2F6] sm:hidden">
                {RECENT.map((row, i) => {
                  const pill = STATUS_PILL[row.status];
                  return (
                    <button
                      key={i}
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
                          {row.size} · {row.age}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px]">
                        <span className="truncate" style={{ color: "#1E66C9" }}>
                          {row.buyer}
                        </span>
                        <span className="h-px w-5" style={{ background: "linear-gradient(90deg, #1E66C9, #2E8E3A)" }} />
                        <span className="truncate text-right" style={{ color: "#2E8E3A" }}>
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
                    {RECENT.map((row, i) => {
                      const pill = STATUS_PILL[row.status];
                      return (
                        <tr
                          key={i}
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
                              style={{ color: "#1E66C9" }}
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
                              style={{ color: "#2E8E3A" }}
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
          </div>

          {/* Right column: pipeline picker */}
          <div className="flex min-w-0 flex-col gap-4">
            <XCard edge="left" edgeColor="#1E66C9">
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
                      <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: isReadOnly ? "#FAEFD6" : "#E3EDFB", color: isReadOnly ? "#9A5F0A" : "#1E66C9" }}>
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
                        You can still view previous crossings, but new order processing is paused until the plan is upgraded.
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

                {/* Buyer */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#1E66C9" }}
                  >
                    Buyer dock
                  </label>
                  <select
                    value={buyer}
                    onChange={(e) => setBuyer(e.target.value)}
                    className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      outline: "none",
                    }}
                  >
                    {BUYERS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* Route arrow */}
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
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
                        "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
                    }}
                  />
                </div>

                {/* Supplier */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#2E8E3A" }}
                  >
                    Supplier dock
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
                      <Link href="/library/suppliers" className="font-medium underline" style={{ color: "#1E66C9" }}>
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
                      Auto-process will cross the bridge without human review.
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
                              background: done    ? "#2E8E3A"
                                        : active  ? "#1E66C9"
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
                              color: done ? "#2E8E3A" : active ? "#1E66C9" : "#C6CDDA",
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

                {/* Bridge button */}
                <button
                  onClick={handleUpload}
                  disabled={isUploadDisabled}
                  className="w-full rounded-[6px] py-2.5 text-[13px] font-semibold transition-all"
                  style={{
                    background: isUploadDisabled
                      ? "#E2E6EE"
                      : "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
                    color: isUploadDisabled ? "#8A93A5" : "#FFFFFF",
                    border: "none",
                    boxShadow: isUploadDisabled ? "none" : "0 2px 8px rgba(30,102,201,0.25)",
                    cursor: isUploadDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  {uploading ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #C6CDDA", borderTopColor: "#1E66C9", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      Bridging…
                    </span>
                  ) : isReadOnly ? "Processing paused" : selectedFile ? "↑ Upload & bridge" : "Choose a file to bridge"}
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
    </div>
  );
}

function UsageLine({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const color = unlimited || pct < 75 ? "#2E8E3A" : pct < 95 ? "#C97A14" : "#C53A3A";

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
