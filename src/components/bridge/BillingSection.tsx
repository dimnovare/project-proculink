"use client";

// BillingSection — renders inside the Settings > Billing tab.
// Handles 5 plan states: Pilot active, Pilot expired, Stripe trial, paid, Enterprise.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  requestPilotExtension,
} from "@/lib/api-client";
import type { BillingStatus, BillingPlan } from "@/types/procurement";

const PLAN_LABELS: Record<BillingPlan, string> = {
  pilot:       "Pilot",
  growth:      "Growth · €149/mo",
  operations:  "Operations · €399/mo",
  integration: "Integration · €999/mo",
  enterprise:  "Enterprise · Custom",
};

const PLAN_COLORS: Record<BillingPlan, string> = {
  pilot:       "#C97A14",
  growth:      "#1E66C9",
  operations:  "#2E8E3A",
  integration: "#6F4FCE",
  enterprise:  "#0B1A2F",
};

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct      = limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const isAmber  = pct >= 80 && pct < 100;
  const isDanger = pct >= 100;
  const barColor = isDanger ? "#C53A3A" : isAmber ? "#C97A14" : "#1E66C9";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#56627A" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: isDanger ? "#C53A3A" : "#0B1A2F" }}>
          {used} / {limit >= 2_000_000_000 ? "∞" : limit}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "#E2E6EE", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 99, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function PlanBadge({ plan, expired }: { plan: BillingPlan; expired: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      borderRadius: 6,
      padding: "3px 10px",
      fontSize: 12,
      fontWeight: 700,
      background: `${PLAN_COLORS[plan]}18`,
      color: PLAN_COLORS[plan],
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: PLAN_COLORS[plan], display: "inline-block" }} />
      {expired ? "Pilot · Expired" : PLAN_LABELS[plan]}
    </span>
  );
}

function PilotCountdown({ endsAt }: { endsAt: string }) {
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <span style={{ fontSize: 11.5, color: days <= 3 ? "#C97A14" : "#56627A" }}>
      {days} day{days !== 1 ? "s" : ""} remaining
    </span>
  );
}

export function BillingSection() {
  const qc = useQueryClient();

  const { data: status, isLoading, error } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn:  getBillingStatus,
    staleTime: 60_000,
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan: string) => createCheckoutSession(plan),
    onSuccess:  (url) => { window.location.href = url; },
  });

  const portalMutation = useMutation({
    mutationFn: createPortalSession,
    onSuccess:  (url) => { window.location.href = url; },
  });

  const extensionMutation = useMutation({
    mutationFn: requestPilotExtension,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["billing-status"] }),
  });

  if (isLoading) {
    return (
      <div style={{ padding: "32px 0" }}>
        <div style={{ height: 20, width: 160, background: "#E2E6EE", borderRadius: 4 }} />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div style={{ padding: "32px 0", color: "#C53A3A", fontSize: 13 }}>
        Failed to load billing information.
      </div>
    );
  }

  const isPilot        = status.plan === "pilot";
  const isEnterprise   = status.plan === "enterprise";
  const isPaid         = !isPilot && !isEnterprise;
  const isPilotExpired = isPilot && status.pilotExpired;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>

      {/* Expired banner */}
      {isPilotExpired && (
        <div style={{ borderRadius: 8, padding: "12px 16px", background: "#FAEFD6", border: "1px solid #C97A14", fontSize: 13, color: "#7A4A0A" }}>
          Your Pilot has ended. Upgrade to continue using ProcuLink.
        </div>
      )}

      {/* Plan row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <PlanBadge plan={status.plan} expired={isPilotExpired} />
        {isPilot && !isPilotExpired && status.pilotEndsAt && (
          <PilotCountdown endsAt={status.pilotEndsAt} />
        )}
      </div>

      {/* Usage bars */}
      {!isEnterprise && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: isPilotExpired ? 0.4 : 1 }}>
          <UsageBar
            used={status.ordersUsed}
            limit={status.orderLimit}
            label={isPilot ? "Orders (Pilot total)" : "Orders this month"}
          />
          <UsageBar
            used={status.suppliersActive}
            limit={status.supplierLimit}
            label="Active suppliers"
          />
        </div>
      )}

      {/* CTAs — Pilot */}
      {isPilot && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["growth", "operations", "integration"] as const).map((plan) => (
              <button
                key={plan}
                onClick={() => checkoutMutation.mutate(plan)}
                disabled={checkoutMutation.isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 7,
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: PLAN_COLORS[plan],
                  color: "#FFFFFF",
                  border: "none",
                  cursor: checkoutMutation.isPending ? "not-allowed" : "pointer",
                  opacity: checkoutMutation.isPending ? 0.6 : 1,
                }}
              >
                Upgrade to {plan.charAt(0).toUpperCase() + plan.slice(1)} →
              </button>
            ))}
          </div>

          {/* Extension request */}
          {!status.extensionRequested ? (
            <button
              onClick={() => extensionMutation.mutate()}
              disabled={extensionMutation.isPending}
              style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontSize: 12, color: "#1E66C9", cursor: "pointer", textDecoration: "underline" }}
            >
              {extensionMutation.isPending ? "Sending…" : "Need more time? Request a Pilot extension →"}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "#2E8E3A" }}>
              ✓ Extension request sent — our team will be in touch.
            </span>
          )}

          <a href="mailto:sales@proculink.com" style={{ fontSize: 12, color: "#8A93A5" }}>
            Need Enterprise? Contact us →
          </a>
        </div>
      )}

      {/* CTAs — Paid */}
      {isPaid && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 600,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: "none",
              cursor: portalMutation.isPending ? "not-allowed" : "pointer",
            }}
          >
            {portalMutation.isPending ? "Opening…" : "Manage billing →"}
          </button>
          {status.plan !== "integration" && (
            <button
              onClick={() => {
                const next = status.plan === "growth" ? "operations" : "integration";
                checkoutMutation.mutate(next);
              }}
              style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontSize: 12, color: "#1E66C9", cursor: "pointer", textDecoration: "underline" }}
            >
              Upgrade to {status.plan === "growth" ? "Operations" : "Integration"} →
            </button>
          )}
        </div>
      )}

      {/* Enterprise */}
      {isEnterprise && (
        <p style={{ fontSize: 13, color: "#56627A", margin: 0 }}>
          Contact your account manager to adjust your plan.
        </p>
      )}
    </div>
  );
}
