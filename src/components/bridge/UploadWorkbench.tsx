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
import { SupplierPicker } from "./SupplierPicker";
import { statusLabel } from "./UnifiedStatusBadge";
import { ApiHttpError, apiClient, getBillingStatus, isApiMockMode, type DetectFormatResult } from "@/lib/api-client";
// WP-36 — the failure classification this screen branches on is NOT re-invented
// here: classifyApiFailure already answers "what kind of failure is this", and
// planGate already turns a gate code into a sentence + the upgrade route the
// SERVER named. This screen only chooses words and destinations.
import { classifyApiFailure, isRequestTimeout } from "@/lib/apiFailure";
import { planGateMessage, planGateUpgradeUrl } from "@/lib/planGate";
import type { Supplier } from "@/types/procurement";
import { capture } from "@/lib/analytics";
import { BOOK_DEMO_URL, BOOK_DEMO_LINK_ATTRS } from "@/lib/book-demo";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import { PracticeOrderPrompt } from "./PracticeOrderPrompt";
import { ACCEPTED_UPLOAD_FORMATS, hasAcceptedUploadExtension, isClearlyUnsupportedDragType } from "@/lib/upload-formats";
import { serverReasonOrNull } from "@/lib/serverText";

// THERE IS NO STAGE TRACK ON THIS SCREEN, and the comment that used to sit here
// is the reason why. It argued about WHICH stages were honest to show ("Transform
// is NOT shown here: nothing is transformed before the review step") while all
// three of the stages it kept were fabricated:
//
//   const PIPELINE_STAGES = ["Reading file", "Checking format", "Preparing review"];
//   const STAGE_MS = 600;
//
// Those drove a setTimeout ladder that started AFTER the upload response, so
// "✓ Reading file" and "✓ Checking format" rendered as completed work at 600ms
// and 1200ms while the Worker had not necessarily begun reading the file — and
// the redirect fired at a fixed 2,000ms whether the parse had succeeded, failed,
// or not started. Three green checkmarks for work no server had reported.
//
// The only progress THIS screen can truthfully report is its own request: the
// upload is in flight, or it is not. Everything after it — reading the document,
// resolving the buyer, extracting lines — belongs to the order, and the order
// screen already reports it from the server rather than from a clock:
//
//   OrderWorkshop.tsx:988   status === "parsing"  → <ParsingGate stalled={isStuck}/>
//   useOrderReview.ts:167   refetchInterval 3s while parsing/transforming/delivering
//   parseStall.ts:22        escalates at 2 min without ever claiming failure
//   OrderWorkshop.tsx:965   a parse that ends `failed` → <OrderProblemPanel mode="gate">
//
// So the redirect now follows the upload's actual outcome and the order screen
// takes over. Building a second progress surface here would recreate exactly the
// duplicate WP-08 deleted (see the history note in parseStall.ts:4).

// Accepted upload formats live in @/lib/upload-formats (the ONE frontend
// mirror of the backend whitelist in OrdersController.cs) — the dropzone
// accept attr, inline validation, and human copy all read from it. The old
// local constant here had drifted (it was missing .x12).

// ─── Per-file size cap (WP-36 · defect B) ─────────────────────────────────────
//
// The dropzone has always PROMISED "up to 10 MB each" and nothing ever checked
// it: upload-formats.ts validates the extension only. So an oversized export
// travelled in full, was refused by the server, and came back through
// realUploadPurchaseOrder as `Upload failed: <status line>` — a dead end the
// operator cannot act on, because nothing in it says "your file is too big".
//
// The advertised cap and the enforced cap are now ONE number: the hero copy and
// the pre-flight refusal both read MAX_UPLOAD_BYTES, so the promise and the
// check cannot drift apart.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The cap as it is written to people — derived, never typed a second time. */
const MAX_UPLOAD_LABEL = `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`;

/** True when a file exceeds the advertised per-file cap. */
function isOverSizeCap(file: File): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

/** Human file size — "812 KB", "14.3 MB". Used when naming a refused file. */
function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** The one unsupported-format sentence — names the file, then what we do read. */
function unsupportedFileMessage(file: File): string {
  return `${file.name} isn't supported. We read spreadsheets (Excel, CSV), PDFs, and order files (XML, EDI). Try a different file.`;
}

/** The one over-size sentence: the file, its size, the cap, and what fixes it. */
function overSizeMessage(file: File): string {
  return `${file.name} is ${fileSizeLabel(file.size)} — over the ${MAX_UPLOAD_LABEL} limit for a single file. Split it into smaller files, or send fewer order lines at a time.`;
}

/** "a.csv" · "a.csv and b.csv" · "a.csv, b.csv, c.csv and 2 more". */
function nameList(names: string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * WP-36 · defect C — the multi-file refusal used to read "Skipped 4 unsupported
 * files." and name none of them. On a 12-file drop the operator was handed a
 * count and left to work out which four never became orders. Name them (capped
 * at three plus "and N more", so a 40-file drop is not a wall of text) and keep
 * the accepted-format guidance the single-file path already gives.
 *
 * `lead` lets the same clauses serve both call sites: "Skipped …" when part of
 * the drop was usable, "We can't use …" when none of it was.
 */
function refusedFilesMessage(lead: string, unsupported: File[], oversized: File[]): string | null {
  const clauses: string[] = [];
  if (unsupported.length > 0) {
    clauses.push(
      `${lead} ${nameList(unsupported.map((f) => f.name))} — we read ${ACCEPTED_UPLOAD_FORMATS.humanList}.`,
    );
  }
  if (oversized.length > 0) {
    clauses.push(
      `${lead} ${nameList(oversized.map((f) => `${f.name} (${fileSizeLabel(f.size)})`))} — over the ${MAX_UPLOAD_LABEL} limit for a single file. Split them, or send fewer order lines at a time.`,
    );
  }
  return clauses.length > 0 ? clauses.join(" ") : null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The footer error banner. `canRetry` and `href` are the WP-36 additions: the
 * banner used to hold one link ("Review settings →" to /settings) for every
 * cause, which is the right destination for exactly one of them.
 */
interface UploadErrorBanner {
  code: string;
  title: string;
  message: string;
  /** Label of the SECONDARY route — the one that matches the cause. */
  cta: string;
  /** Where that secondary route goes. Falls back to the code table at render. */
  href?: string;
  /** True when re-sending the same selection could plausibly work. */
  canRetry?: boolean;
}

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
  /** Tone bucket only — the WORDS come from `rawStatus`. */
  status: RecentStatus;
  /**
   * The raw backend OrderStatus. Carried so the pill can print the canonical
   * label instead of the tone bucket's name: the bucket folds many statuses
   * into six tones, and `default: "draft"` meant an order the supplier had
   * REFUSED — and one whose delivery was paused, and one parked with an unknown
   * outcome — all read "Draft" on the upload page while the inbox and the order
   * screen named them correctly.
   */
  rawStatus: string;
}

// Demo rows are dev-only (mock mode). Real users see their own orders from the
// live API, or nothing when there are no recent uploads — never staged data.
const DEMO_RECENT: RecentRow[] = [
  { id: "ord-001", name: "PO-DEMO-001.pdf",   fmt: "PDF",   buyer: "Heinrich Industries",  supplier: "Acme Components",    size: "214 KB", age: "2m",  status: "processing", rawStatus: "parsing"   },
  { id: "ord-002", name: "NRD_orders_may.xlsx",  fmt: "XLSX",  buyer: "Nordmark Logistics",   supplier: "VanDerBerg Metaal",  size: "88 KB",  age: "18m", status: "done",       rawStatus: "delivered" },
  { id: "ord-003", name: "westmark_q2.csv",      fmt: "CSV",   buyer: "Westmark Tools",       supplier: "Acme Components",    size: "44 KB",  age: "3h",  status: "done",       rawStatus: "delivered" },
];

// Colour only. The words are statusLabel(row.rawStatus) at the two render
// sites, so this table cannot become a seventh place that names a status.
const STATUS_PILL: Record<RecentStatus, { bg: string; color: string }> = {
  processing: { bg: "#F0EAFB", color: "#6F4FCE" },
  done:       { bg: "#E9F1EA", color: "#1E6D29" },
  failed:     { bg: "#FBE3E3", color: "#B43838" },
  review:     { bg: "#FAF1DD", color: "#9A5F0A" },
  ready:      { bg: "#E9F1EA", color: "#1E6D29" },
  draft:      { bg: "#F1F3F7", color: "#5E6779" },
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

/**
 * Map an order status → the pill's TONE. Every status
 * OrderStatusConstants can produce is listed, so `draft` is now genuinely the
 * unknown-status fallback rather than the bucket five real states fell into.
 *
 * Exported for src/test/statusVocabulary.test.ts, which walks every backend
 * status through it. `draft` reachable from a real status is the bug.
 */
export function recentStatusFromOrder(status: string): RecentStatus {
  switch (status) {
    case "delivered":                                  return "done";
    // Red. The last two are the additions: an order whose retries are spent, and
    // one the supplier read and refused, both used to fall through to the grey
    // "Draft" bucket — on the upload page, while every other screen named them.
    case "failed":
    case "transform_failed":
    case "delivery_failed":
    case "delivery_dead_letter":
    case "rejected_by_supplier":                       return "failed";
    case "pending_parse":
    case "parsing":
    case "transforming":
    case "delivering":                                 return "processing";
    // Amber — waiting on a human, not broken. `delivery_held` waits on billing
    // and `delivery_unconfirmed` waits on a call to the supplier, but from this
    // list's point of view all three are "somebody has to act".
    case "pending_review":
    case "unrouted":
    case "delivery_held":
    case "delivery_unconfirmed":                       return "review";
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
  const [uploadError, setUploadError] = useState<UploadErrorBanner | null>(null);
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
    // WP-36 · defect A — the failed supplier load printed a sentence and offered
    // no control at all, so the only escape from a disabled upload button was a
    // browser reload. refetch() is bound to a real Retry below.
    isFetching: suppliersFetching,
    refetch: refetchSuppliers,
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
          rawStatus: o.status,
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
        // WP-36 · defect B.2 + B.3 — this branch used to print `error.message`
        // verbatim under a fixed "Upload could not start." title with a fixed
        // "Review settings →" link. Two things were wrong: the message could be
        // a string the CLIENT wrote for developers ("Request timed out after
        // 60000ms"), and /settings is the honest destination for exactly one
        // cause (a plan refusal) out of the several that land here.
        setUploadError(describeUploadFailure(error, selectedFile.name));
      }
      setUploading(false);
      return;
    }

    // STRUCT-2: route straight to the Order Workshop (/inbox/{id}). The workshop is
    // now a strict superset of the old /upload/preview "Confirm item codes" step —
    // it carries the same issues list AND the same bulk-accept parity (Accept all /
    // ≥85%). The old preview route was retired once nothing routed to it; it now
    // 308s to this same path, keeping the order id.
    //
    // This push is the LAST statement of the successful branch and it is not
    // scheduled: it runs because the upload resolved with an order id, which is
    // the only outcome this screen has actually observed. It used to be a
    // setTimeout at PIPELINE_STAGES.length * STAGE_MS + 200, which meant the
    // operator was moved on at 2,000ms whatever the server was doing — and moved
    // on to a screen that had already shown them two completed steps. Whatever
    // the parse then does, the workshop reports it: still `parsing` → the polling
    // parse gate; `failed` → the full-page problem gate that says so.
    //
    // `uploading` is deliberately NOT cleared here. It stays true through the
    // navigation so the CTA cannot be pressed a second time against an order that
    // already exists; the component unmounts on route change.
    router.push(`/inbox/${encodeURIComponent(uploadedOrderId)}`);
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
      setFileError(unsupportedFileMessage(file));
      return;
    }
    // WP-36 · defect B.1 — refuse an over-size file HERE, where we still know
    // its name and its size, instead of letting it travel for a minute and come
    // back as a bare status line. Same cap the hero copy advertises.
    if (isOverSizeCap(file)) {
      setSelectedFile(null);
      setUploadError(null);
      setFileError(overSizeMessage(file));
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
    // Two refusal reasons now, kept apart so each file is refused for the reason
    // that is actually true of it (WP-36 · defects B.1 + C). An over-size XLSX is
    // not an unsupported format, and telling its owner to "try a different file
    // type" would send them looking for the wrong fix.
    const unsupported = files.filter((f) => !hasAcceptedUploadExtension(f.name));
    const oversized = files.filter((f) => hasAcceptedUploadExtension(f.name) && isOverSizeCap(f));
    const accepted = files.filter((f) => hasAcceptedUploadExtension(f.name) && !isOverSizeCap(f));
    if (accepted.length === 0) {
      setSelectedFile(null);
      setExtraFiles([]);
      setBatchResults([]);
      setUploadError(null);
      // One file in, one precise sentence out; several files in, every refused
      // one named. Neither case is allowed to be a bare count.
      setFileError(
        files.length === 1
          ? oversized.length === 1
            ? overSizeMessage(oversized[0])
            : unsupportedFileMessage(files[0])
          : refusedFilesMessage("We can't use", unsupported, oversized),
      );
      return;
    }
    if (accepted.length === 1) {
      // Single accepted file → the unchanged rich single-file path (detection pill etc.).
      acceptFile(accepted[0]);
      const skipped = refusedFilesMessage("Skipped", unsupported, oversized);
      if (skipped) setFileError(skipped);
      return;
    }
    setSelectedFile(accepted[0]);
    setExtraFiles(accepted.slice(1));
    setBatchResults([]);
    setUploadError(null);
    setDetection(null);
    setDetectionLoading(false);
    setFileError(refusedFilesMessage("Skipped", unsupported, oversized));
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
        // WP-36 · defect B.2 — the batch row had the same leak as the banner:
        // `error.message` verbatim, so one slow file printed "Request timed out
        // after 60000ms" in a list a purchasing coordinator reads. Same
        // classification, short form.
        const message = describeUploadFailure(error, file.name).title;
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

  // (There is no timer-cleanup effect here any more. It existed to clear the
  // stage/redirect setTimeouts on unmount; with nothing on this screen scheduled
  // against a clock there is nothing to cancel. The batch path's rate-limit
  // backoff is an awaited promise inside handleBatchUpload, not a stored handle.)

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
            We give you an example purchase order so you can run the whole flow — no file of
            your own needed, and it won&apos;t use your quota.
          </p>
          {sample.error && (
            <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>
              {sample.error.message}
            </p>
          )}
        </div>
        <div className="sm:flex-shrink-0">
          <PracticeOrderPrompt
            ctaLabel="Try with a sample order →"
            variant="button"
            pending={sample.isPending || uploading}
            onRun={(deliverTo) => { if (!uploading) sample.runSample(deliverTo); }}
            nounLower={labels.counterpartyNoun.toLowerCase()}
          />
        </div>
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
          : "linear-gradient(90deg, #297F34 0%, #1E6D29 100%)",
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
      {/* `pipeline-shimmer` was declared here too and is gone with the stage bars it
          animated — it had no other user in the repo. */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .upload-dropzone:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 3px; border-radius: 10px; }`}</style>

      {/* Page header — canonical PageHeader on the grey canvas (no white bar, no divider) */}
      <PageHeader
        title="Upload an order"
        sub={"Three steps: choose who it goes to, add the file(s), send for review. We parse and normalize any shape."}
      />

      {/* Body — wider centered column so the two-step card fills the desktop
          viewport instead of leaving large empty gutters. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[1040px] flex-col gap-4">

        {/* Phase 10.3 — Pilot Book-a-demo CTA */}
        {billing?.plan === "pilot" && (
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
              On Pilot? Get a guided walkthrough with the team — on your own sample order.
            </p>
            <a
              href={BOOK_DEMO_URL}
              {...BOOK_DEMO_LINK_ATTRS}
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
              Book a demo →
            </a>
          </div>
        )}

        {/* First-run org: lead with the zero-friction sample path. */}
        {isEmptyOrg && sampleCard}

        {/* ===== Intake card — one large dropzone is the hero; the route
            (which supplier) rides quietly on top, plan usage is demoted to a
            chip cluster, and the send action spans the footer. ===== */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E5E8EE",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Bridge edge — buyer-blue → supplier-green, the locked Bridge Layer signature. */}
          <div style={{ height: 3, background: "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)" }} />

          {/* ── Route bar · which supplier these orders are sent to (compact,
              quiet — the dropzone is the hero). Plan usage demoted to chips. ── */}
          {/* sm:flex-wrap: the picker claims 260–360px for real supplier names,
              so the usage-chip cluster is allowed to wrap to its own line on
              narrow desktop widths instead of squeezing the picker. */}
          <div
            className="flex flex-col gap-3 px-5 pt-4 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
            style={{ borderBottom: "1px solid #EEF0F4", background: "#FAFBFD" }}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
              <StepBadge n={1} tone="green" />
              <label htmlFor="upload-supplier" className="text-[12.5px] font-medium whitespace-nowrap" style={{ color: "#5E6779" }}>
                Send to
              </label>

              {suppliersLoading && (
                <span className="text-[12.5px]" style={{ color: "#5E6779" }}>
                  Loading {labels.counterpartyPlural.toLowerCase()}…
                </span>
              )}

              {/* WP-36 · defect A — this used to be the whole failure state: a
                  sentence saying "try again" with nothing to press. The picker
                  and the "Add a supplier" link are both gated off in this
                  branch, so hasSupplier stayed false, the send button stayed
                  grey, and the page then told the operator to choose a supplier
                  in a step that was no longer offering one. Retry re-runs the
                  same query and, on success, restores the picker in place. */}
              {suppliersError && !suppliersLoading && (
                <span className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "#7A4D0B" }}>
                  We couldn&apos;t load your {labels.counterpartyPlural.toLowerCase()}.
                  <button
                    type="button"
                    onClick={() => refetchSuppliers()}
                    disabled={suppliersFetching}
                    style={{
                      color: suppliersFetching ? "var(--ink-faint)" : "var(--brand-blue)",
                      background: "none",
                      border: "none",
                      cursor: suppliersFetching ? "default" : "pointer",
                      fontWeight: 600,
                      fontSize: 12,
                      padding: 0,
                      minHeight: 24,
                    }}
                  >
                    {suppliersFetching ? "Retrying…" : "Retry"}
                  </button>
                </span>
              )}

              {!suppliersLoading && !suppliersError && suppliers.length === 0 && (
                <span className="text-[12.5px]" style={{ color: "#5E6779" }}>
                  No {labels.counterpartyPlural.toLowerCase()} yet.{" "}
                  <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "#1E6D29" }}>
                    Add a {counterpartyNoun}
                  </Link>{" "}
                  to send orders to.
                </span>
              )}

              {!suppliersLoading && suppliers.length > 0 && (
                /* Sizing shell: full-width on mobile (wraps under the "Send to"
                   label); from sm it takes the route bar's spare space between
                   260–360px so real supplier names fit — the old narrow select
                   clipped anything longer than ~20 characters. */
                <div className="w-full min-w-0 sm:w-auto sm:min-w-[260px] sm:max-w-[360px] sm:flex-1">
                  <SupplierPicker
                    suppliers={suppliers}
                    value={supplierId}
                    onChange={setSupplierId}
                    counterpartyNoun={counterpartyNoun}
                    counterpartyPlural={labels.counterpartyPlural}
                  />
                </div>
              )}

              {hasSupplier && (
                <span className="hidden items-center gap-1.5 text-[11px] lg:inline-flex" style={{ color: "var(--ink-faint)" }}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <circle cx="7" cy="7" r="6" stroke="#CBD0DA" strokeWidth="1.2" />
                    <path d="M7 4.2v3.2l2 1.2" stroke="#99A1C5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Buyer fills in automatically once the document is parsed.
                </span>
              )}
            </div>

            {/* Plan usage — demoted to a quiet chip cluster (was a full left card). */}
            {billing && (
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "#5E6779" }}>
                <UsageChip
                  label={`${billing.plan} plan`}
                  tone={isReadOnly ? "amber" : "green"}
                  value={isReadOnly ? "Processing paused" : "Ready"}
                />
                <UsageChip label="Orders" value={usageValue(billing.ordersThisMonth, billing.orderLimit)} />
                <UsageChip label={labels.counterpartyPlural} value={usageValue(billing.suppliersUsed, billing.supplierLimit)} />
              </div>
            )}

            {billingLoading && !billing && (
              <span className="flex-shrink-0 text-[11.5px]" style={{ color: "#5E6779" }}>Checking plan limits…</span>
            )}

            {billingError && !billing && (
              <span className="flex-shrink-0 text-[11.5px]" style={{ color: "#7A4D0B" }}>Plan status unavailable</span>
            )}
          </div>

          {/* Read-only / trial-ended note (kept visible — it was in the left card). */}
          {billing && isReadOnly && (
            <div
              className="px-5 py-2.5 text-[11.5px] leading-5"
              style={{ background: "#FFF8EA", borderBottom: "1px solid #F0D39A", color: "#7A4D0B" }}
            >
              You can still view previous orders, but new order processing is paused until the plan is upgraded.
            </div>
          )}
          {billing && !isReadOnly && billing.trialEndsAt && billing.plan === "pilot" && (
            <div
              className="px-5 py-2 text-[11.5px]"
              style={{ background: "#FAFBFD", borderBottom: "1px solid #EEF0F4", color: "#5E6779" }}
            >
              Pilot ends {new Date(billing.trialEndsAt).toLocaleDateString()}.
            </div>
          )}
          {billingError && !billing && (
            <div
              className="px-5 py-2 text-[11.5px]"
              style={{ background: "#FFF8EA", borderBottom: "1px solid #F0D39A", color: "#7A4D0B" }}
            >
              Plan status is unavailable. Uploads may fail if the API cannot be reached.
            </div>
          )}

          {/* ── Step ② · the dropzone hero (full width) ── */}
          <div className="grid grid-cols-1">
            {/* ── Add file(s) ── */}
            <section className="flex flex-col gap-3 p-5">
              <StepHeading
                n={2}
                tone="blue"
                title="Add your order file(s)"
                hint="Drop one or more — each file becomes its own order"
              />

              {/* Drop zone — one large dashed-border hero, a labelled region (not a
                  button) so it can safely CONTAIN interactive controls (the help link
                  and the "Browse files" button). Keyboard users open the picker via the
                  inner ≥44px "Browse files" button; mouse users can also click the zone. */}
              <section
                aria-label="Upload area"
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
                className="upload-dropzone flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 sm:px-8 sm:py-14"
                style={{
                  border: `2px dashed ${dragReject ? "#B43838" : dragging ? "#1E66C9" : "#CBD0DA"}`,
                  borderRadius: 14,
                  background: dragReject ? "#FCEDED" : dragging ? "#EFF4FC" : "#F6F7FA",
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
                {/* Upload icon in a 60px tile — the tile fills buyer-blue on drag. */}
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center"
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 16,
                    background: dragging ? "#1E66C9" : dragReject ? "#FBE3E3" : "#F1F3F7",
                    transition: "background 0.15s",
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
                    <path
                      d="M11 14V4M11 4L7 8M11 4l4 4"
                      stroke={dragging ? "#FFFFFF" : dragReject ? "#B43838" : "#5E6779"}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
                      stroke={dragging ? "#FFFFFF" : dragReject ? "#B43838" : "#5E6779"}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>

                <div className="text-center" style={{ minWidth: 0, maxWidth: "100%" }}>
                  <p
                    className="text-[21px] font-bold tracking-[-0.01em] break-words"
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
                  <p className="text-[13px] mt-2" style={{ color: dragReject ? "#B43838" : "#5E6779" }}>
                    {dragReject
                      ? `We accept ${ACCEPTED_UPLOAD_FORMATS.humanList}`
                      : isMulti
                      ? "One order will be created per file"
                      : selectedFile
                      ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB ready to send`
                      : "Each file becomes its own order — drag in, or browse below"}
                  </p>
                </div>

                {/* Accepted-format chips + size cap (only in the empty hero state). */}
                {!selectedFile && !isMulti && !dragReject && (
                  <>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {(["CSV", "XLSX", "PDF", "XML", "cXML", "UBL", "EDI"] as const).map((f) => (
                        <FileChip key={f} type={f} />
                      ))}
                    </div>
                    <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      {/* The cap is read from MAX_UPLOAD_BYTES, the same constant
                          the pre-flight check enforces — this promise cannot
                          drift away from what the page actually accepts. */}
                      cXML · UBL · Peppol · EDIFACT · X12 — up to {MAX_UPLOAD_LABEL} each
                    </p>
                    {/* Quiet help link — stopPropagation so it doesn't trigger the dropzone picker. */}
                    <Link
                      href="/help/csv-xlsx-field-guide"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px]"
                      style={{ color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 2 }}
                    >
                      Need help? See the file format guide →
                    </Link>
                  </>
                )}

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
              </section>

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
                          <span className="shrink-0 text-[11px]" style={{ color: "#8A5310" }} title="Pacing uploads to stay within the per-minute limit — this file retries automatically.">
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
                        style={{ fontWeight: 600, color: "#8A5310", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: 0 }}
                      >
                        {uploadError.cta}
                      </button>
                    );
                  }
                  // WP-36 · defect B.3 — the cause decides the destination.
                  // `href` comes from describeUploadFailure (the classified
                  // causes); the table below still serves the two banners raised
                  // before any request left the browser.
                  const ctaHref =
                    uploadError.href ??
                    (uploadError.code === "supplier_required" ? "/library/suppliers" : "/settings?tab=billing");
                  return (
                    <span className="flex flex-shrink-0 flex-wrap items-center gap-3">
                      {/* When the same request could plausibly work, re-sending
                          it IS the primary action — no navigation can do it, and
                          the selection is still in hand. */}
                      {uploadError.canRetry && (
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => { if (isMulti) handleBatchUpload(allSelectedFiles); else handleUpload(); }}
                          style={{
                            fontWeight: 600,
                            fontSize: 12.5,
                            color: "#FFFFFF",
                            background: uploading ? "#C9A96B" : "#8A5310",
                            border: "none",
                            borderRadius: 6,
                            padding: "7px 12px",
                            minHeight: 34,
                            cursor: uploading ? "default" : "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {uploading ? "Sending…" : "Try again"}
                        </button>
                      )}
                      <a
                        href={ctaHref}
                        style={{ fontWeight: 600, color: "#8A5310", textDecoration: "none", whiteSpace: "nowrap" }}
                      >
                        {uploadError.cta} →
                      </a>
                    </span>
                  );
                })()}
              </div>
            )}

            <div className="flex items-center gap-3">
              <StepBadge n={3} tone="green" />
              <div className="min-w-0 flex-1">{primaryCta}</div>
            </div>

            {/* Honest gating hint — the CTA is disabled until a supplier is chosen.
                WP-36 · defect A — this line used to print unconditionally, so a
                failed supplier load produced two messages that contradicted each
                other: step 1 said the list could not be loaded, and step 3 told
                the operator to choose from it. Each reason now says the true one
                and points at the action that actually exists. */}
            {selectedCount > 0 && !hasSupplier && !suppliersLoading && (
              <p className="flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "#9A5F0A", margin: 0 }}>
                {suppliersError ? (
                  <>
                    We couldn&apos;t load your {labels.counterpartyPlural.toLowerCase()}, so we don&apos;t know
                    where to send this file yet.
                    <button
                      type="button"
                      onClick={() => refetchSuppliers()}
                      disabled={suppliersFetching}
                      style={{
                        color: suppliersFetching ? "var(--ink-faint)" : "var(--brand-blue)",
                        background: "none",
                        border: "none",
                        cursor: suppliersFetching ? "default" : "pointer",
                        fontWeight: 600,
                        fontSize: 11.5,
                        padding: 0,
                        minHeight: 24,
                      }}
                    >
                      {suppliersFetching ? "Retrying…" : "Retry"}
                    </button>
                  </>
                ) : suppliers.length === 0 ? (
                  <>
                    Add a {counterpartyNoun} first — we need to know who this order goes to.
                    <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "#1E6D29" }}>
                      Add a {counterpartyNoun}
                    </Link>
                  </>
                ) : (
                  <>Choose a {counterpartyNoun} in step 1 to enable the upload.</>
                )}
              </p>
            )}

            {/* Upload in flight (single-file path) — the ONE thing this screen has
                observed and can therefore state.

                Indeterminate on purpose. Nothing here measures a fraction or an
                elapsed-to-go, so nothing here prints one: an invented number is the
                difference between an operator waiting and escalating on the wrong
                schedule (the standing rule, written down at
                problem/problemCopy.ts:380-382). There is no step that turns green,
                because no step on this screen has a server behind it — the steps
                that do are on the order screen this is about to open.

                The sentence names what happens NEXT rather than claiming it has
                happened, so arriving at <ParsingGate> is the promise being kept
                instead of a contradiction of two ticked boxes. */}
            {uploading && !isMulti && (
              <div
                data-testid="upload-in-flight"
                data-upload-state="uploading"
                role="status"
                aria-live="polite"
                style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    display: "inline-block",
                    width: 11,
                    height: 11,
                    border: "1.5px solid #CBD0DA",
                    borderTopColor: "#1E6D29",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                <p className="text-[11.5px]" style={{ margin: 0, color: "var(--ink-muted)" }}>
                  <span style={{ fontWeight: 600, color: "#0B1A2F" }}>
                    Uploading {selectedFile?.name ?? "your file"}…
                  </span>{" "}
                  We&apos;ll open the order as soon as it arrives. Reading the document happens
                  there, and that screen shows how far it has got.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ===== More ways to bring orders in — the quiet secondary intake rail.
            Present, never in a first-timer's way. Honest per FABLE5 §6: email +
            API are live (real backend + settings tabs); SFTP / S3 pull are marked
            "Assisted setup" because they still need a human setup step. ===== */}
        <MoreWaysToIngest />

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
                        {statusLabel(row.rawStatus)}
                      </span>
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <FileChip type={row.fmt} />
                      <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                        {row.size === "—" ? row.age : `${row.size} · ${row.age}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12px]">
                      {/* #1E6D29 not #2E8E3A: buyer name is 12px TEXT on
                          var(--surface) (#FFFFFF) — 4.1613:1 with green,
                          6.4128:1 with green-deep. The hairline below keeps the
                          green→green-deep gradient; it is non-text. */}
                      <span className="truncate" style={{ color: "#1E6D29" }}>
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
                          {/* #1E6D29 not #2E8E3A: buyer name is 12px TEXT. Rows
                              are transparent over the white XCard — 4.1613:1
                              with green, 6.4128:1 with green-deep; on the
                              #F6F7FA hover row, 3.8846:1 → 5.9863:1. */}
                          <span
                            className="text-[12px]"
                            style={{ color: "#1E6D29" }}
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
                            {statusLabel(row.rawStatus)}
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

/** "13 / 100k" style usage value, collapsing an effectively-unlimited cap to "Custom". */
function usageValue(used: number, limit: number): string {
  const unlimited = limit >= 2_000_000_000;
  return `${used} / ${unlimited ? "Custom" : limit}`;
}

/**
 * UsageChip — the quiet plan-usage chip shown in the route bar. Replaces the
 * heavy full-width usage card; keeps the same numbers just demoted. `tone`
 * green/amber colors the readiness chip; unset = neutral count chip.
 */
function UsageChip({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  const toneStyle =
    tone === "green"
      ? { background: "#E9F1EA", border: "1px solid #D8EBDA", color: "#1E6D29" }
      : tone === "amber"
      ? { background: "#FAF1DD", border: "1px solid #F0D39A", color: "#9A5F0A" }
      : { background: "#F1F3F7", border: "1px solid #E5E8EE", color: "#5E6779" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11.5px] capitalize"
      style={toneStyle}
    >
      <span>{label}</span>
      <b
        className="font-semibold"
        style={{ color: tone ? undefined : "#0B1A2F", fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </b>
    </span>
  );
}

/**
 * MoreWaysToIngest — the "More ways to bring orders in" rail. A quiet secondary
 * intake surface listing the automated channels that exist alongside browser
 * upload. Each links to the real settings tab that configures it.
 *
 * Truthfulness (FABLE5 §6): email intake + the REST ingress API are live and
 * self-serve, so they carry a plain "Set up →" affordance. SFTP and S3/R2 pull
 * still need a human setup step, so they are honestly badged "Assisted setup" —
 * we never imply a pure one-click self-serve toggle for them.
 */
function MoreWaysToIngest() {
  const channels: {
    key: string;
    title: string;
    desc: string;
    href: string;
    assisted?: boolean;
    icon: React.ReactNode;
  }[] = [
    {
      key: "email",
      title: "Email intake",
      desc: "Forward orders to a private inbox — attachments are parsed automatically.",
      href: "/settings?tab=email",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" stroke="#1E66C9" strokeWidth="1.4" />
          <path d="M3 5.5l7 5 7-5" stroke="#1E66C9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: "api",
      // "REST API", not "REST API & webhooks": this is a list of ways orders
      // come IN, and there is no webhook you can point at us. Webhooks go the
      // other way — we call your URL when something happens to an order.
      title: "REST API",
      desc: "Push orders straight from your ERP, Zapier, or Make with an API key.",
      href: "/settings?tab=api",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M7 5L3 10l4 5M13 5l4 5-4 5" stroke="#1E6D29" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: "sftp",
      title: "SFTP pull",
      desc: "We poll an SFTP folder on a schedule and import new order files.",
      href: "/settings?tab=sftp",
      assisted: true,
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="11" width="14" height="6" rx="1.5" stroke="#5E6779" strokeWidth="1.4" />
          <path d="M10 3v6M7.5 6.5L10 9l2.5-2.5" stroke="#5E6779" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: "s3",
      title: "S3 / R2 pull",
      desc: "Point us at an object-storage bucket and we import new objects.",
      href: "/settings?tab=s3",
      assisted: true,
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <ellipse cx="10" cy="5" rx="6" ry="2.2" stroke="#5E6779" strokeWidth="1.4" />
          <path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5" stroke="#5E6779" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <section
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E8EE",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
        overflow: "hidden",
      }}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-1">
        <h2
          className="text-[14px] font-semibold"
          style={{ color: "#0B1A2F", margin: 0, fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}
        >
          More ways to bring orders in
        </h2>
        <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
          Automate intake once you&apos;re past the first order
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px px-5 pb-5 pt-2 sm:grid-cols-2" style={{ background: "transparent" }}>
        {channels.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="group flex items-start gap-3 rounded-[10px] px-3.5 py-3 transition-colors"
            style={{ border: "1px solid #EEF0F4", background: "#FAFBFD", margin: 3 }}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex flex-shrink-0 items-center justify-center"
              style={{ width: 34, height: 34, borderRadius: 9, background: "#FFFFFF", border: "1px solid #E5E8EE" }}
            >
              {c.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                  {c.title}
                </span>
                {c.assisted && (
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: "#FAF1DD", color: "#9A5F0A" }}
                    title="Needs a one-time setup step with the team — not a pure one-click toggle."
                  >
                    Assisted setup
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.4]" style={{ color: "#5E6779" }}>
                {c.desc}
              </span>
              <span
                className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold"
                style={{ color: c.assisted ? "#9A5F0A" : "#1E6D29" }}
              >
                {c.assisted ? "Set up with us" : "Set up"} →
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
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

/**
 * The API's OWN sentence, or "" when it never wrote one.
 *
 * Read from the response BODY only, deliberately. realUploadPurchaseOrder falls
 * back to `res.statusText` when the body is empty and prefixes everything with
 * "Upload failed: " — both are client-side constructions around an HTTP status
 * line, not copy anyone wrote for an operator, so neither may reach the banner.
 * What the backend did write for humans (the unsupported-format 400, the plan
 * gate codes) is passed through untouched: WP-36 forbids paraphrasing it.
 */
function serverAuthoredMessage(error: unknown): string {
  if (!(error instanceof ApiHttpError)) return "";
  const body = error.body;
  // `body` is the RAW response, and only `message` is cleaned by the ApiHttpError constructor —
  // this function deliberately reads the body instead, so it needs its own door. A 4xx answered
  // `text/html` by an edge proxy or WAF arrives here as a whole page and lands in the banner.
  // See src/lib/serverText.ts.
  if (typeof body === "string" && body.trim()) return serverReasonOrNull(body) ?? "";
  if (body && typeof body === "object" && "error" in body) {
    const text = serverReasonOrNull(String((body as { error?: unknown }).error));
    if (text) return text;
  }
  return "";
}

/**
 * WP-36 · defect B — what a failed upload MEANS, and the next step that works.
 *
 * Before: every non-429 failure produced the same banner — title "Upload could
 * not start.", body `error.message` verbatim, one link "Review settings →" to
 * /settings. That is right for a plan refusal and wrong for everything else:
 * a dropped connection, a slow answer, an expired session, a file the parser
 * refused. None of those are fixed in settings, and for the first three the
 * action that fixes them (send the same file again) was not offered at all.
 *
 * The classification is reused, not rewritten: classifyApiFailure already knows
 * which failures clear on their own, and planGate already turns a gate code into
 * a sentence plus the upgrade route the SERVER named. Only the words and the
 * secondary destination are chosen here.
 */
/** Exported for src/components/bridge/uploadFailureCopy.test.ts — the banner is pure, so it is
 *  tested without mounting the workbench, the same way catalogSourceHelpers is. */
export function describeUploadFailure(error: unknown, fileName: string): UploadErrorBanner {
  // The one string the CLIENT authored that used to reach this banner:
  // fetchWithTimeout re-throws a plain Error reading "Request timed out after
  // 60000ms", and a purchasing coordinator was shown it verbatim. isRequestTimeout
  // is the same test lib/apiFailure uses, so the two cannot disagree.
  if (isRequestTimeout(error)) {
    return {
      code: "upload_timeout",
      title: "Sending took too long.",
      message: `We didn't hear back while sending ${fileName}, so nothing was uploaded. Try again — a large file on a slow connection often needs a second run.`,
      canRetry: true,
      cta: "Read the fixes",
      href: "/help/troubleshooting",
    };
  }

  const failure = classifyApiFailure(error);
  const serverText = serverAuthoredMessage(error);

  // The server's own size ceiling. The pre-flight check catches the advertised
  // cap, so this only fires when the server's limit is the lower of the two —
  // and the operator still gets a size answer instead of a status line.
  if (failure.status === 413) {
    return {
      code: "upload_too_large",
      title: "That file is too big to send.",
      message: `${fileName} was refused for its size. Split it into smaller files, or send fewer order lines at a time.`,
      cta: "How to split a file",
      href: "/help/guides/upload-orders-manually",
    };
  }

  switch (failure.kind) {
    case "unreachable":
      return {
        code: "upload_unreachable",
        title: "We couldn't reach ProcuLink.",
        message: `${fileName} was not uploaded. Check you're still online, then send it again.`,
        canRetry: true,
        cta: "Read the fixes",
        href: "/help/troubleshooting",
      };
    case "auth_expired":
      return {
        code: "upload_signed_out",
        title: "You've been signed out.",
        message: `${fileName} was not uploaded. Sign in again and send it once more.`,
        cta: "Sign in",
        href: "/sign-in",
      };
    case "plan_gate":
      // The only cause for which "Review settings" was ever the right answer —
      // and the plan named is the server's, never a hardcoded guess.
      return {
        code: "upload_plan_gate",
        title: "Your plan doesn't include this yet.",
        message: planGateMessage(serverText || (error instanceof Error ? error.message : "")),
        cta: "Upgrade plan",
        href: planGateUpgradeUrl(
          error instanceof ApiHttpError && error.body ? error.body : serverText,
        ),
      };
    case "forbidden":
      return {
        code: "upload_forbidden",
        title: "You can't upload to this workspace.",
        message:
          serverText ||
          "Ask an owner of this workspace to give you upload access, then send the file again.",
        cta: "Open settings",
        href: "/settings",
      };
    case "server":
      return {
        code: "upload_server",
        title: "We couldn't take the file just now.",
        message: `${fileName} was not uploaded. The problem is on our side — try again in a moment.`,
        canRetry: true,
        cta: "Read the fixes",
        href: "/help/troubleshooting",
      };
    default:
      // A refusal the API answered with a sentence of its own — the
      // unsupported-format 400 is the common one. Show THAT sentence, never a
      // paraphrase of it, and point at the guide that answers it. No retry:
      // sending the identical file again gets the identical refusal.
      return {
        code: "upload_rejected",
        title: "We couldn't accept that file.",
        message:
          serverText ||
          `${fileName} wasn't accepted. Check it opens on your computer, then try a fresh copy of the file.`,
        cta: "See the file guide",
        href: "/help/csv-xlsx-field-guide",
      };
  }
}

function getLimitMessage(code: string): UploadErrorBanner {
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
