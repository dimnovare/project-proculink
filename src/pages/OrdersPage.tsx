import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, FileText, ArrowUpDown } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [sortField, setSortField] = useState<"createdAt" | "poNumber">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    apiClient.getOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  const filteredOrders = orders
    .filter((order) => {
      const matchesSearch =
        order.poNumber.toLowerCase().includes(search.toLowerCase()) ||
        order.supplierName.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === "poNumber") {
        cmp = a.poNumber.localeCompare(b.poNumber);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="page-container animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Purchase Orders</h1>
        <p className="text-muted-foreground">
          View and manage all processed purchase orders
        </p>
      </div>

      {/* Filters */}
      <div className="card-elevated p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by PO number or supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="transforming">Transforming</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="card-elevated overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium text-foreground mb-1">No orders found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {search || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Upload your first purchase order to get started"}
            </p>
            {!search && statusFilter === "all" && (
              <Link to="/upload">
                <Button>Upload Order</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <button
                      onClick={() => toggleSort("poNumber")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      PO Number
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th>Supplier</th>
                  <th>Order Date</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Unresolved</th>
                  <th>Status</th>
                  <th>
                    <button
                      onClick={() => toggleSort("createdAt")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Created
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        to={`/orders/${order.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {order.poNumber}
                      </Link>
                    </td>
                    <td className="font-medium">{order.supplierName}</td>
                    <td className="text-muted-foreground">{formatDate(order.orderDate)}</td>
                    <td className="font-mono text-right">{order.lineCount}</td>
                    <td className="text-right">
                      {order.unresolvedCount > 0 ? (
                        <span className="font-mono text-warning font-medium">
                          {order.unresolvedCount}
                        </span>
                      ) : (
                        <span className="font-mono text-muted-foreground">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={order.status} size="sm" />
                    </td>
                    <td className="text-muted-foreground text-sm">
                      {formatDate(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && filteredOrders.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {filteredOrders.length} of {orders.length} order{orders.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
