"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Artifact, Order, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";
import { ResolveSection } from "@/components/orders/ResolveSection";
import { AuditTimeline } from "@/components/orders/AuditTimeline";
import { SpineReviewSkeleton } from "@/components/bridge/Skeletons";
import { BridgeLoader } from "@/components/bridge/BridgeLoader";
import { useToast } from "@/hooks/use-toast";

/** Statuses where the backend is still working — poll until they change. */
const POLLING_STATUSES: OrderStatus[] = ["parsing", "transforming"];

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  navy:        "#0B1A2F",
  bg:          "#F6F7FA",
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E2E6EE",
  borderFaint: "#EEF0F4",
  borderStrong:"#CBD0DA",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  amber:       "#C97A14",
  amberSoft:   "#FAEFD6",
  danger:      "#C53A3A",
  blue:        "#1E66C9",
  green:       "#2E8E3A",
  violet:      "#6F4FCE",
  mono:        '"JetBrains Mono", ui-monospace, monospace',
  display:     '"Bricolage Grotesque", "Inter", system-ui, sans-serif',
  ui:          '"Inter", system-ui, sans-serif',
};

// ─── Status stage map ─────────────────────────────────────────────────────────

const STATUS_STAGE: Record<string, { label: string; stage: number }> = {
  parsing:          { label: "Parsing",          stage: 2 },
  pending_review:   { label: "Validating",        stage: 3 },
  ready:            { label: "Ready",             stage: 4 },
  transforming:     { label: "Transforming",      stage: 4 },
  ready_to_deliver: { label: "Ready to deliver",  stage: 4 },
  delivered:        { label: "Delivered",         stage: 5 },
  failed:           { label: "Failed",            stage: 0 },
  transform_failed: { label: "Transform failed",  stage: 0 },
  delivery_failed:  { label: "Delivery failed",   stage: 0 },
};

// ─── Source format chip (same palette as OrdersPage) ─────────────────────────

const SRC_META: Record<string, { bg: string; color: string; label: string }> = {
  pdf:   { bg: "#FEE2E2", color: "#B91C1C", label: "PDF"   },
  csv:   { bg: "#DBEAFE", color: "#1D4ED8", label: "CSV"   },
  xlsx:  { bg: "#DCFCE7", color: "#15803D", label: "XLSX"  },
  cxml:  { bg: "#CCFBF1", color: "#0F766E", label: "cXML"  },
  edi:   { bg: "#FEF3C7", color: "#B45309", label: "EDI"   },
  email: { bg: "#EDE9FE", color: "#7C3AED", label: "EMAIL" },
};

function SrcChip({ format }: { format: string | null | undefined }) {
  if (!format) return null;
  const meta = SRC_META[format.toLowerCase()] ?? { bg: T.surface2, color: T.inkFaint, label: format.toUpperCase() };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      height: 18, padding: "0 6px", borderRadius: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      background: meta.bg, color: meta.color, flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

function deriveSourceFormat(fileKey: string | null | undefined): string | null {
  if (!fileKey) return null;
  const ext = fileKey.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf")  return "pdf";
  if (ext === "csv")  return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "xml"  || ext === "cxml") return "cxml";
  if (ext === "edi"  || ext === "x12") return "edi";
  return null;
}

function deriveSourceFilename(fileKey: string | null | undefined): string {
  if (!fileKey) return "—";
  return fileKey.split("/").pop() ?? fileKey;
}

// ─── Small components ─────────────────────────────────────────────────────────

function Panel({
  title,
  meta,
  children,
  noPad = false,
}: {
  title?: string;
  meta?: string;
  children: React.ReactNode;
  noPad?: boolean;
}) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      {title && (
        <div style={{
          padding: "10px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, fontFamily: T.ui }}>{title}</span>
          {meta && <span style={{ fontSize: 12, color: T.inkFaint, fontFamily: T.ui }}>{meta}</span>}
        </div>
      )}
      <div style={noPad ? undefined : { padding: "14px 20px" }}>{children}</div>
    </div>
  );
}

// ─── MetaStrip ────────────────────────────────────────────────────────────────

function MetaStrip({ order }: { order: Order }) {
  const totalValue = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(v);

  const sourceFmt  = deriveSourceFormat(order.sourceFileKey);
  const sourceFile = deriveSourceFilename(order.sourceFileKey);

  const stageInfo = STATUS_STAGE[order.status] ?? { label: order.status, stage: 0 };
  const stageText = stageInfo.stage > 0
    ? `${stageInfo.label} · ${stageInfo.stage} of 5`
    : stageInfo.label;

  const cells = [
    {
      label: "Source",
      value: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <SrcChip format={sourceFmt} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.ink, wordBreak: "break-all" }}>
            {sourceFile}
          </span>
        </div>
      ),
    },
    {
      label: "Lines",
      value: (
        <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.ink }}>
          {order.lines.length}
        </span>
      ),
    },
    {
      label: "Total",
      value: (
        <span style={{ fontFamily: T.display, fontSize: 17, fontWeight: 600, color: T.ink, letterSpacing: "-0.015em" }}>
          {fmtCurrency(totalValue)}
        </span>
      ),
    },
    {
      label: "Currency",
      value: (
        <span style={{ fontFamily: T.mono, fontSize: 13, color: T.ink }}>
          {order.currency}
        </span>
      ),
    },
    {
      label: "Status",
      value: (
        <span style={{ fontSize: 12.5, color: T.inkMuted, fontFamily: T.ui }}>
          {stageText}
        </span>
      ),
    },
  ];

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      padding: "16px 22px",
      marginBottom: 18,
      display: "grid",
      gridTemplateColumns: "1.5fr 0.6fr 0.9fr 0.6fr 1.2fr",
      gap: 0,
    }}>
      {cells.map((c, i) => (
        <div
          key={i}
          style={{
            borderLeft: i > 0 ? `1px solid ${T.border}` : "none",
            paddingLeft: i > 0 ? 24 : 0,
          }}
        >
          <div style={{
            fontSize: 10.5, color: T.inkFaint,
            textTransform: "uppercase", letterSpacing: "0.08em",
            fontWeight: 500, marginBottom: 8, fontFamily: T.ui,
          }}>
            {c.label}
          </div>
          <div>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Line Items Table ─────────────────────────────────────────────────────────

function LineItemsPanel({ order }: { order: Order }) {
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(v);
  const totalValue = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const unresolvedCount = order.lines.filter(l => l.needsReview).length;

  const thStyle: React.CSSProperties = {
    padding: "9px 0",
    fontSize: 10.5, fontWeight: 500,
    color: T.inkFaint,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: T.ui,
    border: 0,
    background: "transparent",
  };

  return (
    <Panel
      title="Line Items"
      meta={`${order.lines.length} item${order.lines.length !== 1 ? "s" : ""}${unresolvedCount > 0 ? ` · ${unresolvedCount} unresolved` : ""}`}
      noPad
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th style={{ ...thStyle, padding: "9px 0 9px 20px", width: 40, textAlign: "right" }}>#</th>
              <th style={{ ...thStyle, padding: "9px 16px" }}>Buyer SKU</th>
              <th style={{ ...thStyle, padding: "9px 16px" }}>Supplier code</th>
              <th style={{ ...thStyle, padding: "9px 16px" }}>Description</th>
              <th style={{ ...thStyle, padding: "9px 16px", textAlign: "right" }}>Qty</th>
              <th style={{ ...thStyle, padding: "9px 16px", textAlign: "right" }}>Unit price</th>
              <th style={{ ...thStyle, padding: "9px 20px 9px 16px", textAlign: "right" }}>Line total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map(line => (
              <tr
                key={line.id}
                className="table-row-tr"
                style={{ borderTop: `1px solid ${T.borderFaint}` }}
                onMouseEnter={e => (e.currentTarget.style.background = T.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "12px 0 12px 20px", textAlign: "right", fontFamily: T.mono, fontSize: 12, color: T.inkFaint }}>
                  {line.lineNumber}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink }}>{line.buyerItemCode}</span>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  {line.supplierItemCode ? (
                    <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.green }}>{line.supplierItemCode}</span>
                  ) : line.needsReview ? (
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: T.amber,
                      background: T.amberSoft, border: `1px solid ${T.amber}30`,
                      borderRadius: 4, padding: "2px 6px",
                    }}>
                      Needs review
                    </span>
                  ) : (
                    <span style={{ color: T.inkFaint }}>—</span>
                  )}
                </td>
                <td style={{ padding: "12px 16px", maxWidth: 260 }}>
                  <span style={{
                    fontSize: 12.5, color: T.inkMuted,
                    display: "block", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {line.description ?? "—"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink }}>
                    {line.quantity.toLocaleString()}
                    {line.unit && <span style={{ fontSize: 11, color: T.inkFaint, marginLeft: 4 }}>{line.unit}</span>}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink }}>{fmt(line.unitPrice)}</span>
                </td>
                <td style={{ padding: "12px 20px 12px 16px", textAlign: "right" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 500, color: T.ink }}>
                    {fmt(line.quantity * line.unitPrice)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${T.border}`, background: T.surface2 }}>
              <td colSpan={6} style={{ padding: "11px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: T.inkMuted, fontFamily: T.ui }}>
                Total
              </td>
              <td style={{ padding: "11px 20px 11px 16px", textAlign: "right" }}>
                <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.ink }}>
                  {fmt(totalValue)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

// ─── Generated Files Panel ────────────────────────────────────────────────────

function GeneratedFilesPanel({
  artifacts,
  onDownload,
}: {
  artifacts: Artifact[];
  onDownload: (id: string) => void;
}) {
  const fmtDt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <Panel title="Generated Files">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {artifacts.map(artifact => (
          <div
            key={artifact.id}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px", borderRadius: 7,
              border: `1px solid ${T.border}`, background: T.bg,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.inkFaint} strokeWidth="1.5">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, margin: 0 }}>
                  {artifact.format.toUpperCase()} Export
                </p>
                <p style={{ fontSize: 11.5, color: T.inkFaint, margin: 0 }}>
                  {fmtDt(artifact.createdAt)}
                </p>
              </div>
            </div>
            <button
              onClick={() => onDownload(artifact.id)}
              className="btn-ghost"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${T.border}`, background: T.surface,
                fontSize: 12, fontWeight: 600, color: T.ink, cursor: "pointer",
                fontFamily: T.ui,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 7l3 3 3-3M2 12v1.5h12V12" stroke={T.inkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Download
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Counterparties Panel ─────────────────────────────────────────────────────

function CounterpartiesPanel({ order }: { order: Order }) {
  return (
    <Panel title="Counterparties">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {order.buyerName && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: T.blue, flexShrink: 0, marginTop: 4,
            }} />
            <div>
              <div style={{
                fontSize: 10.5, color: T.inkFaint,
                textTransform: "uppercase", letterSpacing: "0.06em",
                fontWeight: 500, marginBottom: 2, fontFamily: T.ui,
              }}>
                Buyer
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.ink }}>
                {order.buyerName}
              </div>
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: T.green, flexShrink: 0, marginTop: 4,
          }} />
          <div>
            <div style={{
              fontSize: 10.5, color: T.inkFaint,
              textTransform: "uppercase", letterSpacing: "0.06em",
              fontWeight: 500, marginBottom: 2, fontFamily: T.ui,
            }}>
              Supplier
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.ink }}>
              {order.supplierName}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── Details Panel ────────────────────────────────────────────────────────────

function DetailsPanel({ order }: { order: Order }) {
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  const fmtDt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  const pairs: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Order ID",
      value: (
        <code style={{
          fontFamily: T.mono, fontSize: 11,
          background: "#F0F2F6", padding: "2px 5px",
          borderRadius: 3, wordBreak: "break-all",
        }}>
          {order.id}
        </code>
      ),
    },
    { label: "Order Date", value: fmtDate(order.orderDate) },
    { label: "Currency",   value: order.currency },
    { label: "Created",    value: fmtDt(order.createdAt) },
    ...(order.updatedAt !== order.createdAt
      ? [{ label: "Updated", value: fmtDt(order.updatedAt) }]
      : []
    ),
  ];

  return (
    <Panel title="Details">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pairs.map((p, i) => (
          <div key={i}>
            <div style={{
              fontSize: 10.5, color: T.inkFaint,
              textTransform: "uppercase", letterSpacing: "0.07em",
              fontWeight: 600, marginBottom: 3, fontFamily: T.ui,
            }}>
              {p.label}
            </div>
            <div style={{ fontSize: 13, color: T.ink }}>{p.value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params      = useParams();
  const id          = params?.id as string | undefined;
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const {
    data: order,
    isLoading,
    isError,
  } = useQuery<Order | null>({
    queryKey: ["order", id],
    queryFn:  () => apiClient.getOrderById(id!),
    enabled:  !!id,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status as OrderStatus | undefined;
      return status && POLLING_STATUSES.includes(status) ? 2_000 : false;
    },
  });

  const handleOrderUpdated = (_updated: Order) => {
    queryClient.invalidateQueries({ queryKey: ["order", id] });
  };

  const handleTransform = async (format: "xml" | "csv") => {
    if (!order) return;
    try {
      await apiClient.transformOrder(order.id, format);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
    } catch (err) {
      toast({
        title: "Transform failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async (artifactId: string) => {
    if (!order) return;
    try {
      const { url } = await apiClient.getDownloadUrl(order.id, artifactId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const fmtDt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return <SpineReviewSkeleton />;

  // ── Not found / error ──────────────────────────────────────────────────────
  if (isError || !order) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "100%", gap: 10, background: T.bg,
        fontFamily: T.ui,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11, background: T.surface2,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.inkFaint} strokeWidth="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>Order Not Found</span>
        <span style={{ fontSize: 12.5, color: T.inkFaint }}>
          This purchase order doesn&apos;t exist or was removed.
        </span>
        <Link
          href="/orders"
          style={{
            marginTop: 8, padding: "7px 14px", borderRadius: 7,
            background: T.navy, color: "#FFFFFF",
            fontSize: 12.5, fontWeight: 700, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          Back to Orders
        </Link>
      </div>
    );
  }

  const isProcessing    = (POLLING_STATUSES as string[]).includes(order.status);
  const unresolvedCount = order.lines.filter(l => l.needsReview).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.bg, fontFamily: T.ui }}>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ padding: "0 32px 48px" }}>

          {/* ── Order header ───────────────────────────────────────────────── */}
          <div style={{ paddingTop: 28, paddingBottom: 22 }}>

            {/* Back link */}
            <Link
              href="/orders"
              className="back-link"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: "transparent", padding: "0 0 18px",
                color: T.inkMuted, fontSize: 12, fontWeight: 500,
                textDecoration: "none",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke={T.inkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to orders
            </Link>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
              {/* Title + subtitle */}
              <div style={{ flex: "1 1 360px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <h1 style={{
                    margin: 0,
                    fontFamily: T.display,
                    fontSize: 30, fontWeight: 600,
                    color: T.ink, letterSpacing: "-0.022em",
                    lineHeight: 1.1,
                  }}>
                    {order.poNumber}
                  </h1>
                  <StatusBadge status={order.status} />
                </div>
                <div style={{ fontSize: 12.5, color: T.inkMuted }}>
                  {order.buyerName && (
                    <>
                      <span style={{ color: T.ink, fontWeight: 500 }}>{order.buyerName}</span>
                      <span style={{ margin: "0 8px" }}>→</span>
                    </>
                  )}
                  <span style={{ color: T.ink, fontWeight: 500 }}>{order.supplierName}</span>
                  <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                  Created {fmtDt(order.createdAt)}
                  {order.updatedAt !== order.createdAt && (
                    <>
                      <span style={{ margin: "0 8px", color: T.borderStrong }}>·</span>
                      Updated {fmtDt(order.updatedAt)}
                    </>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {order.sourceFileKey && (
                  <button
                    onClick={() => handleDownload(order.artifacts[0]?.id ?? "")}
                    className="btn-ghost"
                    style={{
                      height: 34, padding: "0 14px", borderRadius: 7,
                      background: "transparent", border: `1px solid ${T.border}`,
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12.5, fontWeight: 500, color: T.inkMuted,
                      cursor: "pointer", fontFamily: T.ui,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M9 2H5a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V7l-4-5z" stroke={T.inkFaint} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M9 2v4h4" stroke={T.inkFaint} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    View source
                  </button>
                )}
                <button
                  className="btn-ghost"
                  style={{
                    height: 34, padding: "0 14px", borderRadius: 7,
                    background: "transparent", border: `1px solid ${T.border}`,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: 12.5, fontWeight: 500, color: T.inkMuted,
                    cursor: "not-allowed", fontFamily: T.ui,
                    opacity: 0.5,
                  }}
                  disabled
                >
                  Save draft
                </button>
                <button
                  onClick={() => order.status === "ready" ? handleTransform("xml") : undefined}
                  disabled={order.status !== "ready" || isProcessing}
                  className="btn-primary"
                  style={{
                    height: 34, padding: "0 16px", borderRadius: 7,
                    background: T.navy,
                    border: `1px solid ${T.navy}`,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: 12.5, fontWeight: 600,
                    color: "#fff",
                    cursor: order.status === "ready" ? "pointer" : "not-allowed",
                    fontFamily: T.ui,
                    opacity: order.status === "ready" ? 1 : 0.45,
                  }}
                >
                  Cross the bridge
                </button>
              </div>
            </div>
          </div>

          {/* ── Processing banner ───────────────────────────────────────────── */}
          {isProcessing && (
            <div style={{
              marginBottom: 18,
              padding: "10px 14px",
              borderRadius: 8,
              background: "#EEF5FF",
              border: "1px solid #C3D9FF",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <BridgeLoader size={20} fullScreen={false} />
              <span style={{ fontSize: 13, color: "#1E4FA8" }}>
                {order.status === "parsing"
                  ? "Parsing file… this usually takes a few seconds."
                  : "Transforming order… generating output file."}
              </span>
            </div>
          )}

          {/* ── Unresolved banner ───────────────────────────────────────────── */}
          {!isProcessing && unresolvedCount > 0 && (
            <div style={{
              marginBottom: 18,
              padding: "10px 14px",
              borderRadius: 8,
              background: T.amberSoft,
              border: `1px solid ${T.amber}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={T.amber} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke={T.amber} strokeWidth="2" strokeLinecap="round"/>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke={T.amber} strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 13, color: "#7A4A0A" }}>
                <strong>{unresolvedCount} line{unresolvedCount !== 1 ? "s" : ""}</strong>{" "}
                still need supplier item codes before this order can be transformed.
              </span>
            </div>
          )}

          {/* ── MetaStrip ───────────────────────────────────────────────────── */}
          {!isProcessing && <MetaStrip order={order} />}

          {/* ── Content grid ────────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, alignItems: "start" }}>

            {/* Main column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {order.status === "pending_review" && (
                <ResolveSection order={order} onOrderUpdated={handleOrderUpdated} />
              )}

              {!isProcessing && <LineItemsPanel order={order} />}

              {order.artifacts.length > 0 && (
                <GeneratedFilesPanel artifacts={order.artifacts} onDownload={handleDownload} />
              )}
            </div>

            {/* Sidebar — three cards max */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <CounterpartiesPanel order={order} />
              <DetailsPanel order={order} />
              <AuditTimeline orderId={order.id} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
