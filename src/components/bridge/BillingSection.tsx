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
  price: string;
  sub: string;
  color: string;
  next?: BillingPlan;
}> = {
  pilot:       { label: "Pilot",       price: "Free trial",  sub: "Up to 20 orders · 1 supplier dock · 14 days",             color: "#C97A14", next: "growth"      },
  growth:      { label: "Growth",      price: "€149/mo",     sub: "Up to 150 orders / month · 5 supplier docks",              color: "#1E66C9", next: "operations"  },
  operations:  { label: "Operations",  price: "€399/mo",     sub: "Up to 500 orders / month · 10 supplier docks · all channels", color: "#2E8E3A", next: "integration" },
  integration: { label: "Integration", price: "€999/mo",     sub: "Up to 1,000 orders / month · 20 supplier docks · all channels", color: "#6F4FCE"                  },
  enterprise:  { label: "Enterprise",  price: "Custom",      sub: "Volume, SLA, and connector scope by agreement",            color: "#0B1A2F"                       },
};

const CHECKOUT_PLANS: BillingPlan[] = ["growth", "operations", "integration"];

// Gradient usage bar matching canonical: var(--gradient-link-spine)
function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const atLimit  = !unlimited && pct >= 100;
  const warning  = !unlimited && pct >= 80 && pct < 100;

  const barStyle: React.CSSProperties = unlimited
    ? { background: "#2E8E3A" }
    : atLimit
    ? { background: "#C53A3A" }
    : warning
    ? { background: "linear-gradient(90deg,#1E66C9,#C97A14)" }
    : { background: "linear-gradient(90deg,#1E66C9 0%,#1E66C9 35%,#2E8E3A 65%,#2E8E3A 100%)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 12.5, color: "#56627A" }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: atLimit ? "#C53A3A" : "#0B1A2F" }}>
          {used.toLocaleString()} / {unlimited ? "Custom" : limit.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: "#EFF2F7", overflow: "hidden" }}>
        <div style={{ width: unlimited ? "100%" : `${pct}%`, height: "100%", borderRadius: 4, ...barStyle }} />
      </div>
    </div>
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

// Canonical large highlighted plan card
function PlanCard({ status }: { status: BillingStatus }) {
  const meta = PLAN_META[status.plan];
  const isExpired = status.plan === "pilot" && status.isTrialExpired;
  const displayLabel = isExpired ? "Pilot ended · Processing paused" : meta.label;
  const softBg = `${meta.color}12`;

  return (
    <div style={{
      borderRadius: 8,
      background: softBg,
      border: `1px solid ${meta.color}30`,
      padding: "14px 16px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", color: "#0B1A2F" }}>
          {displayLabel}
        </div>
        <div style={{ fontSize: 12, color: "#56627A", marginTop: 3 }}>{meta.sub}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: meta.color, lineHeight: 1 }}>
          {meta.price}
        </div>
        {status.plan === "pilot" && !isExpired && status.trialEndsAt && (
          <div style={{ marginTop: 4 }}>
            <TrialCountdown endsAt={status.trialEndsAt} />
          </div>
        )}
        {!isExpired && (
          <div style={{ marginTop: 3, fontSize: 11, color: "#8A93A5" }}>
            {status.accountStatus.replaceAll("_", " ")}
          </div>
        )}
      </div>
    </div>
  );
}

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

  const isPilot      = status.plan === "pilot";
  const isEnterprise = status.plan === "enterprise";
  const isPaid       = CHECKOUT_PLANS.includes(status.plan);
  const nextPlan     = PLAN_META[status.plan].next;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620 }}>
      <LimitBanner status={status} />

      {/* ── Current plan card (canonical large highlighted block) ── */}
      <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: 0, overflow: "hidden" }}>
        {/* Card header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E6EE" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Current plan</div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <PlanCard status={status} />

          {/* Usage bars */}
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
        </div>
      </div>

      {/* ── Upgrade / change plan actions ── */}
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
          {nextPlan && (
            <button
              onClick={() => checkoutMutation.mutate(nextPlan)}
              disabled={checkoutMutation.isPending}
              style={secondaryButton(PLAN_META[nextPlan].color, checkoutMutation.isPending)}
            >
              Need more volume? Upgrade to {nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}.
            </button>
          )}
          {checkoutMutation.isError && (
            <p style={{ margin: 0, fontSize: 12, color: "#C53A3A" }}>
              {(checkoutMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          )}
        </div>
      )}

      {isEnterprise && (
        <p style={{ fontSize: 13, color: "#56627A", margin: 0 }}>
          Enterprise plans use a manual agreement. Contact support to adjust volume, suppliers, SLA, or connector scope.
        </p>
      )}

      {/* ── Payment method — managed in Stripe (canonical structure, real binding) ── */}
      {(isPaid || isEnterprise) && (
        <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E6EE" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Payment method</div>
          </div>
          <div style={{ padding: "0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #E2E6EE" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Card &amp; billing details</div>
                <div style={{ fontSize: 11.5, color: "#8A93A5", marginTop: 1 }}>Managed in Stripe</div>
              </div>
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 27, padding: "0 10px", border: "1px solid #C6CDDA",
                  borderRadius: 6, background: "#FFFFFF", color: "#0B1A2F",
                  fontSize: 12, fontWeight: 600, cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                  opacity: portalMutation.isPending ? 0.6 : 1,
                }}
              >
                {portalMutation.isPending ? "Opening..." : "Manage in Stripe"}
              </button>
            </div>
            {/* Billing email row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Billing email</div>
                <div style={{ fontSize: 11.5, color: "#8A93A5", marginTop: 1 }}>Update via the Stripe portal</div>
              </div>
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 27, padding: "0 10px",
                  background: "transparent", border: "none",
                  color: "#56627A", fontSize: 12, fontWeight: 600,
                  cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                }}
              >
                Edit
              </button>
            </div>
          </div>
          {portalMutation.isError && (
            <div style={{ padding: "0 16px 12px" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#C53A3A", lineHeight: 1.5 }}>
                {portalMutation.error instanceof Error &&
                portalMutation.error.message.toLowerCase().includes("customer")
                  ? "No billing customer on file. Contact support to link your account."
                  : "Could not open billing portal. Please try again or contact support."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pilot: no payment method section (not yet a customer) */}
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
