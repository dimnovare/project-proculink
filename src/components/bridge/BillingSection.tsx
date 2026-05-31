"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
} from "@/lib/api-client";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, CHECKOUT_PLAN_IDS } from "@/lib/plans";
import { capture } from "@/lib/analytics";

// Plan presentation is derived from the shared plan ladder (src/lib/plans.ts)
// so the in-app billing card never drifts from the pricing page or ROI tool.
const PLAN_META = Object.fromEntries(
  Object.values(PLAN_BY_ID).map((p) => [
    p.id,
    { label: p.name, price: p.billingPriceLabel, sub: p.billingSummary, color: p.color, next: p.next ?? undefined },
  ]),
) as Record<BillingPlan, { label: string; price: string; sub: string; color: string; next?: BillingPlan }>;

const CHECKOUT_PLANS: BillingPlan[] = CHECKOUT_PLAN_IDS;

// Gradient usage bar matching canonical: var(--gradient-link-spine)
function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const unlimited = limit >= 2_000_000_000;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const atLimit  = !unlimited && pct >= 100;
  const warning  = !unlimited && pct >= 80 && pct < 100;

  // Default fill is the canonical buyer→supplier link gradient (buyer-blue → brand
  // green), driven straight from the design token so it never drifts from the render.
  const barStyle: React.CSSProperties = unlimited
    ? { background: "var(--gradient-link-spine)" }
    : atLimit
    ? { background: "var(--danger)" }
    : warning
    ? { background: "linear-gradient(90deg, var(--brand-blue), var(--amber))" }
    : { background: "var(--gradient-link-spine)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 12.5, color: "#56627A" }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: atLimit ? "#C53A3A" : "#0B1A2F" }}>
          {used.toLocaleString()} / {unlimited ? "Custom" : limit.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "#EFF2F7", overflow: "hidden" }}>
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
  borderRadius: 10,
  padding: "14px 18px",
  background: "#FAEFD6",
  border: "1px solid #C97A14",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  lineHeight: 1.5,
  color: "#7A4A0A",
};

// Large highlighted plan block — buyer-blue soft tint with a buyer-blue price,
// per the design render (the buyer side of the buyer→supplier bridge).
function PlanCard({ status, action }: { status: BillingStatus; action?: React.ReactNode }) {
  const meta = PLAN_META[status.plan];
  const isExpired = status.plan === "pilot" && status.isTrialExpired;
  const displayLabel = isExpired ? "Pilot ended · Processing paused" : meta.label;
  // Expired pilot uses amber tint; an active plan uses the buyer-blue soft tint
  // (sampled #E3EDFB) with a buyer-blue price — matches the design render.
  const accent = isExpired ? "#C97A14" : "#1E66C9";
  const softBg = isExpired ? "#FBF3E3" : "#E3EDFB";
  const borderCol = isExpired ? "#F0D8A8" : "#C9DCF6";

  return (
    <div style={{
      borderRadius: 10,
      background: softBg,
      border: `1px solid ${borderCol}`,
      padding: "16px 18px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "#0B1A2F" }}>
          {displayLabel}
        </div>
        <div style={{ fontSize: 12.5, color: "#56627A", marginTop: 4 }}>{meta.sub}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1 }}>
          {meta.price}
        </div>
        {action}
        {status.plan === "pilot" && !isExpired && status.trialEndsAt && (
          <div>
            <TrialCountdown endsAt={status.trialEndsAt} />
          </div>
        )}
        {!isExpired && (
          <div style={{ fontSize: 11, color: "#8A93A5" }}>
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
      <div style={{ border: "1px solid #E2E6EE", borderRadius: 12, background: "#FFFFFF", padding: 22, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
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
      <div style={{ border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", borderRadius: 12, background: "#FFFFFF", padding: 22, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <LimitBanner status={status} />

      {/* ── Current plan card (large highlighted block) ── */}
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface)", padding: 0, overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
        {/* Card header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em", color: "var(--ink)" }}>Current plan</div>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <PlanCard
            status={status}
            action={(isPaid || isEnterprise) ? (
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 32, padding: "0 14px", border: "1px solid #D5DAE5",
                  borderRadius: 8, background: "#FFFFFF", color: "#0B1A2F",
                  fontSize: 12.5, fontWeight: 600,
                  cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                  opacity: portalMutation.isPending ? 0.6 : 1, whiteSpace: "nowrap",
                }}
              >
                {portalMutation.isPending ? "Opening..." : "Change plan"}
              </button>
            ) : undefined}
          />

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
            style={primaryButton("var(--brand-green)", checkoutMutation.isPending)}
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
                borderLeft: "3px solid var(--brand-green)",
                borderRadius: 8,
                padding: "9px 14px",
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
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface)", padding: 0, overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em", color: "var(--ink)" }}>Payment method</div>
          </div>
          <div style={{ padding: "0 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Card &amp; billing details</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Managed in Stripe</div>
              </div>
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 34, padding: "0 14px", border: "1px solid #D5DAE5",
                  borderRadius: 8, background: "#FFFFFF", color: "#0B1A2F",
                  fontSize: 12.5, fontWeight: 600, cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                  opacity: portalMutation.isPending ? 0.6 : 1, flexShrink: 0,
                }}
              >
                {portalMutation.isPending ? "Opening..." : "Manage in Stripe"}
              </button>
            </div>
            {/* Billing email row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Billing email</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Update via the Stripe portal</div>
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
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background,
    color: "#FFFFFF",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 2px rgba(11,26,47,0.06)",
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
