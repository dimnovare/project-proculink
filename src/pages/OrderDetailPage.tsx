import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, AlertTriangle, Calendar, Building2, FileText, Hash,
  Download, ExternalLink, Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";
import { OrderLineTable } from "@/components/orders/OrderLineTable";
import { ResolveSection } from "@/components/orders/ResolveSection";
import { SupplierMappings } from "@/components/orders/SupplierMappings";
import { OrderActions } from "@/components/orders/OrderActions";
import { AuditTimeline } from "@/components/orders/AuditTimeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

/** Statuses where the backend is still working — poll until they change. */
const POLLING_STATUSES: OrderStatus[] = ["parsing", "transforming"];

export default function OrderDetailPage() {
  const { id }      = useParams<{ id: string }>();
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
    // D1: poll every 2 s while status is in-progress
    refetchInterval: (query) => {
      const status = query.state.data?.status as OrderStatus | undefined;
      return status && POLLING_STATUSES.includes(status) ? 2_000 : false;
    },
  });

  // Called by ResolveSection after a successful resolve
  const handleOrderUpdated = (_updated: Order) => {
    queryClient.invalidateQueries({ queryKey: ["order", id] });
  };

  // D4: transform now enqueues an async job — just navigate back to detail (already here)
  // and let polling show the "transforming" spinner
  const handleTransform = async (format: "xml" | "csv") => {
    if (!order) return;
    try {
      await apiClient.transformOrder(order.id, format);
      // Invalidate immediately — query will re-fetch and see "transforming" status
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

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="page-container">
        <div className="flex items-center gap-4 mb-8">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-64" />
          </div>
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  // ── Not found / error ─────────────────────────────────────────────────────
  if (isError || !order) {
    return (
      <div className="page-container">
        <div className="text-center py-16">
          <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Order Not Found</h2>
          <p className="text-muted-foreground mb-6">
            This purchase order doesn't exist or was removed.
          </p>
          <Link to="/orders">
            <Button>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Orders
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isProcessing    = (POLLING_STATUSES as string[]).includes(order.status);
  const unresolvedCount = order.lines.filter(l => l.needsReview).length;

  return (
    <div className="page-container animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link to="/orders">
            <Button variant="ghost" size="icon" className="h-10 w-10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-foreground">{order.poNumber}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-muted-foreground text-sm">
              Created {formatDateTime(order.createdAt)}
              {order.updatedAt !== order.createdAt && (
                <> · Updated {formatDateTime(order.updatedAt)}</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* D1: In-progress banner while parsing or transforming */}
      {isProcessing && (
        <Alert className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            {order.status === "parsing"
              ? "Parsing file… this usually takes a few seconds."
              : "Transforming order… generating output file."}
          </AlertDescription>
        </Alert>
      )}

      {/* Unresolved banner */}
      {!isProcessing && unresolvedCount > 0 && (
        <Alert className="mb-6 border-warning/30 bg-warning-muted/20">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertDescription className="text-warning-foreground">
            <strong>
              {unresolvedCount} line{unresolvedCount !== 1 ? "s" : ""}
            </strong>{" "}
            still need supplier item codes before this order can be transformed.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {order.status === "pending_review" && (
            <ResolveSection order={order} onOrderUpdated={handleOrderUpdated} />
          )}

          {/* Line Items — hidden while parsing (no lines yet) */}
          {!isProcessing && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Line Items</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {order.lines.length} item{order.lines.length !== 1 ? "s" : ""}
                    {unresolvedCount > 0 && (
                      <span className="ml-2 text-warning">· {unresolvedCount} unresolved</span>
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <OrderLineTable lines={order.lines} currency={order.currency} />
              </CardContent>
            </Card>
          )}

          {/* Artifacts */}
          {order.artifacts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Generated Files</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.artifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {artifact.format.toUpperCase()} Export
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(artifact.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(artifact.id)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                      <ExternalLink className="ml-1.5 h-3 w-3 opacity-60" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {order.status === "ready" && (
            <OrderActions onTransform={handleTransform} />
          )}

          {/* Order Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Hash className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Order ID</p>
                  <p className="font-mono text-sm font-medium break-all">{order.id}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-medium text-sm">{formatDate(order.orderDate)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Currency</p>
                  <p className="font-medium text-sm">{order.currency}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Supplier */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supplier</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{order.supplierName || "—"}</p>
            </CardContent>
          </Card>

          {/* Summary */}
          {!isProcessing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Line Items</span>
                    <span className="font-medium">{order.lines.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Qty</span>
                    <span className="font-medium">
                      {order.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t">
                    <span className="font-medium">Total Value</span>
                    <span className="font-bold text-foreground">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: order.currency,
                      }).format(order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {order.supplierId && (
            <SupplierMappings
              supplierId={order.supplierId}
              supplierName={order.supplierName}
            />
          )}

          {/* E3: Audit timeline */}
          <AuditTimeline orderId={order.id} />
        </div>
      </div>
    </div>
  );
}
