import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Upload, CheckCircle2, AlertTriangle, ArrowUpRight,
  TrendingUp, Package,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { DashboardStats, OnboardingStatus, OrderSummary } from "@/types/procurement";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default function Dashboard() {
  // F3: track wizard dismissal for this session
  const [wizardDismissed, setWizardDismissed] = useState(false);

  // F4: real stats from backend
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn:  () => apiClient.getDashboardStats(),
    staleTime: 60_000,
  });

  // Recent orders list
  const { data: orders, isLoading: ordersLoading } = useQuery<OrderSummary[]>({
    queryKey: ["orders"],
    queryFn:  () => apiClient.getOrders(),
    staleTime: 30_000,
  });

  // F3: fetch onboarding status; show wizard if !hasSupplier
  const { data: onboarding } = useQuery<OnboardingStatus>({
    queryKey: ["onboarding-status"],
    queryFn:  () => apiClient.getOnboardingStatus(),
    staleTime: 60_000,
  });

  const recentOrders = orders?.slice(0, 5) ?? [];
  const showWizard   = !wizardDismissed && onboarding != null && !onboarding.hasSupplier;

  return (
    <div className="page-container animate-fade-in">
      {/* F2/F3: Onboarding wizard — shown until dismissed or hasSupplier */}
      {showWizard && (
        <OnboardingWizard
          status={onboarding!}
          onDismiss={() => setWizardDismissed(true)}
        />
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your purchase order processing at a glance
        </p>
      </div>

      {/* Stats Grid — F4 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="This Month"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          value={stats?.totalOrdersThisMonth}
          loading={statsLoading}
        />
        <StatCard
          title="Pending Review"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          value={stats?.pendingReview}
          loading={statsLoading}
          valueClass="text-warning"
          sub="Awaiting item code resolution"
        />
        <StatCard
          title="Delivered"
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          value={stats?.delivered}
          loading={statsLoading}
          valueClass="text-green-600 dark:text-green-400"
          sub={
            stats && stats.totalOrders > 0
              ? `${Math.round((stats.delivered / stats.totalOrders) * 100)}% delivery rate`
              : undefined
          }
        />
        <StatCard
          title="Total Orders"
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          value={stats?.totalOrders}
          loading={statsLoading}
        />
      </div>

      {/* Recent Orders + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Orders</CardTitle>
            <Link to="/orders">
              <Button variant="ghost" size="sm" className="gap-1">
                View all
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : recentOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No orders yet</p>
                <Link to="/upload" className="text-primary hover:underline text-sm">
                  Upload your first order
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentOrders.map(order => (
                  <Link
                    key={order.id}
                    to={`/orders/${order.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{order.poNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {order.supplierName} · {order.lineCount} item{order.lineCount !== 1 ? "s" : ""}
                        {order.unresolvedCount > 0 && (
                          <span className="text-warning"> · {order.unresolvedCount} unresolved</span>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={order.status} size="sm" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link to="/upload" className="block">
              <Button className="w-full justify-start gap-3">
                <Upload className="h-4 w-4" />
                Upload Purchase Order
              </Button>
            </Link>
            <Link to="/orders" className="block">
              <Button className="w-full justify-start gap-3" variant="outline">
                <FileText className="h-4 w-4" />
                View All Orders
              </Button>
            </Link>
            {onboarding && !onboarding.hasSupplier && (
              <Link to="/suppliers" className="block">
                <Button className="w-full justify-start gap-3" variant="outline">
                  <CheckCircle2 className="h-4 w-4" />
                  Add First Supplier
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Stat card helper ────────────────────────────────────────────────────────

interface StatCardProps {
  title:       string;
  icon:        React.ReactNode;
  value:       number | undefined;
  loading:     boolean;
  valueClass?: string;
  sub?:        string;
}

function StatCard({ title, icon, value, loading, valueClass = "", sub }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className={`text-2xl font-bold ${valueClass}`}>{value ?? 0}</div>
        )}
        {sub && !loading && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}
