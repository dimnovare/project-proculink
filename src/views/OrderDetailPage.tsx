"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";
import { OrderLineTable } from "@/components/orders/OrderLineTable";
import { ResolveSection } from "@/components/orders/ResolveSection";
import { SupplierMappings } from "@/components/orders/SupplierMappings";
import { OrderActions } from "@/components/orders/OrderActions";
import { AuditTimeline } from "@/components/orders/AuditTimeline";
import { SpineReviewSkeleton } from "@/components/bridge/Skeletons";
import { BridgeLoader } from "@/components/bridge/BridgeLoader";
import { useToast } from "@/hooks/use-toast";

/** Statuses where the backend is still working — poll until they change. */
const POLLING_STATUSES: OrderStatus[] = ["parsing", "transforming"];

// ─── Layout helpers ───────────────────────────────────────────────────────────

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
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
      {title && (
        <div style={{
          padding: "10px 16px",
          borderBottom: "1px solid #E2E6EE",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0B1A2F" }}>{title}</span>
          {meta && <span style={{ fontSize: 12, color: "#8A93A5" }}>{meta}</span>}
        </div>
      )}
      <div style={noPad ? undefined : { padding: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span style={{
        display: "block", fontSize: 10.5, fontWeight: 600, color: "#8A93A5",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: "#0B1A2F" }}>{children}</span>
    </div>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: "#56627A" }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: bold ? 700 : 500, color: "#0B1A2F" }}>{value}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams();
  const id = params?.id as string | undefined;
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

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
        justifyContent: "center", height: "100%", gap: 10, background: "#F6F7FA",
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11, background: "#EDF0F5",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F" }}>Order Not Found</span>
        <span style={{ fontSize: 12.5, color: "#8A93A5" }}>
          This purchase order doesn&apos;t exist or was removed.
        </span>
        <Link
          href="/orders"
          style={{
            marginTop: 8, padding: "7px 14px", borderRadius: 7,
            background: "#0B1A2F", color: "#FFFFFF",
            fontSize: 12.5, fontWeight: 700, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <ArrowLeft style={{ width: 13, height: 13 }} />
          Back to Orders
        </Link>
      </div>
    );
  }

  const isProcessing    = (POLLING_STATUSES as string[]).includes(order.status);
  const unresolvedCount = order.lines.filter(l => l.needsReview).length;
  const totalValue      = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#F6F7FA" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "13px 24px",
        background: "#FFFFFF",
        borderBottom: "1px solid #E2E6EE",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}>
        <Link
          href="/orders"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 6,
            border: "1px solid #E2E6EE", background: "#FFFFFF",
            color: "#56627A", textDecoration: "none", flexShrink: 0,
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: "#0B1A2F", margin: 0 }}>
              {order.poNumber}
            </h1>
            <StatusBadge status={order.status} />
          </div>
          <p style={{ fontSize: 11.5, color: "#8A93A5", margin: "2px 0 0" }}>
            Created {fmtDt(order.createdAt)}
            {order.updatedAt !== order.createdAt && (
              <> · Updated {fmtDt(order.updatedAt)}</>
            )}
          </p>
        </div>
      </div>

      {/* ── In-progress banner ─────────────────────────────────────────────── */}
      {isProcessing && (
        <div style={{
          margin: "12px 24px 0",
          padding: "10px 14px",
          borderRadius: 8,
          background: "#EEF5FF",
          border: "1px solid #C3D9FF",
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          <BridgeLoader size={20} fullScreen={false} />
          <span style={{ fontSize: 13, color: "#1E4FA8" }}>
            {order.status === "parsing"
              ? "Parsing file… this usually takes a few seconds."
              : "Transforming order… generating output file."}
          </span>
        </div>
      )}

      {/* ── Unresolved banner ──────────────────────────────────────────────── */}
      {!isProcessing && unresolvedCount > 0 && (
        <div style={{
          margin: "12px 24px 0",
          padding: "10px 14px",
          borderRadius: 8,
          background: "#FAEFD6",
          border: "1px solid #C97A14",
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#C97A14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="9" x2="12" y2="13" stroke="#C97A14" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12.01" y2="17" stroke="#C97A14" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 13, color: "#7A4A0A" }}>
            <strong>{unresolvedCount} line{unresolvedCount !== 1 ? "s" : ""}</strong>{" "}
            still need supplier item codes before this order can be transformed.
          </span>
        </div>
      )}

      {/* ── Content grid ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>

          {/* Main column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {order.status === "pending_review" && (
              <ResolveSection order={order} onOrderUpdated={handleOrderUpdated} />
            )}

            {!isProcessing && (
              <Panel
                title="Line Items"
                meta={`${order.lines.length} item${order.lines.length !== 1 ? "s" : ""}${unresolvedCount > 0 ? ` · ${unresolvedCount} unresolved` : ""}`}
                noPad
              >
                <OrderLineTable lines={order.lines} currency={order.currency} />
              </Panel>
            )}

            {order.artifacts.length > 0 && (
              <Panel title="Generated Files">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {order.artifacts.map(artifact => (
                    <div
                      key={artifact.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", borderRadius: 7,
                        border: "1px solid #E2E6EE", background: "#F6F7FA",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.5">
                          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div>
                          <p style={{ fontSize: 12.5, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>
                            {artifact.format.toUpperCase()} Export
                          </p>
                          <p style={{ fontSize: 11.5, color: "#8A93A5", margin: 0 }}>
                            {fmtDt(artifact.createdAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload(artifact.id)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 10px", borderRadius: 6,
                          border: "1px solid #E2E6EE", background: "#FFFFFF",
                          fontSize: 12, fontWeight: 600, color: "#0B1A2F", cursor: "pointer",
                        }}
                      >
                        <Download style={{ width: 12, height: 12 }} />
                        Download
                        <ExternalLink style={{ width: 10, height: 10, opacity: 0.5 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {order.status === "ready" && (
              <OrderActions onTransform={handleTransform} />
            )}

            <Panel title="Order Details">
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Order ID">
                  <code style={{
                    fontSize: 11, background: "#F0F2F6",
                    padding: "2px 5px", borderRadius: 3, wordBreak: "break-all",
                  }}>
                    {order.id}
                  </code>
                </Field>
                <Field label="Order Date">{fmtDate(order.orderDate)}</Field>
                <Field label="Currency">{order.currency}</Field>
              </div>
            </Panel>

            <Panel title="Supplier">
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F" }}>
                {order.supplierName || "—"}
              </span>
            </Panel>

            {!isProcessing && (
              <Panel title="Summary">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <SummaryRow label="Line Items" value={String(order.lines.length)} />
                  <SummaryRow
                    label="Total Qty"
                    value={order.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString()}
                  />
                  <div style={{ borderTop: "1px solid #E2E6EE", paddingTop: 10 }}>
                    <SummaryRow
                      label="Total Value"
                      value={new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: order.currency,
                      }).format(totalValue)}
                      bold
                    />
                  </div>
                </div>
              </Panel>
            )}

            {order.supplierId && (
              <SupplierMappings
                supplierId={order.supplierId}
                supplierName={order.supplierName}
              />
            )}

            <AuditTimeline orderId={order.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
