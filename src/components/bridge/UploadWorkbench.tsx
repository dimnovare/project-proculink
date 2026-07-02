"use client";

// Upload Workbench — stepped intake: ① choose supplier → ② add file(s) → ③ upload.
// Two-column "bridge" card (supplier left, dropzone right) + full-width action footer.

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileChip } from "./FileChip";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { ApiHttpError, apiClient, getBillingStatus, isApiMockMode, type DetectFormatResult } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import { ACCEPTED_UPLOAD_FORMATS, hasAcceptedUploadExtension, isClearlyUnsupportedDragType } from "@/lib/upload-formats";

// Pipeline stages for the pre-redirect upload animation. "Transform" is NOT
// shown here: nothing is transformed before the review step, so claiming it
// would be dishonest (offer↔works). The real transform happens after review.
const PIPELINE_STAGES = ["Reading file", "Checking format", "Preparing review"] as const;
const STAGE_MS = 600;

// Accepted upload formats live in @/lib/upload-formats (the ONE frontend
// mirror of the backend whitelist in OrdersController.cs) — the dropzone
// accept attr, inline validation, and human copy all read from it. The old
// local constant here had drifted (it was missing .x12).

// ─── Types ────────────────────────────────────────────────────────────────────

type FormatKey = "PDF" | "XLSX" | "CSV" | "cXML" | "EDI" | "JSON" | "EMAIL";

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

const STATUS_PILL: Record<RecentStatus, { bg: string; color: string; label: string }> = {
  processing: { bg: "#F0EAFB", color: "#6F4FCE", label: "Processing" },
  done:       { bg: "#E9F1EA", color: "#1E6D29", label: "Delivered"  },
  failed:     { bg: "#FBE3E3", color: "#B43838", label: "Failed"     },
  review:     { bg: "#FAF1DD", color: "#9A5F0A", label: "Needs review" },
  ready:      { bg: "#E9F1EA", color: "#1E6D29", label: "Ready"      },
  draft:      { bg: "#F1F3F7", color: "#5E6779", label: "Draft"      },
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
        border: "1px solid #E5E8EE",
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

/**
 * StepBadge — the numbered "1 · 2 · 3" circle that anchors each intake step.
 * Decorative (the step heading carries the real label) so it's aria-hidden.
 * Tone maps to the Bridge palette: supplier=green, intake=buyer-blue.
 */
function StepBadge({ n, tone }: { n: number; tone: "blue" | "green" }) {
  const bg = tone === "green" ? "#1E6D29" : "#1E66C9";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        flexShrink: 0,
        borderRadius: "50%",
        background: bg,
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
      }}
    >
      {n}
    </span>
  );
}

/** StepHeading — numbered badge + title + optional one-line hint. */
function StepHeading({
  n,
  tone,
  title,
  hint,
}: {
  n: number;
  tone: "blue" | "green";
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <StepBadge n={n} tone={tone} />
      <div className="min-w-0">
        <h2
          className="text-[14px] font-semibold"
          style={{
            color: "#0B1A2F",
            margin: 0,
            lineHeight: 1.2,
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          }}
        >
          {title}
        </h2>
        {hint && (
          <p className="text-[11.5px]" style={{ color: "#5E6779", margin: "2px 0 0" }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * InfoDisclosure — a tap-toggle "i" affordance that reveals explanatory text.
 *
 * Replaces native `title=` tooltips, which never appear on touch devices.
 * The circle is a real button (keyboard + screen-reader accessible) and the
 * panel toggles open on click/tap and closes on outside-tap or Escape.
 */
function InfoDisclosure({
  label,
  text,
  tone = "muted",
}: {
  label: string;
  text: string;
  tone?: "muted" | "ai";
}) {
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

  const border = tone === "ai" ? "#C5B8F0" : "#CBD0DA";
  const color = tone === "ai" ? "#6F4FCE" : "var(--ink-faint)";

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
          border: `1px solid ${border}`,
          background: open ? (tone === "ai" ? "#F0EAFB" : "#F1F3F7") : "transparent",
          fontSize: 9,
          color,
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
            right: 0,
            zIndex: 30,
            width: "max-content",
            maxWidth: 260,
            padding: "8px 10px",
            borderRadius: 6,
            background: "#FFFFFF",
            border: "1px solid #E5E8EE",
            boxShadow: "0 4px 14px rgba(11,26,47,0.12)",
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.4,
            color: "#3D4A5C",
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UploadWorkbench() {
  // Direction-aware party label: outbound orgs see "Supplier", inbound "Customer".
  const { labels } = useOrderDirection();
  // Mock mode AND live QA-bypass e2e have no Clerk session — gate via
  // useQueriesEnabled (mock OR qa-bypass OR signed-in) so they still load
  // suppliers/billing (otherwise the upload button stays disabled).
  const queryEnabled = useQueriesEnabled();
  const queryClient = useQueryClient();

  const [dragging, setDragging]     = useState(false);
  // True while a drag is over the dropzone AND the dragged item is an
  // unambiguously-unsupported type (image/audio/video). Drives the red
  // "this file type isn't supported" drag affordance. Only clearly-wrong types
  // flip this — empty/ambiguous MIME types stay in the neutral `dragging` state
  // so a real PO is never wrongly rejected mid-drag (see isClearlyUnsupportedDragType).
  const [dragReject, setDragReject] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Multi-file selection: the backend is one-order-per-file, so N files become N sequential
  // uploads. selectedFile stays the FIRST file (drives the single-file detection pill + dropzone
  // name) so the rich single-file flow is unchanged when exactly one file is picked. extraFiles
  // holds files #2..N; when non-empty we switch to the multi-file batch path.
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  // Per-file batch upload results (multi-file path): one row per file, surfaced in order.
  const [batchResults, setBatchResults] = useState<{ name: string; status: "pending" | "uploading" | "waiting" | "done" | "failed"; orderId?: string; error?: string }[]>([]);
  // Inline "unsupported file type" error shown at the dropzone, set the moment
  // a disallowed file is dropped or picked (before any upload round-trip).
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [pipelineStage, setPipelineStage] = useState(-1);
  const [uploadError, setUploadError] = useState<{ code: string; title: string; message: string; cta: string } | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Shared sample-order mutation (task 9) — same analytics/invalidation/
  // routing as every other practice-order entry point.
  const sample = useSampleOrder("/upload");
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

  // Shared onboarding-status query (same ["onboarding-status"] cache entry as
  // the checklist/chip — one fetch serves all surfaces).
  const { data: onboardingStatus } = useOnboardingStatus();

  // Recent uploads come from the live orders API. In mock mode we show demo
  // rows for local dev; otherwise the list reflects the user's real orders and
  // the whole card is hidden when there are none.
  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60 * 1000,
    retry: 1,
    // Live orders only: signed-in OR qa-bypass, but never mock (which uses DEMO_RECENT).
    enabled: queryEnabled && !isApiMockMode,
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

  // First-run org (no suppliers configured AND no recent orders): promote the
  // zero-friction "Try a sample" path above the dropzone. Established orgs keep
  // it below. In mock mode there's always demo data, so never treat as empty.
  const isEmptyOrg = !isApiMockMode && suppliers.length === 0 && recentRows.length === 0;

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
  // Multi-file mode: the full batch (first file + extras) and a count for the UI.
  const isMulti = extraFiles.length > 0;
  const allSelectedFiles = selectedFile ? [selectedFile, ...extraFiles] : [];
  const selectedCount = allSelectedFiles.length;
  const counterpartyNoun = labels.counterpartyNoun.toLowerCase();

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
      const noun = labels.counterpartyNoun.toLowerCase();
      setUploadError({
        code: "supplier_required",
        title: `Choose a ${noun} first.`,
        message: `Add a ${noun} in the library before uploading a purchase order.`,
        cta: `Open ${labels.counterpartyPlural.toLowerCase()}`,
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
    // STRUCT-2: route straight to the Order Workshop (/inbox/{id}). The workshop is
    // now a strict superset of the old /upload/preview "Confirm item codes" step —
    // it carries the same issues list AND the same bulk-accept parity (Accept all /
    // ≥85%). The /upload/preview route stays resolvable as a fallback (untouched).
    const reviewPath = `/inbox/${encodeURIComponent(uploadedOrderId)}`;
    const total = setTimeout(() => {
      router.push(reviewPath);
    }, PIPELINE_STAGES.length * STAGE_MS + 200);
    timerRefs.current.push(total);
  }

  // handleSample was replaced by the shared useSampleOrder hook (task 9):
  // identical capture → POST → redirect flow, plus onboarding-status/orders
  // cache invalidation that the inline version lacked.

  /**
   * Validate a chosen/dropped file against the accepted whitelist, then either
   * select it (clearing prior errors and kicking off format detection) or show
   * an inline unsupported-type error. Used by both the file picker and drop.
   */
  function acceptFile(file: File) {
    if (!hasAcceptedUploadExtension(file.name)) {
      setSelectedFile(null);
      setUploadError(null);
      setFileError(
        `${file.name} isn't supported. We read spreadsheets (Excel, CSV), PDFs, and order files (XML, EDI). Try a different file.`,
      );
      return;
    }
    setFileError(null);
    setSelectedFile(file);
    setExtraFiles([]);
    setBatchResults([]);
    setUploadError(null);
    triggerDetection(file);
  }

  /**
   * Accept a SET of dropped/picked files (multi-upload). The backend creates one order per
   * file, so we split the list into the first accepted file (drives the existing single-file
   * detection UI) + the rest (extraFiles → the batch path). Unsupported files are reported,
   * not silently dropped. A single file falls straight through to the rich single-file flow.
   */
  function acceptFiles(files: File[]) {
    const accepted = files.filter((f) => hasAcceptedUploadExtension(f.name));
    const rejected = files.filter((f) => !hasAcceptedUploadExtension(f.name));
    if (accepted.length === 0) {
      setSelectedFile(null);
      setExtraFiles([]);
      setUploadError(null);
      setFileError(
        `${rejected[0]?.name ?? "That file"} isn't supported. We read spreadsheets (Excel, CSV), PDFs, and order files (XML, EDI). Try a different file.`,
      );
      return;
    }
    if (accepted.length === 1) {
      // Single accepted file → the unchanged rich single-file path (detection pill etc.).
      acceptFile(accepted[0]);
      if (rejected.length > 0) setFileError(`Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"}.`);
      return;
    }
    setSelectedFile(accepted[0]);
    setExtraFiles(accepted.slice(1));
    setBatchResults([]);
    setUploadError(null);
    setDetection(null);
    setDetectionLoading(false);
    setFileError(rejected.length > 0 ? `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"}.` : null);
  }

  /** Upload a batch (selectedFile + extraFiles) sequentially: one order per file. */
  async function handleBatchUpload(allFiles: File[]) {
    if (uploading) return;
    if (isReadOnly) {
      setUploadError(getLimitMessage(billing?.isTrialExpired ? "pilot_expired" : "order_limit_reached"));
      return;
    }
    if (!selectedSupplier?.id) {
      const noun = labels.counterpartyNoun.toLowerCase();
      setUploadError({
        code: "supplier_required",
        title: `Choose a ${noun} first.`,
        message: `Add a ${noun} in the library before uploading a purchase order.`,
        cta: `Open ${labels.counterpartyPlural.toLowerCase()}`,
      });
      return;
    }
    setUploadError(null);
    setUploading(true);
    setBatchResults(allFiles.map((f) => ({ name: f.name, status: "pending" as const })));

    let anySucceeded = false;
    const attempts = new Array(allFiles.length).fill(0);
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      setBatchResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "uploading" } : r)));
      try {
        const result = await apiClient.uploadPurchaseOrder(file, selectedSupplier.id);
        anySucceeded = true;
        setUploadError(null); // recovered — clear any "pacing" banner shown while throttled
        setBatchResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "done", orderId: result.order.id } : r)));
      } catch (error) {
        if (error instanceof ApiHttpError && error.status === 429) {
          const code = getLimitCode(error.body);
          // A SPEED throttle (per-minute upload limiter) is NOT a plan cap. Pace THIS
          // file and retry it — don't mislabel it "Plan limit reached" or fail the rest.
          if (code === "rate_limited") {
            attempts[i] += 1;
            if (attempts[i] <= RATE_LIMIT_MAX_RETRIES) {
              setUploadError(getLimitMessage(code));
              setBatchResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "waiting", error: undefined } : r)));
              await sleep(RATE_LIMIT_BACKOFF_MS[Math.min(attempts[i] - 1, RATE_LIMIT_BACKOFF_MS.length - 1)]);
              i--; // retry the same file once the window clears
              continue;
            }
            // Retries exhausted — honest per-file failure, but keep going with the rest.
            setBatchResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: "Upload throttled — retry this file in a minute." } : r)));
            continue;
          }
          // A genuine plan/quota cap — every subsequent file would also be rejected, so abort.
          const capMsg = getLimitMessage(code);
          setBatchResults((prev) => prev.map((r, idx) => (idx >= i ? { ...r, status: "failed", error: capMsg.title } : r)));
          setUploadError(capMsg);
          break;
        }
        const message = error instanceof Error ? error.message : "Upload failed";
        setBatchResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: message } : r)));
        // A per-file failure does NOT abort the rest — keep going so one bad file doesn't sink the batch.
      }
    }

    setUploading(false);
    // Refresh the recent-orders list so the new orders appear without a manual reload.
    if (anySucceeded) {
      capture("multi_upload_batch_completed", { file_count: allFiles.length });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
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

  // Cleanup timers on unmount
  useEffect(() => () => { timerRefs.current.forEach(clearTimeout); }, []);

  // Phase 6.3 — Try with sample order: the zero-friction first action. Rendered
  // above the dropzone for a first-run org, below it otherwise (see isEmptyOrg).
  const sampleCard = (
    <XCard edge="left" edgeColor="#2E8E3A">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div style={{ minWidth: 0 }}>
          <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
            New here? Start with a sample order
          </p>
          <p className="text-[12px] mt-1" style={{ color: "#5E6779" }}>
            Try it free with a sample order. We give you an example purchase order to test the whole flow — no file of your own needed, and it won&apos;t use your quota.
          </p>
          {sample.error && (
            <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>
              {sample.error.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { if (!uploading) sample.runSample(); }}
          disabled={sample.isPending || uploading}
          className="w-full rounded-[6px] px-4 py-2.5 text-[13px] font-semibold transition-all sm:w-auto sm:flex-shrink-0"
          style={{
            background: sample.isPending || uploading ? "#E5E8EE" : "#0B1A2F",
            color: sample.isPending || uploading ? "var(--ink-faint)" : "#FFFFFF",
            border: "none",
            boxShadow: sample.isPending || uploading ? "none" : "0 2px 8px rgba(11,26,47,0.18)",
            cursor: sample.isPending || uploading ? "not-allowed" : "pointer",
          }}
        >
          {sample.isPending ? "Starting sample…" : "Try with a sample order →"}
        </button>
      </div>
    </XCard>
  );

  // The single primary submit action (Step 3). Branches multi vs single file:
  // the multi-file batch path fans the same supplier across N sequential uploads
  // (handleBatchUpload); the single/no-file path runs handleUpload (which opens
  // the picker when nothing is selected). Rendered ONCE in the footer so there is
  // never a duplicate CTA in the DOM.
  const primaryCta = (
    <button
      onClick={() => { if (isMulti) handleBatchUpload(allSelectedFiles); else handleUpload(); }}
      disabled={isUploadDisabled}
      className="w-full rounded-[7px] py-3 text-[14px] font-semibold transition-all min-h-[48px]"
      style={{
        background: isUploadDisabled
          ? "#E5E8EE"
          : "linear-gradient(90deg, #2E8E3A 0%, #1E6D29 100%)",
        color: isUploadDisabled ? "var(--ink-faint)" : "#FFFFFF",
        border: "none",
        boxShadow: isUploadDisabled ? "none" : "0 2px 10px rgba(46,142,58,0.28)",
        cursor: isUploadDisabled ? "not-allowed" : "pointer",
      }}
    >
      {uploading ? (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid #CBD0DA", borderTopColor: "#2E8E3A", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          {isMulti ? "Uploading…" : "Sending…"}
        </span>
      ) : isReadOnly
        ? "Processing paused"
        : isMulti
        ? `↑ Upload ${selectedCount} files`
        : selectedFile
        ? "↑ Upload & review"
        : "Choose a file to upload"}
    </button>
  );

  return (
    <PageShell>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pipeline-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} } .upload-dropzone:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 3px; border-radius: 10px; }`}</style>

      {/* Page header — canonical PageHeader on the grey canvas (no white bar, no divider) */}
      <PageHeader
        title="Upload an order"
        sub={"Three steps: choose who it goes to, add the file(s), send for review. We parse and normalize any shape."}
      />

      {/* Body — wider centered column so the two-step card fills the desktop
          viewport instead of leaving large empty gutters. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[1040px] flex-col gap-4">

        {/* Phase 10.3 — Pilot Book-a-demo CTA */}
        {billing?.plan === "pilot" && process.env.NEXT_PUBLIC_BOOK_DEMO_URL && (
          <div
            style={{
              background: "#F6F7FA",
              border: "1px solid #E5E8EE",
              borderLeft: "3px solid #2E8E3A",
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

        {/* First-run org: lead with the zero-friction sample path. */}
        {isEmptyOrg && sampleCard}

        {/* ===== Stepped intake card: ① supplier (left) · ② files (right) · ③ send (footer) ===== */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E5E8EE",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Bridge edge — buyer-blue → supplier-green, the locked Bridge Layer signature. */}
          <div style={{ height: 3, background: "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)" }} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {/* ── LEFT · Step ① Choose supplier + plan usage ── */}
            <aside
              className="flex flex-col gap-4 p-5"
              style={{ background: "#FAFBFD", borderBottom: "1px solid #E5E8EE" }}
            >
              <div className="upload-step-rail flex flex-col gap-3">
                <StepHeading
                  n={1}
                  tone="green"
                  title={`Choose a ${counterpartyNoun}`}
                  hint="Where these orders are sent"
                />

                <div>
                  <label htmlFor="upload-supplier" className="sr-only">
                    Choose a {counterpartyNoun}
                  </label>

                  {suppliersLoading && (
                    <div
                      className="rounded-[8px] px-3 text-[13px] flex items-center min-h-[48px]"
                      style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779" }}
                    >
                      Loading {labels.counterpartyPlural.toLowerCase()}…
                    </div>
                  )}

                  {suppliersError && !suppliersLoading && (
                    <div
                      className="rounded-[8px] px-3 py-2.5 text-[12px] leading-5"
                      style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
                    >
                      Could not load {labels.counterpartyPlural.toLowerCase()}. Check the API connection and try again.
                    </div>
                  )}

                  {!suppliersLoading && !suppliersError && suppliers.length === 0 && (
                    <div
                      className="rounded-[8px] px-3 py-3 text-[12.5px] leading-5"
                      style={{ border: "1px dashed #CBD0DA", background: "#FFFFFF", color: "#5E6779" }}
                    >
                      No {labels.counterpartyPlural.toLowerCase()} yet.{" "}
                      <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "#1E6D29" }}>
                        Add a {counterpartyNoun}
                      </Link>{" "}
                      to send orders to.
                    </div>
                  )}

                  {!suppliersLoading && suppliers.length > 0 && (
                    <div style={{ position: "relative" }}>
                      <select
                        id="upload-supplier"
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                        className="w-full rounded-[8px] pl-3 pr-10 text-[14px] appearance-none min-h-[48px] transition-colors"
                        style={{
                          border: `1.5px solid ${hasSupplier ? "#1E6D29" : "#CBD0DA"}`,
                          background: "#FFFFFF",
                          color: "#0B1A2F",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                      >
                        <path d="M4 6l4 4 4-4" stroke="#5E6779" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Route confirmation + buyer note — keeps the "bridge" mental model
                    visible the moment a supplier is chosen. */}
                {hasSupplier && (
                  <div
                    className="rounded-[8px] px-3 py-2.5"
                    style={{ background: "#FFFFFF", border: "1px solid #E5E8EE" }}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <span style={{ color: "#5E6779" }}>Routes to</span>
                      <span
                        className="min-w-0 flex-1 truncate text-right font-semibold"
                        style={{ color: "#1E6D29" }}
                        title={selectedSupplier?.name}
                      >
                        {selectedSupplier?.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="6" stroke="#CBD0DA" strokeWidth="1.2" />
                        <path d="M7 4.2v3.2l2 1.2" stroke="#99A1C5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Buyer fills in automatically once the document is parsed.
                    </div>
                  </div>
                )}
              </div>

              {/* Plan usage — moved up from the old bottom card so limits are
                  visible while choosing, not buried below the fold. */}
              {(billing || billingLoading || billingError) && (
                <div style={{ height: 1, background: "#E5E8EE" }} />
              )}

              {billing && (
                <div
                  className="rounded-[8px] px-3 py-3"
                  style={{
                    background: isReadOnly ? "#FFF8EA" : "#FFFFFF",
                    border: `1px solid ${isReadOnly ? "#F0D39A" : "#E5E8EE"}`,
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#5E6779" }}>
                      {billing.plan} plan
                    </span>
                    <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: isReadOnly ? "#FAF1DD" : "#E9F1EA", color: isReadOnly ? "#9A5F0A" : "#1E6D29" }}>
                      {isReadOnly ? "Processing paused" : "Ready"}
                    </span>
                  </div>
                  <UsageLine label="Orders" used={billing.ordersThisMonth} limit={billing.orderLimit} />
                  <UsageLine label={labels.counterpartyPlural} used={billing.suppliersUsed} limit={billing.supplierLimit} />
                  {billing.trialEndsAt && billing.plan === "pilot" && (
                    <p className="mt-2 text-[11.5px]" style={{ color: "#5E6779" }}>
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
                <div className="rounded-[8px] px-3 py-3 text-[12px]" style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779" }}>
                  Checking plan limits…
                </div>
              )}

              {billingError && (
                <div className="rounded-[8px] px-3 py-3 text-[12px]" style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}>
                  Plan status is unavailable. Uploads may fail if the API cannot be reached.
                </div>
              )}
            </aside>

            {/* ── RIGHT · Step ② Add file(s) ── */}
            <section className="flex flex-col gap-3 p-5">
              <StepHeading
                n={2}
                tone="blue"
                title="Add your order file(s)"
                hint="Drop one or more — each file becomes its own order"
              />

              {/* Drop zone — single dashed-border card. Focusable button so keyboard
                  users can open the picker with Enter/Space, not just mouse-click. */}
              <div
                role="button"
                tabIndex={isReadOnly ? -1 : 0}
                aria-label="Upload a purchase order — drop one or more files or press Enter to browse"
                aria-disabled={isReadOnly || undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (isReadOnly) return;
                  setDragging(true);
                  // Inspect dragged items' MIME types. If EVERY item is an
                  // unambiguously-unsupported type (image/audio/video), surface
                  // the rejection affordance before the user drops. Empty /
                  // ambiguous types (EDI/XML/CSV often report "") never trip it.
                  const items = Array.from(e.dataTransfer.items ?? []).filter((i) => i.kind === "file");
                  const allBad = items.length > 0 && items.every((i) => isClearlyUnsupportedDragType(i.type));
                  setDragReject(allBad);
                }}
                onDragLeave={() => { setDragging(false); setDragReject(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  setDragReject(false);
                  if (isReadOnly || uploading) return;
                  const files = Array.from(e.dataTransfer.files);
                  // acceptFiles re-validates by real extension and sets the
                  // inline error for anything the backend would reject — the
                  // dragover check is a fast hint, not the authoritative gate.
                  if (files.length > 0) acceptFiles(files);
                }}
                onClick={() => { if (!isReadOnly && !uploading) fileInputRef.current?.click(); }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isReadOnly && !uploading) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="upload-dropzone flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 sm:px-8 sm:py-12"
                style={{
                  border: `1.5px dashed ${dragReject ? "#B43838" : dragging ? "#1E66C9" : "#CBD0DA"}`,
                  borderRadius: 10,
                  background: dragReject ? "#FCEDED" : dragging ? "#EFF4FC" : "#FBFCFE",
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
                  // Mirrors the backend upload whitelist via the shared
                  // ACCEPTED_UPLOAD_FORMATS constant (lib/upload-formats.ts) —
                  // .xls / .json are NOT accepted server-side, so the lib
                  // omits them to avoid offering a dead format.
                  accept={ACCEPTED_UPLOAD_FORMATS.dropzoneAccept}
                  // Multi-file: the backend is one-order-per-file, so picking N files
                  // creates N orders via N sequential uploads (see handleBatchUpload).
                  multiple
                  className="hidden"
                  disabled={isReadOnly || uploading}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) {
                      acceptFiles(files);
                    } else {
                      setSelectedFile(null);
                      setExtraFiles([]);
                      setBatchResults([]);
                      setFileError(null);
                      setUploadError(null);
                    }
                    // Reset the input so re-picking the same file(s) fires onChange again.
                    event.target.value = "";
                  }}
                />
                {/* Upload icon — buyer-blue outline (matches design render exactly) */}
                <svg width="40" height="40" viewBox="0 0 22 22" fill="none" aria-hidden="true">
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
                      color: dragReject ? "#B43838" : "#0B1A2F",
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    }}
                  >
                    {dragReject
                      ? "This file type isn't supported"
                      : isMulti
                      ? `${selectedCount} files selected`
                      : selectedFile
                      ? selectedFile.name
                      : "Drop your order files here"}
                  </p>
                  <p className="text-[12.5px] mt-2" style={{ color: dragReject ? "#B43838" : "#5E6779" }}>
                    {dragReject
                      ? `We accept ${ACCEPTED_UPLOAD_FORMATS.humanList}`
                      : isMulti
                      ? "One order will be created per file"
                      : selectedFile
                      ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB ready to send`
                      : `One or more files · ${ACCEPTED_UPLOAD_FORMATS.humanList} · up to 10 MB each`}
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
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-[6px] px-4 py-2 text-[13px] font-semibold transition-colors"
                  style={{
                    background: isReadOnly || uploading ? "#E5E8EE" : "#1E66C9",
                    color: isReadOnly || uploading ? "var(--ink-faint)" : "#FFFFFF",
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
                  {selectedFile ? "Change file(s)" : "Browse files"}
                </button>

                {/* Inline unsupported-file-type error — set at drop/pick time,
                    before any upload round-trip (offer↔works: reject early). */}
                {fileError && (
                  <p
                    role="alert"
                    className="text-[12px] text-center max-w-[420px]"
                    style={{ color: "var(--danger)" }}
                  >
                    {fileError}
                  </p>
                )}

                {/* Muted helper caption beneath the button (matches design) */}
                {!selectedFile && !fileError && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--ink-faint)" }}>
                    {isApiMockMode
                      ? "(Demo: click anywhere to simulate a parsed PDF)"
                      : "or drop files anywhere in this area"}
                  </p>
                )}

                {/* Multi-file guidance — one order per file, all routed to the chosen supplier */}
                {!fileError && (
                  <p className="text-[11.5px] text-center max-w-[420px]" style={{ color: "var(--ink-faint)" }}>
                    Uploading several files? We create a separate order for each — all sent to the same {selectedSupplier?.name ?? counterpartyNoun}.
                  </p>
                )}

                {/* Format detection pill — shown once a single file is selected */}
                {selectedFile && !isMulti && (detectionLoading || detection) && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    {detectionLoading && !detection ? (
                      <span
                        style={{
                          fontSize: 11.5,
                          padding: "6px 10px",
                          borderRadius: 99,
                          background: "#FFFFFF",
                          border: "1px solid #E5E8EE",
                          color: "var(--ink-faint)",
                          userSelect: "none",
                        }}
                      >
                        Detecting format…
                      </span>
                    ) : detection ? (
                      <>
                        <span
                          style={{
                            fontSize: 11.5,
                            padding: "6px 10px",
                            borderRadius: 99,
                            background: "#FFFFFF",
                            border: "1px solid #E5E8EE",
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
                                  ? "#1E6D29"
                                  : detection.confidence >= 0.5
                                  ? "#B36D14"
                                  : "var(--ink-faint)",
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
                          {detection.reasoning.length > 0 && (
                            <InfoDisclosure
                              label="Why this format was detected"
                              text={detection.reasoning.join(" · ")}
                            />
                          )}
                        </span>
                        {detection.detectedPoNumber !== null && (
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 11,
                              color: "#5E6779",
                            }}
                          >
                            PO {detection.detectedPoNumber} · {detection.estimatedLineCount ?? 0} lines
                          </span>
                        )}
                        {/* Schema fingerprint recognition — org-scoped "we've seen this before" */}
                        {detection.seenCount != null && detection.seenCount > 0 && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 11.5,
                              padding: "4px 9px",
                              borderRadius: 99,
                              background: "#E9F1EA",
                              border: "1px solid #A6E9BC",
                              color: "#1E6D29",
                              fontWeight: 600,
                              userSelect: "none",
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path
                                d="M2.5 6.2l2.2 2.2 4.8-5"
                                stroke="#1E6D29"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            We&apos;ve seen this layout {detection.seenCount}{" "}
                            {detection.seenCount === 1 ? "time" : "times"} before
                            <InfoDisclosure
                              label="Why we recognise this layout"
                              text="We recognise this column layout from your previous uploads, so we're more confident in the detected format."
                            />
                          </span>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Multi-file batch list — N files → N orders. The action button lives
                  in the Step ③ footer; here we surface the per-file pending →
                  uploading → done/failed status with a link to each created order.
                  "done" means the UPLOAD landed and an order STUB was created — the
                  backend then parses asynchronously, so we say "Reading document…"
                  (not "✓ Ready") so an empty buyer / 0 lines for a moment isn't a surprise. */}
              {isMulti && (
                <div className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-1" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {(batchResults.length > 0
                      ? batchResults
                      : allSelectedFiles.map((f) => ({ name: f.name, status: "pending" as const, orderId: undefined, error: undefined }))
                    ).map((r, i) => (
                      <li
                        key={`${r.name}-${i}`}
                        className="flex items-center justify-between gap-3 rounded-[6px] px-2.5 py-2"
                        style={{ background: "#F6F7FA", border: "1px solid #EEF0F4" }}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: "#0B1A2F" }}>
                          {r.name}
                        </span>
                        {r.status === "done" && r.orderId ? (
                          <button
                            type="button"
                            onClick={() => openOrder(r.orderId!)}
                            className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold"
                            style={{ color: "#6F4FCE", background: "none", border: "none", cursor: "pointer" }}
                            title="Order created — we're reading the document and pulling out the buyer, lines and totals now. Open to follow along."
                          >
                            <span
                              aria-hidden
                              style={{ display: "inline-block", width: 9, height: 9, border: "1.5px solid #C9BCE8", borderTopColor: "#6F4FCE", borderRadius: "50%", animation: "spin 0.7s linear infinite" }}
                            />
                            Reading document… · Open →
                          </button>
                        ) : r.status === "failed" ? (
                          <span className="shrink-0 text-[11px] font-medium" style={{ color: "#B43838" }} title={r.error}>
                            ✕ {r.error ?? "Failed"}
                          </span>
                        ) : r.status === "uploading" ? (
                          <span className="shrink-0 text-[11px]" style={{ color: "#6F4FCE" }}>Uploading…</span>
                        ) : r.status === "waiting" ? (
                          <span className="shrink-0 text-[11px]" style={{ color: "#B36D14" }} title="Pacing uploads to stay within the per-minute limit — this file retries automatically.">
                            Pacing… retries shortly
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>Pending</span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {batchResults.length > 0 && !uploading && batchResults.some((r) => r.status === "done") && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[11.5px]" style={{ color: "#5E6779", margin: 0 }}>
                        Orders created. We&apos;re extracting each document now — the buyer, line
                        items and totals fill in automatically once extraction finishes.
                      </p>
                      <Link href="/inbox" className="text-[12px] font-semibold" style={{ color: "#1E6D29" }}>
                        View all in inbox ↗
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── FOOTER · Step ③ Send for review (full width) ── */}
          <div
            className="flex flex-col gap-3 p-5"
            style={{ borderTop: "1px solid #E5E8EE", background: "#FFFFFF" }}
          >
            {/* 429 / supplier-required / upload-failed error banner */}
            {uploadError && (
              <div
                role="alert"
                style={{
                  borderRadius: 7,
                  padding: "10px 14px",
                  background: "#FAF1DD",
                  border: "1px solid #B36D14",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  fontSize: 12.5,
                  color: "#7A4A0A",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: "#7A4A0A" }}>{uploadError.title}</strong>
                  <span>{uploadError.message}</span>
                </span>
                {(() => {
                  // "Got it" on the pacing/throttle banner is a pure acknowledgement
                  // — the copy explicitly says the plan and the other files are
                  // unaffected — so it dismisses the banner rather than deep-linking
                  // to billing (which the else-branch below would wrongly do).
                  if (uploadError.code === "rate_limited") {
                    return (
                      <button
                        type="button"
                        onClick={() => setUploadError(null)}
                        style={{ fontWeight: 600, color: "#B36D14", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: 0 }}
                      >
                        {uploadError.cta}
                      </button>
                    );
                  }
                  const ctaHref =
                    uploadError.code === "supplier_required" ? "/library/suppliers"
                    : uploadError.code === "upload_failed"   ? "/settings"
                    : "/settings?tab=billing";
                  return (
                    <a
                      href={ctaHref}
                      style={{ fontWeight: 600, color: "#B36D14", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      {uploadError.cta} →
                    </a>
                  );
                })()}
              </div>
            )}

            <div className="flex items-center gap-3">
              <StepBadge n={3} tone="green" />
              <div className="min-w-0 flex-1">{primaryCta}</div>
            </div>

            {/* Honest gating hint — the CTA is disabled until a supplier is chosen. */}
            {selectedCount > 0 && !hasSupplier && !suppliersLoading && (
              <p className="text-[11.5px]" style={{ color: "#9A5F0A", margin: 0 }}>
                Choose a {counterpartyNoun} in step 1 to enable the upload.
              </p>
            )}

            {/* Pipeline progress (single-file path, shown while uploading) */}
            {uploading && !isMulti && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "space-between" }}>
                  {PIPELINE_STAGES.map((stage, i) => {
                    const done    = i < pipelineStage;
                    const active  = i === pipelineStage;
                    return (
                      <div key={stage} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{
                          height: 3,
                          borderRadius: 99,
                          width: "100%",
                          background: done    ? "#1E6D29"
                                    : active  ? "#2E8E3A"
                                    : "#E5E8EE",
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
                          color: done ? "#1E6D29" : active ? "#2E8E3A" : "#CBD0DA",
                          transition: "color 0.2s",
                        }}>
                          {done ? "✓ " : ""}{stage}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Established org: keep the sample path below the intake card. */}
        {!isEmptyOrg && sampleCard}

        {/* Recent uploads — hidden entirely when there is nothing recent */}
        {recentRows.length > 0 && (
          <XCard edge="left" edgeColor="#E5E8EE">
            <div
              className="flex items-center px-4 py-3"
              style={{ borderBottom: "1px solid #E5E8EE" }}
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
                style={{ color: "#1E6D29" }}
              >
                View all ↗
              </Link>
            </div>

            <div className="flex flex-col gap-2 p-3 lg:hidden">
              {recentRows.map((row) => {
                const pill = STATUS_PILL[row.status];
                return (
                  <button
                    key={row.id}
                    onClick={() => openOrder(row.id)}
                    className="block w-full px-4 py-3.5 text-left transition-colors active:bg-[#F6F7FA]"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-card)",
                      minHeight: 44,
                    }}
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
                      <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                        {row.size === "—" ? row.age : `${row.size} · ${row.age}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px]">
                      <span className="truncate" style={{ color: "#2E8E3A" }}>
                        {row.buyer}
                      </span>
                      <span className="h-px w-5" style={{ background: "linear-gradient(90deg, #2E8E3A, #1E6D29)" }} />
                      <span className="truncate text-right" style={{ color: "#1E6D29" }}>
                        {row.supplier}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table
                className="w-full min-w-[760px] border-collapse"
                style={{ fontSize: 12.5 }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #E5E8EE" }}>
                    {["File", "Format", "Route", "Size", "Age", "Status"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                          style={{ color: "var(--ink-faint)" }}
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
                            style={{ color: "#2E8E3A" }}
                          >
                            {row.buyer}
                          </span>
                          <span
                            className="mx-1 text-[11px]"
                            style={{ color: "#CBD0DA" }}
                          >
                            →
                          </span>
                          <span
                            className="text-[12px]"
                            style={{ color: "#1E6D29" }}
                          >
                            {row.supplier}
                          </span>
                        </td>
                        <td
                          className="px-4 py-2.5 text-[12px]"
                          style={{ color: "#5E6779" }}
                        >
                          {row.size}
                        </td>
                        <td
                          className="px-4 py-2.5 text-[12px]"
                          style={{ color: "var(--ink-faint)" }}
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

        {/* Tip card */}
        <XCard>
          <div className="px-4 py-3">
            <p
              className="text-[11.5px] font-semibold mb-1"
              style={{ color: "#6F4FCE" }}
            >
              ✦ AI extraction
            </p>
            <p className="text-[11.5px] leading-relaxed" style={{ color: "#5E6779" }}>
              Text-based PDFs are read and structured by our AI extraction
              engine. Every number is checked against the source text, and
              anything that doesn't reconcile is flagged for review.
            </p>
          </div>
        </XCard>
      </div>
    </PageShell>
  );
}

function UsageLine({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const color = unlimited || pct < 75 ? "#1E6D29" : pct < 95 ? "#B36D14" : "#B43838";

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span style={{ color: "#5E6779" }}>{label}</span>
        <span style={{ color: "#0B1A2F", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
          {used} / {unlimited ? "Custom" : limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "#E5E8EE" }}>
        <div className="h-full rounded-full" style={{ width: `${unlimited ? 100 : pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Per-file retry budget when the upload SPEED limiter (not a plan cap) rejects a batch file. */
const RATE_LIMIT_MAX_RETRIES = 3;
/** Backoff before retrying a throttled file. The server limiter is a 60s fixed window, so the
 *  waits escalate toward a full window to land in a fresh one without failing the batch. */
const RATE_LIMIT_BACKOFF_MS = [15000, 35000, 61000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function getLimitCode(body: unknown): string {
  const rawError =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error).toLowerCase()
      : "order_limit_reached";

  // A SPEED throttle (the per-minute upload limiter) is NOT a plan/quota cap. The
  // backend's rate-limiter rejection body is { error: "Rate limit exceeded. Please
  // slow down and retry shortly." } — historically this fell through to the
  // "order_limit_reached" default and was shown to users as "Plan limit reached",
  // which is alarming and wrong (their plan is fine; they just uploaded too fast).
  if (rawError.includes("rate limit") || rawError.includes("slow down") || rawError.includes("too many"))
    return "rate_limited";
  if (rawError.includes("pilot") && rawError.includes("expired")) return "pilot_expired";
  if (rawError.includes("supplier")) return "supplier_limit_reached";
  return "order_limit_reached";
}

function getLimitMessage(code: string): { code: string; title: string; message: string; cta: string } {
  if (code === "rate_limited") {
    return {
      code,
      title: "Uploading a little fast.",
      message:
        "To keep processing reliable, ProcuLink paces uploads. Your plan and the other files are unaffected — each one retries automatically in a moment.",
      cta: "Got it",
    };
  }

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
