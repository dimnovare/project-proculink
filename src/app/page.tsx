import Link from "next/link";
import { BridgeIllustration } from "@/components/marketing/BridgeIllustration";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { ROICalculator } from "@/components/marketing/ROICalculator";

// ─── Static data ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "⇄",
    title: "Universal ingestion",
    desc: "CSV, XLSX, PDF, cXML, JSON, IMAP attachments — drop any purchase order format and ProcuLink parses it into a canonical structure.",
    color: "#1E66C9",
    bg: "#E3EDFB",
  },
  {
    icon: "✦",
    title: "AI-assisted mapping",
    desc: "When a buyer item code doesn&apos;t match your catalog, an LLM proposes the supplier code with confidence, reasoning, and source — your team confirms or rejects.",
    color: "#6F4FCE",
    bg: "#EEE7FB",
  },
  {
    icon: "⊞",
    title: "Order review workbench",
    desc: "Side-by-side: source document, canonical view, and exact outbound payload. Resolve exceptions before anything leaves your system.",
    color: "#C97A14",
    bg: "#FAEFD6",
  },
  {
    icon: "✓",
    title: "Per-supplier validation",
    desc: "Block bad orders before they reach the supplier. Configurable rules per supplier — missing fields, wrong currency, item codes that won&apos;t resolve.",
    color: "#2E8E3A",
    bg: "#E2F1E2",
  },
  {
    icon: "⇉",
    title: "One-click delivery",
    desc: "HTTP webhook, Erply, Directo — or download the artifact. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.",
    color: "#0F4FA8",
    bg: "#E3EDFB",
  },
  {
    icon: "◈",
    title: "Standards, on demand",
    desc: "Every canonical field maps to UBL, EDIFACT, X12, cXML and Peppol BIS — and you can see the exact path for any field, any time. Built for 30-year procurement veterans.",
    color: "#56627A",
    bg: "#EFF2F7",
  },
];

const STATS = [
  { value: "4+",     label: "Inbound formats"    },
  { value: "4+",     label: "Outbound formats"   },
  { value: "3",      label: "Delivery channels"  },
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
          your <span style={{ color: "#6BA5F0" }}>buyers</span> and{" "}
          <span style={{ color: "#5FC06B" }}>suppliers</span>
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

      {/* ── Logo strip ─────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: "#FFFFFF", paddingTop: 36, paddingBottom: 36 }}>
        <p style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A93A5", marginBottom: 22 }}>
          Connecting procurement teams to the suppliers they order from
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4" style={{ maxWidth: 880, margin: "0 auto" }}>
          {["Heinrich Industries", "Nordmark Logistik", "Steelhouse Co.", "Acme Components", "BoltWorks BV", "MedicaSupply"].map((name) => (
            <span key={name} style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: "#C2C9D4", letterSpacing: "-0.01em" }}>
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: "#F6F7FA", borderTop: "1px solid #E2E6EE", paddingTop: 56, paddingBottom: 56 }}>
        <figure style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <blockquote style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(20px, 3vw, 26px)", fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.02em", color: "#0B1A2F", margin: 0 }}>
            &ldquo;We used to keep a spreadsheet per supplier just to reformat orders. ProcuLink turned
            that into one upload-and-review. Rejections dropped to near zero.&rdquo;
          </blockquote>
          <figcaption style={{ marginTop: 20, fontSize: 13, color: "#56627A" }}>
            <span style={{ fontWeight: 600, color: "#0B1A2F" }}>Maria K.</span> · Procurement Lead, Nordic Distribution
          </figcaption>
        </figure>
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
              What ProcuLink changes for teams moving from manual reformatting to automated order delivery.
            </p>
          </div>
          <div
            className="grid grid-cols-1 gap-5 sm:grid-cols-3"
          >
            {[
              {
                stat: "Skip the manual reformatting",
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
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5FC06B", display: "inline-block" }} />
                All systems operational
              </div>
            </div>
            {[
              { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["Open the bridge", "/bridge"]] },
              { h: "Company", links: [["Customers", "/customers"], ["Changelog", "/changelog"], ["Support", "/support"]] },
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
