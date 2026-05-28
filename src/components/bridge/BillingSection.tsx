"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
} from "@/lib/api-client";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { capture } from "@/lib/analytics";

const PLAN_META: Record<BillingPlan, {
  label: string;
  color: string;
  next?: BillingPlan;
}> = {
  pilot:       { label: "Pilot · 14-day trial", color: "#C97A14", next: "growth" },
  growth:      { label: "Growth · €149/mo", color: "#1E66C9", next: "operations" },
  operations:  { label: "Operations · €399/mo", color: "#2E8E3A", next: "integration" },
  integration: { label: "Integration · €999/mo", color: "#6F4FCE" },
  enterprise:  { label: "Enterprise · Custom", color: "#0B1A2F" },
};

const CHECKOUT_PLANS: BillingPlan[] = ["growth", "operations", "integration"];

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const barColor = pct >= 100 ? "#C53A3A" : pct >= 80 ? "#C97A14" : "#1E66C9";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 12, color: "#56627A" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: pct >= 100 ? "#C53A3A" : "#0B1A2F" }}>
          {used} / {unlimited ? "Custom" : limit}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "#E2E6EE", overflow: "hidden" }}>
        <div style={{ width: unlimited ? "100%" : `${pct}%`, height: "100%", background: unlimited ? "#2E8E3A" : barColor, borderRadius: 99 }} />
      </div>
    </div>
  );
}

function PlanBadge({ status }: { status: BillingStatus }) {
  const meta = PLAN_META[status.plan];
  const label = status.plan === "pilot" && status.isTrialExpired
    ? "Pilot ended · Processing paused"
    : meta.label;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      borderRadius: 6,
      padding: "3px 10px",
      fontSize: 12,
      fontWeight: 700,
      background: `${meta.color}18`,
      color: meta.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
      {label}
    </span>
  );
}

function TrialCountdown({ endsAt }: { endsAt: string }) {
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <span style={{ fontSize: 11.5, color: days <= 3 ? "#C97A14" : "#56627A" }}>
      Trial: {days} day{days === 1 ? "" : "s"} left
    </span>
  );
}

function LimitBanner({ status }: { status: BillingStatus }) {
  if (status.plan === "pilot" && status.isTrialExpired) {
    return (
      <div style={bannerStyle}>
        <strong>Your Pilot has ended.</strong>
        <span>You can still view previous orders and mappings, but new order processing is paused.</span>
      </div>
    );
  }

  if (status.plan === "pilot" && status.isOrderLimitReached) {
    return (
      <div style={bannerStyle}>
        <strong>You&apos;ve used all 20 Pilot orders.</strong>
        <span>Upgrade to Growth to continue processing new orders.</span>
      </div>
    );
  }

  if (status.isOrderLimitReached) {
    return (
      <div style={bannerStyle}>
        <strong>You&apos;ve reached your plan&apos;s order limit.</strong>
        <span>Upgrade to continue processing new buyer orders this month.</span>
      </div>
    );
  }

  return null;
}

const bannerStyle: React.CSSProperties = {
  borderRadius: 8,
  padding: "12px 16px",
  background: "#FAEFD6",
  border: "1px solid #C97A14",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  color: "#7A4A0A",
};

export function BillingSection() {
  const { data: status, isLoading, error, refetch, isFetching } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    staleTime: 60_000,
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan: BillingPlan) => createCheckoutSession(plan),
    onSuccess: (url) => { window.location.href = url; },
  });

  const portalMutation = useMutation({
    mutationFn: createPortalSession,
    onSuccess: (url) => { window.location.href = url; },
  });

  if (isLoading) {
    return (
      <div style={{ maxWidth: 620, border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: 18 }}>
        <div style={{ height: 18, width: 190, background: "#E2E6EE", borderRadius: 4, marginBottom: 18 }} />
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ height: 10, width: "100%", background: "#EFF2F7", borderRadius: 99 }} />
          <div style={{ height: 10, width: "72%", background: "#EFF2F7", borderRadius: 99 }} />
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div style={{ maxWidth: 620, border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", borderRadius: 8, background: "#FFFFFF", padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>Billing is temporarily unavailable</div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "#56627A" }}>
          We could not reach the billing service. Your workspace data is still available; plan changes and usage limits need the API connection.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", height: 32, padding: "0 12px", fontSize: 12, fontWeight: 700, cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry"}
        </button>
      </div>
    );
  }

  const isPilot = status.plan === "pilot";
  const isEnterprise = status.plan === "enterprise";
  const isPaid = CHECKOUT_PLANS.includes(status.plan);
  const nextPlan = PLAN_META[status.plan].next;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      <LimitBanner status={status} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <PlanBadge status={status} />
        <span style={{ fontSize: 11.5, color: "#8A93A5" }}>
          Status: {status.accountStatus.replaceAll("_", " ")}
        </span>
        {isPilot && !status.isTrialExpired && status.trialEndsAt && (
          <TrialCountdown endsAt={status.trialEndsAt} />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: status.canProcessOrders || isEnterprise ? 1 : 0.58 }}>
        <UsageBar
          used={status.ordersThisMonth}
          limit={status.orderLimit}
          label={isPilot ? "Orders (Pilot total)" : "Orders this month"}
        />
        <UsageBar
          used={status.suppliersUsed}
          limit={status.supplierLimit}
          label="Supplier flows"
        />
      </div>

      {isPilot && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => checkoutMutation.mutate("growth")}
            disabled={checkoutMutation.isPending}
            style={primaryButton("#1E66C9", checkoutMutation.isPending)}
          >
            {status.isTrialExpired || status.isOrderLimitReached ? "Upgrade to continue" : "Upgrade to Growth"}
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["operations", "integration"] as const).map((plan) => (
              <button
                key={plan}
                onClick={() => checkoutMutation.mutate(plan)}
                disabled={checkoutMutation.isPending}
                style={secondaryButton(PLAN_META[plan].color, checkoutMutation.isPending)}
              >
                {PLAN_META[plan].label}
              </button>
            ))}
          </div>
          <a href="mailto:sales@proculink.com" style={{ fontSize: 12, color: "#8A93A5" }}>
            Need Enterprise? Contact sales
          </a>
          {process.env.NEXT_PUBLIC_BOOK_DEMO_URL && (
            <a
              href={process.env.NEXT_PUBLIC_BOOK_DEMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => capture("book_demo_clicked", { from_route: "/settings", plan: "pilot" })}
              style={{
                marginTop: 4,
                alignSelf: "flex-start",
                background: "#FFFFFF",
                color: "#0B1A2F",
                border: "1px solid #C6CDDA",
                borderLeft: "3px solid #1E66C9",
                borderRadius: 7,
                padding: "8px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Book a 15-min demo →
            </a>
          )}
        </div>
      )}

      {isPaid && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            style={primaryButton("#0B1A2F", portalMutation.isPending)}
          >
            {portalMutation.isPending ? "Opening..." : "Manage billing"}
          </button>
          {portalMutation.isError && (
            <p style={{ margin: 0, fontSize: 12, color: "#C53A3A", lineHeight: 1.5 }}>
              {portalMutation.error instanceof Error &&
              portalMutation.error.message.toLowerCase().includes("customer")
                ? "No billing customer on file. Contact support to link your account."
                : "Could not open billing portal. Please try again or contact support."}
            </p>
          )}
          {nextPlan && (
            <button
              onClick={() => checkoutMutation.mutate(nextPlan)}
              disabled={checkoutMutation.isPending}
              style={secondaryButton(PLAN_META[nextPlan].color, checkoutMutation.isPending)}
            >
              Need more volume? Upgrade to {nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}.
            </button>
          )}
        </div>
      )}

      {isEnterprise && (
        <p style={{ fontSize: 13, color: "#56627A", margin: 0 }}>
          Enterprise plans use a manual agreement. Contact support to adjust volume, suppliers, SLA, or connector scope.
        </p>
      )}
    </div>
  );
}

function primaryButton(background: string, disabled: boolean): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    padding: "8px 16px",
    borderRadius: 7,
    fontSize: 12.5,
    fontWeight: 700,
    background,
    color: "#FFFFFF",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryButton(color: string, disabled: boolean): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    background: `${color}12`,
    border: `1px solid ${color}35`,
    borderRadius: 7,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
