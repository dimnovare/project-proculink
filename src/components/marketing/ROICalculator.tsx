"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

// ─── Design tokens (match marketing landing) ─────────────────────────────────
const T = {
  ink: "#0B1A2F",
  inkSoft: "#56627A",
  inkFaint: "#8A93A5",
  surface: "#F6F7FA",
  card: "#FFFFFF",
  border: "#E2E6EE",
  borderSoft: "#EEF1F6",
  accent: "#1E66C9",
  accentBg: "#E3EDFB",
  green: "#2E8E3A",
  greenBg: "#E2F1E2",
  amber: "#C97A14",
  amberBg: "#FAEFD6",
  violet: "#6F4FCE",
  violetBg: "#EEE7FB",
} as const;

// ─── Plan recommendation ─────────────────────────────────────────────────────
type Plan = {
  name: string;
  price: number;          // €/month
  setup: number;          // one-time €
  orderLimit: number;
  blurb: string;
  cta: { label: string; href: string };
  highlight: string;
  isCustom?: boolean;
};

function recommendPlan(orders: number): Plan {
  if (orders <= 150) {
    return {
      name: "Growth",
      price: 149,
      setup: 0,
      orderLimit: 150,
      blurb: "Self-serve. Best for a single team replacing up to 150 monthly orders across 5 suppliers.",
      cta: { label: "Start 14-day Pilot →", href: "/sign-up" },
      highlight: T.accent,
    };
  }
  if (orders <= 500) {
    return {
      name: "Operations",
      price: 399,
      setup: 0,
      orderLimit: 500,
      blurb: "Reliable daily processing for 150–500 monthly orders across up to 10 suppliers.",
      cta: { label: "Start 14-day Pilot →", href: "/sign-up" },
      highlight: T.green,
    };
  }
  if (orders <= 1000) {
    return {
      name: "Integration",
      price: 999,
      setup: 0,
      orderLimit: 1000,
      blurb: "Webhook/API delivery and email ingestion for up to 1,000 orders and 20 suppliers.",
      cta: { label: "Start 14-day Pilot →", href: "/sign-up" },
      highlight: T.violet,
    };
  }
  return {
    name: "Enterprise",
    price: 0,
    setup: 0,
    isCustom: true,
    orderLimit: 99999,
    blurb: "Custom volume above 1,000 orders/month, named onboarding, DPA, and a tailored security review.",
    cta: { label: "Contact sales →", href: "mailto:sales@proculink.com" },
    highlight: T.amber,
  };
}

// ─── Field primitive (slider + value) ────────────────────────────────────────
function Field({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      style={{
        display: "block",
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "16px 18px",
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
          accentColor: T.accent,
          cursor: "pointer",
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
  color,
  bg,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  bg: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: "22px 22px 20px",
        boxShadow: "0 1px 4px rgba(11,26,47,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: T.inkSoft,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: T.ink,
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
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              display: "inline-block",
            }}
          />
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

    const plan = recommendPlan(orders);
    const planPrice = plan.isCustom ? 0 : plan.price;

    // Conservative assumption: ProcuLink automates 70% of the painful flow.
    const monthlySavings = totalPain * 0.7;
    const netMonthly = Math.max(monthlySavings - planPrice, 0);
    const annualSavings = monthlySavings * 12;
    const setup = plan.setup;
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
          {/* Inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field
              label="Orders per month"
              value={orders}
              display={orders.toLocaleString()}
              min={10}
              max={5000}
              step={10}
              onChange={setOrders}
            />
            <Field
              label="% of orders that need manual entry"
              value={manualPct}
              display={`${manualPct}%`}
              min={0}
              max={100}
              step={1}
              onChange={setManualPct}
            />
            <Field
              label="Avg minutes per manual order"
              value={minutes}
              display={`${minutes} min`}
              min={1}
              max={30}
              step={1}
              onChange={setMinutes}
            />
            <Field
              label="Internal hourly labour cost"
              value={hourly}
              display={eur(hourly)}
              min={10}
              max={80}
              step={1}
              onChange={setHourly}
            />
            <Field
              label="Error / rework rate"
              value={errorPct}
              display={`${errorPct}%`}
              min={0}
              max={10}
              step={0.5}
              onChange={setErrorPct}
            />
            <Field
              label="Avg cost to fix one error"
              value={reworkCost}
              display={eur(reworkCost)}
              min={5}
              max={200}
              step={5}
              onChange={setReworkCost}
            />
          </div>

          {/* Outputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Three stat cards */}
            <StatCard
              label="Monthly savings (at 70% automation)"
              value={eur(calc.monthlySavings)}
              sub={`${eur(calc.manualCost)} labour + ${eur(calc.errorCost)} rework today`}
              color={T.green}
              bg={T.greenBg}
            />
            <StatCard
              label="Annual savings"
              value={eur(calc.annualSavings)}
              sub={
                calc.plan.isCustom
                  ? "Plus tailored volume pricing"
                  : `${eur(calc.netMonthly)} net per month after plan cost`
              }
              color={T.accent}
              bg={T.accentBg}
            />
            <StatCard
              label="Payback period"
              value={
                isFinite(calc.paybackMonths)
                  ? `${calc.paybackMonths.toFixed(1)} months`
                  : "—"
              }
              sub={
                calc.plan.isCustom
                  ? "Contact sales for volume pricing"
                  : isFinite(calc.paybackMonths)
                    ? `${Math.round(calc.roi3yr)}% return over 3 years`
                    : "Plan price exceeds current pain — start smaller"
              }
              color={T.amber}
              bg={T.amberBg}
            />

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
                    "radial-gradient(circle at top right, rgba(30,102,201,0.25), transparent 60%)",
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "#7FB3F5",
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
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                      fontSize: 28,
                      fontWeight: 700,
                      letterSpacing: "-0.025em",
                    }}
                  >
                    {calc.plan.name}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#C5D2E4",
                    }}
                  >
                    {calc.plan.isCustom ? (
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF" }}>
                        Custom
                      </span>
                    ) : (
                      <>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF" }}>
                          {eur(calc.plan.price)}
                        </span>
                        /month
                        {calc.plan.setup > 0 && (
                          <span style={{ marginLeft: 8 }}>
                            · {eur(calc.plan.setup)} setup
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
                    marginBottom: 16,
                  }}
                >
                  {calc.plan.blurb}
                </p>
                <Link
                  href={calc.plan.cta.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 8,
                    padding: "10px 22px",
                    fontSize: 13.5,
                    fontWeight: 600,
                    background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
                    color: "#FFFFFF",
                    textDecoration: "none",
                    boxShadow: "0 4px 16px rgba(30,102,201,0.4)",
                  }}
                >
                  {calc.plan.cta.label}
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
          Plans are billed monthly; setup fees are one-time. The Pilot tier is free for 14 days
          (20 orders) and does not require a card.
        </p>
      </div>
    </section>
  );
}
