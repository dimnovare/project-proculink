import Link from "next/link";
import { BridgeIllustration } from "@/components/marketing/BridgeIllustration";
import { MarketingNav } from "@/components/marketing/MarketingNav";

// ─── Static data ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "⇄",
    title: "Wire topology",
    desc: "See every buyer-to-supplier wire at a glance. Health, volume, and alerts mapped onto one live canvas.",
    color: "#1E66C9",
    bg: "#E3EDFB",
  },
  {
    icon: "✦",
    title: "AI extraction",
    desc: "PDFs, emails, EDI, XLSX — our engine pulls structured data from any format with per-field confidence scores.",
    color: "#6F4FCE",
    bg: "#EEE7FB",
  },
  {
    icon: "⊞",
    title: "Spine review",
    desc: "Three-column anatomy: document on the left, spine nodes in the middle, output preview on the right.",
    color: "#C97A14",
    bg: "#FAEFD6",
  },
  {
    icon: "✓",
    title: "Validation rules",
    desc: "Configurable rule engine with error/warning/info severity, entity scoping, and auto-block for critical violations.",
    color: "#2E8E3A",
    bg: "#E2F1E2",
  },
  {
    icon: "⇉",
    title: "One-click crossing",
    desc: "When everything checks out, bridge the order with one click. cXML, EDI, or API — delivered to the supplier dock.",
    color: "#0F4FA8",
    bg: "#E3EDFB",
  },
];

const STATS = [
  { value: "84%",    label: "Auto-processed"     },
  { value: "1m 42s", label: "Avg crossing time"  },
  { value: "€4.20",  label: "Cost per crossing"  },
  { value: "99.7%",  label: "Uptime SLA"         },
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
          background: "#0B1A2F",
          paddingTop: "60px",
          paddingBottom: "48px",
          textAlign: "center",
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
              "linear-gradient(rgba(30,102,201,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(30,102,201,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            pointerEvents: "none",
          }}
        />

        {/* Eyebrow */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 99,
            padding: "4px 14px",
            background: "rgba(30,102,201,0.2)",
            border: "1px solid rgba(30,102,201,0.35)",
            marginBottom: 28,
            position: "relative",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#1E66C9",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#7FB3F5",
            }}
          >
            B2B order automation
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(38px, 6vw, 64px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            color: "#FFFFFF",
            maxWidth: 720,
            margin: "0 auto 24px",
            position: "relative",
          }}
        >
          The bridge between
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            your buyers and suppliers
          </span>
        </h1>

        {/* Sub */}
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: "#C5D2E4",
            maxWidth: 520,
            margin: "0 auto 40px",
            position: "relative",
          }}
        >
          ProcuLink transforms unstructured purchase orders into structured
          supplier transactions — automatically, with a full audit trail.
        </p>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            position: "relative",
          }}
        >
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 4px 20px rgba(30,102,201,0.4)",
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
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              background: "rgba(255,255,255,0.08)",
              color: "#FFFFFF",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            See how it works
          </Link>
        </div>

        {/* Illustration */}
        <div
          style={{
            maxWidth: 820,
            margin: "56px auto 0",
            padding: "32px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            position: "relative",
          }}
        >
          {/* Glow */}
          <div
            style={{
              position: "absolute",
              bottom: -40,
              left: "50%",
              transform: "translateX(-50%)",
              width: 500,
              height: 80,
              background: "radial-gradient(ellipse, rgba(30,102,201,0.25), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <BridgeIllustration />
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: "#F6F7FA",
          borderBottom: "1px solid #E2E6EE",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          className="grid w-full grid-cols-2 divide-x divide-y divide-[#E2E6EE] sm:grid-cols-4 sm:divide-y-0"
          style={{ maxWidth: 900, textAlign: "center" }}
        >
          {STATS.map((s, i) => (
            <div key={i} style={{ padding: "28px 16px" }}
            >
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "#0B1A2F",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
              <div style={{ fontSize: 12.5, color: "#56627A", marginTop: 6 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ paddingTop: "64px", paddingBottom: "64px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
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
            Everything in one bridge
          </h2>
          <p style={{ fontSize: 16, color: "#56627A", maxWidth: 480, margin: "0 auto" }}>
            Five spatial signatures, one coherent system.
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
                borderRadius: 10,
                padding: "28px 24px",
                boxShadow: "0 1px 4px rgba(11,26,47,0.05)",
                borderLeft: `3px solid ${f.color}`,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  background: f.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  color: f.color,
                  marginBottom: 16,
                }}
              >
                {f.icon}
              </div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 17,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  marginBottom: 8,
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
              Real results from teams that moved from manual reformatting to automated order delivery.
            </p>
          </div>
          <div
            className="grid grid-cols-1 gap-5 sm:grid-cols-3"
          >
            {[
              {
                stat: "60% fewer reformatting tasks",
                body: "Procurement teams stop manually converting orders for each supplier. ProcuLink maps your buyer PO format to what each supplier actually needs — automatically.",
                color: "#1E66C9",
                bg: "#E3EDFB",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1E66C9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 10l4 4 8-8" />
                    <rect x="1" y="1" width="18" height="18" rx="3" />
                  </svg>
                ),
              },
              {
                stat: "Stop orders getting bounced back",
                body: "Supplier rejections for wrong item codes, missing fields, or incorrect file formats cost hours of back-and-forth. ProcuLink validates before you send.",
                color: "#2E8E3A",
                bg: "#E2F1E2",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#2E8E3A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 18s7-3.5 7-8.75V3.5L10 1 3 3.5v5.75C3 14.5 10 18 10 18z" />
                    <path d="M7 10l2 2 4-4" />
                  </svg>
                ),
              },
              {
                stat: "Orders out in minutes, not hours",
                body: "From uploaded PO to delivered supplier order in one workflow. No email chains, no spreadsheet wrestling, no copy-paste errors across formats.",
                color: "#C97A14",
                bg: "#FAEFD6",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#C97A14" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10" cy="10" r="8.5" />
                    <polyline points="10 5.5 10 10.5 13.5 12.5" />
                  </svg>
                ),
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
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: item.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  {item.icon}
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
          Ready to bridge your orders?
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
              background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 4px 20px rgba(30,102,201,0.35)",
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

      {/* Footer */}
      <footer
        className="px-4 sm:px-8"
        style={{
          borderTop: "1px solid #E2E6EE",
          background: "#F6F7FA",
          paddingTop: "36px",
          paddingBottom: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 14,
            fontWeight: 700,
            color: "#0B1A2F",
          }}
        >
          ProcuLink
        </span>
        <div style={{ display: "flex", gap: 24, fontSize: 12.5, color: "#8A93A5" }}>
          <a href="/pricing" style={{ color: "inherit" }}>Pricing</a>
          <a href="/how-it-works" style={{ color: "inherit" }}>How it works</a>
          <a href="/sign-in" style={{ color: "inherit" }}>Sign in</a>
        </div>
        <span style={{ fontSize: 12, color: "#8A93A5" }}>
          © 2026 Estoria Capital Group OÜ
        </span>
      </footer>
    </div>
  );
}
