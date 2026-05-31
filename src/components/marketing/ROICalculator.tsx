"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { recommendPlanByOrders } from "@/lib/plans";

// ─── Design tokens (Bridge Layer design system) ──────────────────────────────
// Primary accent is BUYER-BLUE (#1E66C9) — sliders, eyebrow, annual savings.
// Supplier-green (#2E8E3A) is reserved for the monthly-savings headline + plan
// CTA, matching the marketing landing source (mkt-components.jsx ROICalculator).
const T = {
  ink: "#0B1A2F",
  inkSoft: "#56627A",
  inkFaint: "#8A93A5",
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
        height: "100%",
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

    const plan = recommendPlanByOrders(orders);
    const planPrice = plan.isCustom ? 0 : (plan.priceMonthly ?? 0);
    // Onboarding fees are arranged manually (not auto-charged), so the ROI math
    // treats setup as €0 — see the fine print below.
    const setup = 0;
    const cta = plan.isCustom
      ? { label: "Contact sales →", href: plan.cta.href }
      : { label: `Start with ${plan.name} →`, href: "/sign-up" };

    // Conservative assumption: ProcuLink automates 70% of the painful flow.
    const monthlySavings = totalPain * 0.7;
    const netMonthly = Math.max(monthlySavings - planPrice, 0);
    const annualSavings = monthlySavings * 12;
    const paybackMonths =
      plan.isCustom || netMonthly <= 0 ? Infinity : (setup + planPrice) / netMonthly;
    // 3-year ROI: (savings over 36 months - cost over 36 months) / cost × 100
    const cost36 = planPrice * 36 + setup;
    const savings36 = monthlySavings * 36;
    const roi3yr = !plan.isCustom && cost36 > 0 ? ((savings36 - cost36) / cost36) * 100 : 0;

    return {
      manualCost,
      errorCost,
      totalPain,
      plan,
      planPrice,
      setup,
      cta,
      monthlySavings,
      netMonthly,
      annualSavings,
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
      className="px-4 sm:px-8"
      style={{
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
        paddingTop: 64,
        paddingBottom: 64,
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

          {/* Outputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Monthly savings — wide */}
            <StatCard
              label="Monthly savings (at 70% automation)"
              value={eur(calc.monthlySavings)}
              sub={`${eur(calc.manualCost)} labour + ${eur(calc.errorCost)} rework today`}
              valueColor={T.green}
            />

            {/* Annual + payback — side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 14 }}>
              <StatCard
                label="Annual savings"
                value={eur(calc.annualSavings)}
                sub={
                  calc.plan.isCustom
                    ? "Plus tailored volume pricing"
                    : `${eur(calc.netMonthly)} net / month after plan cost`
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

            {/* Plan recommendation */}
            <div
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
                    "radial-gradient(circle at top right, rgba(40,197,94,0.22), transparent 60%)",
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
                        color: "#86E5AC",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      Recommended plan
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
                      {calc.plan.name}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#C5D2E4", whiteSpace: "nowrap" }}>
                    {calc.plan.isCustom ? (
                      <span style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF" }}>
                        Custom
                      </span>
                    ) : (
                      <>
                        <span style={{ fontSize: 22, fontWeight: 700, color: "#FFFFFF" }}>
                          {eur(calc.planPrice)}
                        </span>
                        <span style={{ fontSize: 12 }}>/mo</span>
                        {calc.setup > 0 && (
                          <span style={{ marginLeft: 8 }}>
                            · {eur(calc.setup)} setup
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 13.5,
                    color: "#C5D2E4",
                    lineHeight: 1.6,
                    marginBottom: 18,
                  }}
                >
                  {calc.plan.recommendationBlurb}
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
                    background: `linear-gradient(90deg, ${T.green}, #28C55E)`,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    boxShadow: "0 8px 20px rgba(40,197,94,0.32)",
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
          flow — a conservative figure based on pilot customer measurements. Your number will be
          higher if your current process involves multiple retypes or supplier-specific formats.
          Plans are billed monthly. Supplier onboarding is arranged manually and is not auto-charged
          (waived for early design partners). The Pilot tier is free for 14 days (20 orders) and does
          not require a card.
        </p>
      </div>
    </section>
  );
}
