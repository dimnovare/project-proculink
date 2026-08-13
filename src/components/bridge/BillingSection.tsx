"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
} from "@/lib/api-client";
import { useState } from "react";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, CHECKOUT_PLAN_IDS, yearlySavePercent } from "@/lib/plans";
import { capture } from "@/lib/analytics";
import { isOrgAdminRefusal, orgAdminMessage } from "@/lib/planGate";
import { BOOK_DEMO_URL, BOOK_DEMO_LINK_ATTRS } from "@/lib/book-demo";
import { Card } from "@/components/bridge/layout/Card";

type BillingInterval = "monthly" | "yearly";

/**
 * What to tell someone whose "Change plan" / "Manage in Stripe" click was refused.
 *
 * Both buttons open the Stripe Billing Portal, which is where a subscription is cancelled, so
 * the backend restricts them to organisation administrators. Every failure here used to resolve
 * to one of two hardcoded sentences and the server's reason was discarded, which meant an
 * ordinary member was told "Please try again" about the one thing retrying can never fix.
 *
 * The role refusal is checked FIRST and never falls through to the retry copy. It is also not a
 * plan problem, so nothing here offers an upgrade: this person's organisation may well be on the
 * right plan already.
 */
function portalErrorCopy(error: unknown): string {
  if (isOrgAdminRefusal(error)) return orgAdminMessage();
  if (error instanceof Error && error.message.toLowerCase().includes("customer")) {
    return "No billing customer on file. Contact support to link your account.";
  }
  return "Could not open billing portal. Please try again or contact support.";
}

// Derived annual save-% for the upgrade toggle (uniform across the paid ladder
// today; sourced from plans.ts so it self-corrects with the Stripe-verified
// amounts — see TODO-verify-stripe-amounts there).
const ANNUAL_SAVE_PERCENT = yearlySavePercent(PLAN_BY_ID.growth);

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
        <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: atLimit ? "var(--danger)" : "var(--ink)" }}>
          {used.toLocaleString()} / {unlimited ? "Custom" : limit.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{ width: unlimited ? "100%" : `${pct}%`, height: "100%", borderRadius: 4, ...barStyle }} />
      </div>
    </div>
  );
}

function TrialCountdown({ endsAt }: { endsAt: string }) {
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <span style={{ fontSize: 11.5, color: days <= 3 ? "var(--amber-text)" : "var(--ink-muted)" }}>
      Trial: {days} day{days === 1 ? "" : "s"} left
    </span>
  );
}

// Blocking banner — ONLY for Pilot, whose trial/limit really does pause
// processing (Pilot becomes read-only). Paid plans are NEVER blocked; their
// over-limit state is handled by the non-blocking OverageNotice below.
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
        <strong>You&apos;ve used all {PLAN_BY_ID.pilot.orderLimit} Pilot orders.</strong>
        <span>Upgrade to Growth to continue processing new orders.</span>
      </div>
    );
  }

  return null;
}

// Non-blocking usage notice for PAID plans. Paid orders always process; this
// only flags that the customer is approaching the cap (heads-up) or is over it
// (overage billing). It never tells a paid customer that processing is paused.
function OverageNotice({ status }: { status: BillingStatus }) {
  // Pilot is handled by LimitBanner (it genuinely blocks); skip here.
  if (status.plan === "pilot") return null;
  // Enterprise has custom/no hard cap — no overage messaging.
  if (status.plan === "enterprise") return null;

  // Over the cap → honest overage line.
  if (status.atLimit || status.overageOrders > 0) {
    const eur = status.overageAmountEur.toLocaleString("en-IE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });
    return (
      <div style={infoNoticeStyle}>
        <strong style={{ color: "var(--brand-blue-deep)" }}>You&apos;re over your monthly order allowance.</strong>
        <span>
          Extra orders still process and bill at €0.50 each —{" "}
          <strong>{status.overageOrders.toLocaleString()}</strong> this period (≈{" "}
          <strong>{eur}</strong>{" "}
          <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>estimate</span>). Upgrade for more
          included volume if this keeps up.
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
          A running estimate — your Stripe invoice for the period is the final amount.
        </span>
      </div>
    );
  }

  // Approaching the cap (≥80%) → gentle heads-up.
  if (status.nearLimit) {
    return (
      <div style={warnNoticeStyle}>
        <strong style={{ color: "var(--amber-text)" }}>You&apos;re approaching your monthly order limit.</strong>
        <span>
          You&apos;ve used {status.ordersThisMonth.toLocaleString()} of{" "}
          {status.orderLimit.toLocaleString()} orders. Orders keep processing past the limit and any
          extras bill at €0.50 each.
        </span>
      </div>
    );
  }

  return null;
}

const bannerStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "14px 18px",
  background: "var(--amber-soft)",
  border: "1px solid var(--amber)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--amber-text)",
};

// Gentle amber heads-up (approaching cap) — softer than the blocking bannerStyle.
const warnNoticeStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "13px 16px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--amber)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: "var(--ink-muted)",
};

// Neutral blue info (over cap → overage billing) — informational, not a warning.
const infoNoticeStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "13px 16px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--brand-blue)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: "var(--ink-muted)",
};

// Large highlighted plan block — buyer-blue soft tint with a buyer-blue price,
// per the design render (the buyer side of the buyer→supplier bridge).
function PlanCard({ status, action }: { status: BillingStatus; action?: React.ReactNode }) {
  const meta = PLAN_META[status.plan];
  const isExpired = status.plan === "pilot" && status.isTrialExpired;
  const displayLabel = isExpired ? "Pilot ended · Processing paused" : meta.label;
  // Expired pilot uses amber tint; an active plan uses the buyer-blue soft tint
  // (sampled var(--brand-blue-soft)) with a buyer-blue price — matches the design render.
  // --amber-text, not --amber: `accent` is the PRICE text below, and --amber on
  // --amber-soft is 3.6547:1. It clears the 3:1 large-text floor at 24px/700 by
  // a hair, but the token is documented as non-text only. 5.6206:1.
  const accent = isExpired ? "var(--amber-text)" : "var(--brand-blue)";
  const softBg = isExpired ? "var(--amber-soft)" : "var(--brand-blue-soft)";
  const borderCol = isExpired ? "#F0D8A8" : "var(--brand-blue-soft-2)";

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
        <div style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)" }}>
          {displayLabel}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: 4 }}>{meta.sub}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1 }}>
          {meta.price}
        </div>
        {/* Payment interval — from billing-status billingInterval (server-derived
            from the Stripe price id). Hidden when null/absent (no subscription). */}
        {(status.billingInterval === "monthly" || status.billingInterval === "yearly") && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted)" }}>
            {status.billingInterval === "yearly" ? "Billed annually" : "Billed monthly"}
          </div>
        )}
        {action}
        {status.plan === "pilot" && !isExpired && status.trialEndsAt && (
          <div>
            <TrialCountdown endsAt={status.trialEndsAt} />
          </div>
        )}
        {!isExpired && (
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
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

  // Billing cadence for NEW checkouts (upgrades). Yearly is real self-serve:
  // the backend maps plan+interval to the Stripe `*YearlyPriceId`s.
  const [checkoutInterval, setCheckoutInterval] = useState<BillingInterval>("monthly");

  const checkoutMutation = useMutation({
    mutationFn: ({ plan, interval }: { plan: BillingPlan; interval: BillingInterval }) =>
      createCheckoutSession(plan, interval),
    onSuccess: (url) => { if (url) window.location.href = url; },
  });

  const portalMutation = useMutation({
    mutationFn: createPortalSession,
    onSuccess: (url) => { window.location.href = url; },
  });

  if (isLoading) {
    return (
      <Card pad={22} radius={12}>
        <div style={{ height: 18, width: 190, background: "var(--border)", borderRadius: 4, marginBottom: 18 }} />
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ height: 10, width: "100%", background: "var(--surface-2)", borderRadius: 99 }} />
          <div style={{ height: 10, width: "72%", background: "var(--surface-2)", borderRadius: 99 }} />
        </div>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <div style={{ border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", borderRadius: 12, background: "var(--surface)", padding: 22, boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>Billing is temporarily unavailable</div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
          We could not reach the billing service. Your workspace data is still available; plan changes and usage limits need the API connection.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", height: 32, padding: "0 12px", fontSize: 12, fontWeight: 700, cursor: isFetching ? "not-allowed" : "pointer" }}
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
      <OverageNotice status={status} />

      {/* ── Current plan card (large highlighted block) ── */}
      <Card flush radius="var(--radius-md)">
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
                  height: 32, padding: "0 14px", border: "1px solid var(--border-strong)",
                  borderRadius: 8, background: "var(--surface)", color: "var(--ink)",
                  fontSize: 12.5, fontWeight: 600,
                  cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                  opacity: portalMutation.isPending ? 0.6 : 1, whiteSpace: "nowrap",
                }}
              >
                {portalMutation.isPending ? "Opening..." : "Change plan"}
              </button>
            ) : undefined}
          />

          {/*
            "Change plan" opens the same portal as "Manage in Stripe" further down the page, but
            that card's error line is in a different card and was never visible from here — so a
            refusal on THIS button produced no feedback at all, just a button that stopped
            spinning. Same copy, next to the control that was pressed.
          */}
          {portalMutation.isError && (
            <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
              {portalErrorCopy(portalMutation.error)}
            </p>
          )}

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
              label="Suppliers"
            />
          </div>
        </div>
      </Card>

      {/* ── Upgrade / change plan actions ── */}
      {isPilot && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ borderRadius: 10, padding: "13px 15px", background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand-green)", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
            <strong style={{ color: "var(--ink)" }}>Upgrade when this is ready for daily orders.</strong>{" "}
            Growth keeps the same workflow but raises your monthly order volume, adds more suppliers, and keeps processing open after the Pilot window ends.
          </div>
          <IntervalToggle value={checkoutInterval} onChange={setCheckoutInterval} disabled={checkoutMutation.isPending} />
          <button
            onClick={() => checkoutMutation.mutate({ plan: "growth", interval: checkoutInterval })}
            disabled={checkoutMutation.isPending}
            style={primaryButton("var(--brand-green-btn)", checkoutMutation.isPending)}
          >
            {status.isTrialExpired || status.isOrderLimitReached ? "Upgrade to continue" : "Upgrade to Growth"}
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["operations", "integration", "distributor"] as const).map((plan) => (
              <button
                key={plan}
                onClick={() => checkoutMutation.mutate({ plan, interval: checkoutInterval })}
                disabled={checkoutMutation.isPending}
                style={secondaryButton(PLAN_META[plan].color, checkoutMutation.isPending)}
              >
                {PLAN_META[plan].label}
              </button>
            ))}
          </div>
          {checkoutMutation.isError && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
              {(checkoutMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          )}
          <a href="mailto:sales@proculink.eu" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
            Need Enterprise? Contact sales
          </a>
          <a
            href={BOOK_DEMO_URL}
            {...BOOK_DEMO_LINK_ATTRS}
            onClick={() => capture("book_demo_clicked", { from_route: "/settings", plan: "pilot" })}
            style={{
              marginTop: 4,
              alignSelf: "flex-start",
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--border-strong)",
              borderLeft: "3px solid var(--brand-green)",
              borderRadius: 8,
              padding: "9px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Book a demo →
          </a>
        </div>
      )}

      {isPaid && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ borderRadius: 10, padding: "13px 15px", background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
            Plan changes update order and supplier limits immediately after Stripe confirms the subscription. Existing orders, mappings, and delivery logs stay available.
          </div>
          {nextPlan && (
            <>
              <IntervalToggle value={checkoutInterval} onChange={setCheckoutInterval} disabled={checkoutMutation.isPending} />
              <button
                onClick={() => checkoutMutation.mutate({ plan: nextPlan, interval: checkoutInterval })}
                disabled={checkoutMutation.isPending}
                style={secondaryButton(PLAN_META[nextPlan].color, checkoutMutation.isPending)}
              >
                Need more volume? Upgrade to {nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}.
              </button>
            </>
          )}
          {checkoutMutation.isError && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
              {(checkoutMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          )}
        </div>
      )}

      {isEnterprise && (
        <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>
          Enterprise plans use a manual agreement. Contact support to adjust volume, suppliers, SLA, or connector scope.
        </p>
      )}

      {/* ── Payment method — managed in Stripe (canonical structure, real binding) ── */}
      {(isPaid || isEnterprise) && (
        <Card flush radius="var(--radius-md)">
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
                  height: 34, padding: "0 14px", border: "1px solid var(--border-strong)",
                  borderRadius: 8, background: "var(--surface)", color: "var(--ink)",
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
                  color: "var(--ink-muted)", fontSize: 12, fontWeight: 600,
                  cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                }}
              >
                Edit
              </button>
            </div>
          </div>
          {portalMutation.isError && (
            <div style={{ padding: "0 16px 12px" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {portalErrorCopy(portalMutation.error)}
              </p>
            </div>
          )}
          {/*
            Cancelling happens THROUGH this button — the Stripe portal is where a paid customer
            ends their subscription, and Stripe cannot tell them what it does to their ProcuLink
            workspace. /pricing carries this disclosure, but a customer cancelling is in Settings,
            not on the marketing site, so the warning has to be at the point of action too. The
            wording deliberately matches the /pricing copy and, like it, names the channels and
            avoids the internal status name.
          */}
          <div style={{ padding: "0 18px 14px" }}>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.55 }}>
              If you cancel in Stripe, new orders stop arriving once the subscription ends — uploads,
              emailed orders, SFTP and S3 pickups, and the REST API all stop, and nothing is held to
              deliver later, so redirect your suppliers first. Everything already processed stays
              readable and exportable.
            </p>
          </div>
        </Card>
      )}

      {/* Pilot: no payment method section (not yet a customer) */}
    </div>
  );
}

// Monthly/Annual cadence picker for new checkouts. The chosen interval is
// passed straight through createCheckoutSession → POST /api/billing/checkout
// { plan, billingInterval } → the Stripe `*YearlyPriceId` on "yearly".
function IntervalToggle({ value, onChange, disabled }: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  disabled: boolean;
}) {
  const options: Array<{ id: BillingInterval; label: string }> = [
    { id: "monthly", label: "Monthly" },
    { id: "yearly",  label: `Annual${ANNUAL_SAVE_PERCENT != null ? ` · save ${ANNUAL_SAVE_PERCENT}%` : ""}` },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div role="group" aria-label="Billing period" style={{ display: "inline-flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              disabled={disabled}
              style={{
                border: "none", borderRadius: 6, padding: "6px 13px",
                fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--ink)" : "var(--ink-muted)",
                boxShadow: on ? "0 1px 2px rgba(11,26,47,0.08)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {value === "yearly" && (
        <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Billed once per year</span>
      )}
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
    color: "var(--surface)",
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
