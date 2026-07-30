"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { OVERAGE_PER_ORDER_EUR, planEffectiveMonthlyCost, recommendPlanByOrders } from "@/lib/plans";

// ─── Design tokens (Bridge Layer design system) ──────────────────────────────
// Primary accent is BUYER-BLUE (#1E66C9) — sliders, eyebrow, annual savings.
// Supplier-green (#2E8E3A) is reserved for the monthly-savings headline + plan
// CTA, matching the marketing landing source (mkt-components.jsx ROICalculator).
const T = {
  ink: "#0B1A2F",
  inkSoft: "#56627A",
  inkFaint: "var(--ink-faint)",
  surface: "#F6F7FA",
  surface2: "#EFF2F7",
  card: "#FFFFFF",
  border: "#E2E6EE",
  borderSoft: "#EEF1F6",
  navy: "#0B1A2F",
  navyMuted: "#7C8DA6",
  navyText: "#C5D2E4",
  // Primary accent = blue
  accent: "#1E66C9",
  accentDeep: "#0F4FA8",
  accentBg: "#E3EDFB",
  blue: "#1E66C9",
  blueDeep: "#0F4FA8",
  blueBg: "#E3EDFB",
  // Supplier accent = green
  green: "#2E8E3A",
  greenBtn: "#297F34", // solid fill under white text — ≈4.6:1 AA (green is 4.16:1)
  greenDeep: "#1E6D29",
  greenBg: "#E2F1E2",
  amber: "#C97A14",
  amberBg: "#FAEFD6",
  violet: "#6F4FCE",
  violetBg: "#EEE7FB",
} as const;

// ─── Plan recommendation ─────────────────────────────────────────────────────
// The recommended plan + its price/limits come from the shared plan ladder
// (src/lib/plans.ts) via recommendPlanByOrders — no plan numbers live here.

// ─── Field primitive (slider + value, as a row in the inputs card) ────────────
function Field({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  divider,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  divider: boolean;
}) {
  return (
    <label
      style={{
        display: "block",
        padding: "18px 0",
        borderTop: divider ? `1px solid ${T.borderSoft}` : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <span
          style={{ fontSize: 13, fontWeight: 600, color: T.ink, letterSpacing: "-0.005em" }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 14,
            color: T.accent,
            fontWeight: 600,
          }}
        >
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          height: 28,
          accentColor: T.accent,
          cursor: "pointer",
          touchAction: "none",
        }}
      />
    </label>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Accent applied to the headline figure. Defaults to ink. */
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "20px 22px",
        boxShadow: "0 1px 4px rgba(11,26,47,0.04)",
        minHeight: 132,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: T.inkSoft,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: valueColor ?? T.ink,
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 12.5,
            color: T.inkSoft,
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function ROICalculator() {
  const [orders, setOrders] = useState(200);
  const [manualPct, setManualPct] = useState(40);
  const [minutes, setMinutes] = useState(10);
  const [hourly, setHourly] = useState(25);
  const [errorPct, setErrorPct] = useState(2);
  const [reworkCost, setReworkCost] = useState(30);

  const calc = useMemo(() => {
    const manualCost = orders * (manualPct / 100) * (minutes / 60) * hourly;
    const errorCost = orders * (errorPct / 100) * reworkCost;
    const totalPain = manualCost + errorCost;

    // Cost-optimal recommendation: flat price + €0.50/order overage at this
    // volume (mirrors backend PlanConstants best-price logic via plans.ts).
    const plan = recommendPlanByOrders(orders);
    const effective = planEffectiveMonthlyCost(plan, orders);
    const planPrice = plan.isCustom ? 0 : (effective?.total ?? plan.priceMonthly ?? 0);
    const overageOrders = effective?.overageOrders ?? 0;
    const overageEur = effective?.overageEur ?? 0;
    // Onboarding fees are arranged manually (not auto-charged), so the ROI math
    // treats setup as €0 — see the fine print below.
    const setup = 0;

    // Conservative assumption: ProcuLink automates 70% of the painful flow.
    const monthlySavings = totalPain * 0.7;
    // NET of the plan's effective monthly cost (can be negative — that drives
    // the honest "start smaller" state below instead of a green upsell CTA).
    const netMonthly = plan.isCustom ? monthlySavings : monthlySavings - planPrice;
    const netPositive = plan.isCustom ? monthlySavings > 0 : netMonthly > 0;
    const netAnnual = Math.max(netMonthly, 0) * 12;
    const paybackMonths =
      plan.isCustom || netMonthly <= 0 ? Infinity : (setup + planPrice) / netMonthly;
    // 3-year ROI: (savings over 36 months - cost over 36 months) / cost × 100
    const cost36 = planPrice * 36 + setup;
    const savings36 = monthlySavings * 36;
    const roi3yr = !plan.isCustom && cost36 > 0 ? ((savings36 - cost36) / cost36) * 100 : 0;

    const cta = plan.isCustom
      ? { label: "Contact sales →", href: plan.cta.href }
      : netPositive
        ? { label: `Start with ${plan.name} →`, href: "/sign-up" }
        : { label: "Start with the free Pilot →", href: "/sign-up" };

    return {
      manualCost,
      errorCost,
      totalPain,
      plan,
      planPrice,
      overageOrders,
      overageEur,
      setup,
      cta,
      monthlySavings,
      netMonthly,
      netPositive,
      netAnnual,
      paybackMonths,
      roi3yr,
    };
  }, [orders, manualPct, minutes, hourly, errorPct, reworkCost]);

  const eur = (n: number) =>
    n.toLocaleString("en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });

  return (
    <section
      id="roi"
      className="px-4 sm:px-8"
      style={{
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
        paddingTop: 64,
        paddingBottom: 64,
        scrollMarginTop: 70,
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 99,
              background: T.accentBg,
              border: `1px solid ${T.accent}40`,
              fontSize: 11.5,
              fontWeight: 600,
              color: T.accent,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: T.accent,
                display: "inline-block",
              }}
            />
            ROI calculator
          </div>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(26px, 3.5vw, 38px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: T.ink,
              marginBottom: 12,
            }}
          >
            How much is manual order processing costing you?
          </h2>
          <p
            style={{
              fontSize: 15.5,
              color: T.inkSoft,
              maxWidth: 540,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            Move the sliders. We&apos;ll show your monthly pain, the plan that fits, and how long it takes ProcuLink to pay for itself.
          </p>
        </div>

        {/* Grid */}
        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ gap: 28 }}
        >
          {/* Inputs — single card, slider rows */}
          <div
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: "8px 24px",
              boxShadow: "0 1px 4px rgba(11,26,47,0.04)",
            }}
          >
            <Field
              label="Orders per month"
              value={orders}
              display={orders.toLocaleString()}
              min={10}
              max={5000}
              step={10}
              onChange={setOrders}
              divider={false}
            />
            <Field
              label="% needing manual entry"
              value={manualPct}
              display={`${manualPct}%`}
              min={0}
              max={100}
              step={1}
              onChange={setManualPct}
              divider
            />
            <Field
              label="Avg minutes per manual order"
              value={minutes}
              display={`${minutes} min`}
              min={1}
              max={30}
              step={1}
              onChange={setMinutes}
              divider
            />
            <Field
              label="Internal hourly labour cost"
              value={hourly}
              display={eur(hourly)}
              min={10}
              max={80}
              step={1}
              onChange={setHourly}
              divider
            />
            <Field
              label="Error / rework rate"
              value={errorPct}
              display={`${errorPct}%`}
              min={0}
              max={10}
              step={0.5}
              onChange={setErrorPct}
              divider
            />
            <Field
              label="Avg cost to fix one error"
              value={reworkCost}
              display={eur(reworkCost)}
              min={5}
              max={200}
              step={5}
              onChange={setReworkCost}
              divider
            />
          </div>

          {/* Outputs — the result rows sit a touch further apart on mobile (gap-5
              = 20px) so the € figures don't crowd each other or the recommendation
              panel; desktop keeps the tighter 14px rhythm (md:gap-[14px]). */}
          <div
            className="flex flex-col gap-5 md:gap-[14px]"
            style={{ alignSelf: "start" }}
          >
            {/* Net monthly savings — wide, NET of the plan's effective cost */}
            <StatCard
              label="Net monthly savings (after plan cost)"
              value={calc.netPositive ? eur(Math.max(calc.netMonthly, 0)) : "€0"}
              sub={
                calc.plan.isCustom
                  ? `${eur(calc.monthlySavings)} gross savings at 70% automation · plus tailored volume pricing`
                  : `${eur(calc.monthlySavings)} gross savings (${eur(calc.manualCost)} labour + ${eur(calc.errorCost)} rework) − ${eur(calc.planPrice)} plan cost`
              }
              valueColor={calc.netPositive ? T.green : T.inkSoft}
            />

            {/* Annual + payback — side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 14 }}>
              <StatCard
                label="Net annual savings"
                value={calc.netPositive ? eur(calc.netAnnual) : "€0"}
                sub={
                  calc.plan.isCustom
                    ? "Plus tailored volume pricing"
                    : calc.netPositive
                      ? `${eur(Math.max(calc.netMonthly, 0))} net / month after plan cost`
                      : "Plan cost exceeds estimated savings at these inputs"
                }
                valueColor={T.blueDeep}
              />
              <StatCard
                label="Payback period"
                value={
                  isFinite(calc.paybackMonths)
                    ? `${calc.paybackMonths.toFixed(1)} mo`
                    : "—"
                }
                sub={
                  calc.plan.isCustom
                    ? "Contact sales for volume pricing"
                    : isFinite(calc.paybackMonths)
                      ? `${Math.round(calc.roi3yr)}% return over 3 years`
                      : "Plan price exceeds current pain — start smaller"
                }
              />
            </div>

            {/* Plan recommendation — a hair more breathing room above it on mobile
                (mt-1) so the dark panel reads as a distinct conclusion below the
                stacked stat cards; desktop keeps the flex rhythm (md:mt-0). */}
            <div
              className="mt-1 md:mt-0"
              style={{
                background: T.ink,
                color: "#FFFFFF",
                borderRadius: 12,
                padding: "22px 24px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(circle at top right, rgba(46,142,58,0.22), transparent 60%)",
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: calc.netPositive || calc.plan.isCustom ? "#86E5AC" : "#C5D2E4",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      {calc.netPositive || calc.plan.isCustom ? "Recommended plan" : "Start smaller"}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                        fontSize: 28,
                        fontWeight: 700,
                        letterSpacing: "-0.025em",
                        lineHeight: 1.1,
                      }}
                    >
                      {calc.netPositive || calc.plan.isCustom ? calc.plan.name : "Pilot"}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#C5D2E4", whiteSpace: "nowrap" }}>
                    {calc.plan.isCustom ? (
                      <span style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF" }}>
                        Custom
                      </span>
                    ) : calc.netPositive ? (
                      <>
                        <span style={{ fontSize: 22, fontWeight: 700, color: "#FFFFFF" }}>
                          {eur(calc.planPrice)}
                        </span>
                        <span style={{ fontSize: 12 }}>/mo</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF" }}>
                        Free
                      </span>
                    )}
                  </div>
                </div>
                {/* Overage math, shown transparently when the volume exceeds the
                    plan's monthly allowance (soft cap — never blocked). */}
                {!calc.plan.isCustom && calc.netPositive && calc.overageOrders > 0 && (
                  <p style={{ fontSize: 12.5, color: "#9DB2CE", lineHeight: 1.5, margin: "0 0 10px" }}>
                    {eur(calc.plan.priceMonthly ?? 0)} plan + {calc.overageOrders.toLocaleString()}{" "}
                    orders over the {calc.plan.orderLimit?.toLocaleString()}/mo allowance ×{" "}
                    {OVERAGE_PER_ORDER_EUR.toLocaleString("en-GB", { style: "currency", currency: "EUR" })}{" "}
                    = {eur(calc.overageEur)} overage. Processing is never blocked.
                  </p>
                )}
                <p
                  style={{
                    fontSize: 13.5,
                    color: "#C5D2E4",
                    lineHeight: 1.6,
                    marginBottom: 18,
                  }}
                >
                  {calc.plan.isCustom || calc.netPositive
                    ? calc.plan.recommendationBlurb
                    : `At these inputs, the ${calc.plan.name} plan (${eur(calc.planPrice)}/mo at your volume) would cost more than the ${eur(calc.monthlySavings)}/mo it saves. Start with the free 14-day Pilot — 20 orders, no card required — and upgrade once the savings are real.`}
                </p>
                <Link
                  href={calc.cta.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    padding: "12px 22px",
                    fontSize: 14,
                    fontWeight: 600,
                    background:
                      calc.netPositive || calc.plan.isCustom
                        ? `linear-gradient(90deg, ${T.greenBtn}, ${T.greenDeep})`
                        : `linear-gradient(90deg, ${T.blue}, ${T.blueDeep})`,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    boxShadow:
                      calc.netPositive || calc.plan.isCustom
                        ? "0 8px 20px rgba(46,142,58,0.32)"
                        : "0 8px 20px rgba(30,102,201,0.32)",
                  }}
                >
                  {calc.cta.label}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Fine print */}
        <p
          style={{
            fontSize: 12,
            color: T.inkFaint,
            textAlign: "center",
            marginTop: 32,
            maxWidth: 720,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.6,
          }}
        >
          Savings model assumes ProcuLink automates 70% of the manual reformatting and validation
          flow — an illustrative default based on our analysis of typical manual reformatting
          effort, not a measured customer outcome. Adjust the sliders for your own numbers; your
          result will be higher if your current process involves multiple retypes or
          supplier-specific formats.
          Plans are billed monthly and include light, self-serve setup at no extra cost; hands-on
          per-supplier onboarding applies only to Enterprise and other complex setups, is arranged
          manually (never auto-charged), and we will waive it for the first design partners we take
          on. Paid plans include
          a monthly order allowance; orders above it bill at €0.50/order and are never blocked — the
          plan cost and payback maths above already include that overage. The Pilot tier is
          free for 14 days (20 orders) and does not require a card.
        </p>
      </div>
    </section>
  );
}
