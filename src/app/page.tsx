import Link from "next/link";
import type { ReactNode } from "react";
import { BridgeIllustration } from "@/components/marketing/BridgeIllustration";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { ROICalculator } from "@/components/marketing/ROICalculator";

// ─── Brand accent (green) ─────────────────────────────────────────────────────
// Primary accent token is now green. Prefer the CSS var / hex below for new
// inline styles. Multi-colour feature accents stay for semantic variety.
const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";
const GREEN_SOFT = "#DCFCE7";
// Secondary decorative accent (matches the hero "any supplier" word + topology
// buyer side). Used purely for per-card colour rhythm, not as the primary brand.
const BLUE = "#2F6FE0";
const BLUE_SOFT = "#E5EEFC";

// ─── Line-icon set (stroke = currentColor) ────────────────────────────────────
function Icon({ name, color }: { name: string; color: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="m2 17 10 5 10-5" />
          <path d="m2 12 10 5 10-5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M13 2 4.5 12.5a.5.5 0 0 0 .4.8H11l-1 8.7L18.5 11a.5.5 0 0 0-.4-.8H12l1-8.2Z" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "shield-check":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.4" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.4" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" />
          <polyline points="12 7 12 12 16 14" />
        </svg>
      );
    default:
      return null;
  }
}

// ─── Static data ──────────────────────────────────────────────────────────────

const FEATURES: Array<{
  icon: string;
  title: string;
  desc: ReactNode;
  color: string;
  bg: string;
}> = [
  {
    icon: "layers",
    title: "Universal ingestion",
    desc: "CSV, XLSX, PDF, cXML, UBL, EDI, JSON or an email attachment — drop any purchase order and ProcuLink parses it into one canonical structure.",
    color: GREEN_DEEP,
    bg: GREEN_SOFT,
  },
  {
    icon: "spark",
    title: "AI-assisted mapping",
    desc: (
      <>
        When a buyer item code doesn&apos;t match the catalog, an LLM proposes the
        supplier code with confidence, reasoning and source. Your team confirms
        or rejects.
      </>
    ),
    color: "#6F4FCE",
    bg: "#EEE7FB",
  },
  {
    icon: "code",
    title: "Order review workbench",
    desc: "Side by side: source document, canonical view and the exact outbound payload. Resolve every exception before anything leaves your system.",
    color: "#C97A14",
    bg: "#FAEFD6",
  },
  {
    icon: "shield-check",
    title: "Per-supplier validation",
    desc: (
      <>
        Block bad orders before they reach the supplier. Configurable rules per
        supplier — missing fields, wrong currency, item codes that won&apos;t
        resolve.
      </>
    ),
    color: "#2E8E3A",
    bg: "#E2F1E2",
  },
  {
    icon: "send",
    title: "One-click delivery",
    desc: "HTTP webhook, SFTP, email or ERP connector — or download the artifact. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.",
    color: BLUE,
    bg: BLUE_SOFT,
  },
  {
    icon: "layers",
    title: "Standards, on demand",
    desc: "Every canonical field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode. Built for 30-year procurement veterans.",
    color: BLUE,
    bg: BLUE_SOFT,
  },
];

const STATS = [
  { value: "4+",     label: "Inbound formats"    },
  { value: "5+",     label: "Outbound formats"   },
  { value: "4",      label: "Delivery channels"  },
  { value: "EU",     label: "Data residency"     },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RootPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#FFFFFF",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background:
            "radial-gradient(120% 120% at 80% 0%, rgba(40,197,94,0.10), transparent 55%), #0B1A2F",
          paddingTop: "64px",
          paddingBottom: "56px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(40,197,94,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(40,197,94,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            pointerEvents: "none",
          }}
        />

        <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
          {/* Eyebrow */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              borderRadius: 99,
              padding: "4px 14px",
              background: "rgba(40,197,94,0.14)",
              border: "1px solid rgba(40,197,94,0.32)",
              marginBottom: 26,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: GREEN,
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#86E5AC",
              }}
            >
              B2B order automation
            </span>
          </div>

          {/* Headline — left aligned, plain procurement copy */}
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(40px, 6vw, 66px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.06,
              color: "#FFFFFF",
              maxWidth: 760,
              margin: "0 0 22px",
            }}
          >
            Send every purchase order to{" "}
            <span style={{ color: "#6BA5F0" }}>any supplier</span>,{" "}
            <span style={{ color: GREEN }}>any format</span>.
          </h1>

          {/* Sub */}
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: "#C5D2E4",
              maxWidth: 560,
              margin: "0 0 36px",
            }}
          >
            ProcuLink transforms unstructured purchase orders into structured
            supplier transactions — automatically, with a full audit trail behind
            every order.
          </p>

          {/* CTAs */}
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/sign-up"
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 8,
                padding: "13px 28px",
                fontSize: 14,
                fontWeight: 600,
                background: `linear-gradient(90deg, ${GREEN_DEEP}, ${GREEN})`,
                color: "#FFFFFF",
                textDecoration: "none",
                boxShadow: "0 8px 24px rgba(40,197,94,0.32)",
              }}
            >
              Start for free →
            </Link>
            <Link
              href="/how-it-works"
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 8,
                padding: "13px 28px",
                fontSize: 14,
                fontWeight: 600,
                background: "rgba(255,255,255,0.06)",
                color: "#FFFFFF",
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.16)",
              }}
            >
              See how it works
            </Link>
          </div>

          {/* Illustration — framed window panel */}
          <div
            style={{
              marginTop: 44,
              background: "#0C1D34",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 14,
              boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Window chrome header */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: "11px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div className="flex items-center gap-1.5">
                {["#F45D5D", "#E7B548", "#3FC76A"].map((c) => (
                  <span
                    key={c}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: c,
                      opacity: 0.85,
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
              <span
                className="hidden sm:inline"
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: "#7C8DA6",
                  marginLeft: 4,
                }}
              >
                live order topology
              </span>
              {/* Segmented view toggle (Topology active / Canonical view) */}
              <div
                className="ml-auto flex items-center"
                style={{
                  gap: 2,
                  padding: 3,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#FFFFFF",
                    background: "#2F6FE0",
                    borderRadius: 6,
                    padding: "4px 12px",
                  }}
                >
                  Topology
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#8EA2BF",
                    borderRadius: 6,
                    padding: "4px 12px",
                  }}
                >
                  Canonical view
                </span>
              </div>
            </div>

            {/* Topology */}
            <div style={{ padding: "16px 14px 14px" }}>
              <BridgeIllustration />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: "#EFF2F7",
          borderBottom: "1px solid #E2E6EE",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          className="grid w-full grid-cols-2 divide-x divide-y divide-[#E2E6EE] sm:grid-cols-4 sm:divide-y-0"
          style={{ maxWidth: 1000, textAlign: "center" }}
        >
          {STATS.map((s, i) => (
            <div key={i} style={{ padding: "30px 16px" }}>
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 36,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "#0B1A2F",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
              <div style={{ fontSize: 12.5, color: "#56627A", marginTop: 8 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Logo strip ─────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: "#FFFFFF", paddingTop: 40, paddingBottom: 40 }}>
        <p style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8A93A5", marginBottom: 24 }}>
          Trusted by procurement teams across the EU
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4" style={{ maxWidth: 920, margin: "0 auto" }}>
          {["Heinrich Industries", "Nordmark Logistik", "Steelhouse", "Centralis Pharma", "Westmark"].map((name) => (
            <span key={name} style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 17, fontWeight: 700, color: "#B7BFCC", letterSpacing: "-0.01em" }}>
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ paddingTop: "64px", paddingBottom: "64px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 99,
              background: GREEN_SOFT,
              border: `1px solid ${GREEN}40`,
              fontSize: 11.5,
              fontWeight: 600,
              color: GREEN_DEEP,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: GREEN,
                display: "inline-block",
              }}
            />
            The workflow
          </div>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#0B1A2F",
              marginBottom: 12,
            }}
          >
            Everything you need to receive, transform, and deliver
          </h2>
          <p style={{ fontSize: 16, color: "#56627A", maxWidth: 480, margin: "0 auto" }}>
            One workflow from inbound purchase order to delivered supplier document — built for procurement teams that don&apos;t want an integration project.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 20,
          }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={i}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E6EE",
                borderTop: `3px solid ${f.color}`,
                borderRadius: 10,
                padding: "26px 24px 28px",
                boxShadow: "0 1px 4px rgba(11,26,47,0.05)",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: f.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 18,
                }}
              >
                <Icon name={f.icon} color={f.color} />
              </div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 17,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  marginBottom: 9,
                  letterSpacing: "-0.01em",
                }}
              >
                {f.title}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "#56627A" }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why ProcuLink ─────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{ background: "#F6F7FA", borderBottom: "1px solid #E2E6EE", paddingTop: "64px", paddingBottom: "64px" }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 99,
                background: GREEN_SOFT,
                border: `1px solid ${GREEN}40`,
                fontSize: 11.5,
                fontWeight: 600,
                color: GREEN_DEEP,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 18,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: GREEN,
                  display: "inline-block",
                }}
              />
              Why ProcuLink
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                fontSize: "clamp(26px, 3.5vw, 38px)",
                fontWeight: 700,
                letterSpacing: "-0.025em",
                color: "#0B1A2F",
                marginBottom: 10,
              }}
            >
              Why procurement teams choose ProcuLink
            </h2>
            <p style={{ fontSize: 15.5, color: "#56627A", maxWidth: 480, margin: "0 auto" }}>
              What ProcuLink changes for teams moving from manual reformatting to automated order delivery.
            </p>
          </div>
          <div
            className="grid grid-cols-1 gap-5 sm:grid-cols-3"
          >
            {[
              {
                stat: "Skip the manual reformatting",
                body: "Teams stop hand-converting orders for each supplier. ProcuLink maps your buyer PO to exactly what each supplier needs — automatically.",
                color: BLUE,
                bg: BLUE_SOFT,
                icon: "link",
              },
              {
                stat: "Stop orders getting bounced",
                body: "Rejections for wrong item codes, missing fields, or bad formats cost hours of back-and-forth. ProcuLink validates before you send.",
                color: "#2E8E3A",
                bg: "#E2F1E2",
                icon: "check-circle",
              },
              {
                stat: "Orders out in minutes",
                body: "From uploaded PO to delivered supplier order in one workflow. No email chains, no spreadsheet wrestling, no copy-paste errors.",
                color: "#C97A14",
                bg: "#FAEFD6",
                icon: "clock",
              },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  borderLeft: `3px solid ${item.color}`,
                  borderRadius: 10,
                  padding: "28px 24px",
                  boxShadow: "0 1px 4px rgba(11,26,47,0.04)",
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 9,
                    background: item.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <Icon name={item.icon} color={item.color} />
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#0B1A2F",
                    marginBottom: 10,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.stat}
                </h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "#56627A" }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial (dark band) ─────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: "#0B1A2F",
          paddingTop: 72,
          paddingBottom: 72,
          textAlign: "center",
        }}
      >
        <figure style={{ maxWidth: 860, margin: "0 auto" }}>
          <blockquote
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(22px, 3vw, 32px)",
              fontWeight: 600,
              lineHeight: 1.4,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
              margin: 0,
            }}
          >
            &ldquo;We went from three people retyping orders into supplier portals
            to{" "}
            <span style={{ color: GREEN }}>one workflow that just delivers</span>.
            A PO that took an afternoon now goes out in under two minutes.&rdquo;
          </blockquote>

          {/* Attribution */}
          <figcaption
            className="flex items-center justify-center gap-3"
            style={{ marginTop: 28 }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#16314F",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "#86E5AC",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              MK
            </span>
            <span style={{ textAlign: "left" }}>
              <span
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#FFFFFF",
                }}
              >
                Maria Koppel
              </span>
              <span style={{ display: "block", fontSize: 13, color: "#7C8DA6" }}>
                Head of Procurement Ops · Nordic Distribution
              </span>
            </span>
          </figcaption>

          {/* Stat chips */}
          <div
            className="mx-auto mt-10 grid grid-cols-3 overflow-hidden"
            style={{
              maxWidth: 680,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
            }}
          >
            {[
              { value: "−92%", label: "time per order", green: true },
              { value: "1.7m", label: "avg delivery time", green: false },
              { value: "99.4%", label: "first-pass acceptance", green: false },
            ].map((m, i) => (
              <div
                key={m.label}
                style={{
                  padding: "22px 16px",
                  borderLeft: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: "-0.025em",
                    color: m.green ? GREEN : "#FFFFFF",
                    lineHeight: 1,
                  }}
                >
                  {m.value}
                </div>
                <div style={{ fontSize: 12, color: "#7C8DA6", marginTop: 8 }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </figure>
      </section>

      {/* ── ROI calculator ──────────────────────────────────────────── */}
      <ROICalculator />

      {/* ── CTA band ───────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: "#0B1A2F",
          paddingTop: "64px",
          paddingBottom: "64px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(28px, 4vw, 42px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "#FFFFFF",
            marginBottom: 16,
          }}
        >
          Ready to put your orders on autopilot?
        </h2>
        <p style={{ fontSize: 16, color: "#C5D2E4", marginBottom: 36 }}>
          Start free. No credit card required.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 8,
              padding: "13px 32px",
              fontSize: 14,
              fontWeight: 600,
              background: `linear-gradient(90deg, ${GREEN_DEEP}, ${GREEN})`,
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 8px 24px rgba(40,197,94,0.32)",
            }}
          >
            Get started free →
          </Link>
          <Link
            href="/pricing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 8,
              padding: "13px 32px",
              fontSize: 14,
              fontWeight: 600,
              background: "transparent",
              color: "#C5D2E4",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            See pricing
          </Link>
        </div>
      </section>

      {/* Multi-column navy footer */}
      <footer style={{ background: "#0B1A2F", color: "#9DB2CE" }}>
        <div className="mx-auto max-w-[1100px] px-6 sm:px-8" style={{ padding: "48px 24px 0" }}>
          <div className="grid gap-10 grid-cols-2 sm:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div>
              <span style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#FFFFFF", fontWeight: 700, fontSize: 17 }}>ProcuLink</span>
              <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 300, marginTop: 14 }}>
                The missing link between buyers and suppliers. Turn any purchase order into the exact
                format your supplier needs — with a full audit trail.
              </p>
              <div className="flex items-center gap-2 mt-4" style={{ fontSize: 12 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
                All systems operational
              </div>
            </div>
            {[
              { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["Open the dashboard", "/bridge"]] },
              { h: "Company", links: [["Changelog", "/changelog"], ["Support", "/support"]] },
              { h: "Legal",   links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["AUP", "/aup"], ["DPA", "/dpa"], ["Subprocessors", "/subprocessors"]] },
            ].map((col) => (
              <div key={col.h}>
                <h4 style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</h4>
                <div className="flex flex-col gap-2.5">
                  {col.links.map(([label, href]) => (
                    <a key={label} href={href} style={{ color: "#9DB2CE", fontSize: 13, textDecoration: "none" }}>{label}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-12" style={{ borderTop: "1px solid #1B2D49", padding: "18px 0 28px", fontSize: 12 }}>
            <span>© 2026 ProcuLink OÜ · Tallinn, Estonia</span>
            <span className="flex items-center gap-3"><span>EU data residency (Frankfurt)</span><span>·</span><span>AES-GCM at rest</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
