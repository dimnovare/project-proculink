import type { Metadata } from "next";
import Link from "next/link";
import AnimatedPipelinePanel from "./AnimatedPipelinePanel";

export const metadata: Metadata = {
  title: "How it works — ProcuLink",
  description:
    "Parse, normalize, validate, review, transform, and deliver purchase orders — from any format to each supplier's required format and channel. See the pipeline step by step.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How it works — ProcuLink",
    description:
      "From any order format to each supplier's required format and channel — the ProcuLink pipeline, step by step.",
    url: "/how-it-works",
  },
};

// ─── Palette (sampled pixel-exact from the 2026-05-30 design render) ──────────
// The page follows a buyer → supplier topology:
//   • buyer / process / primary-CTA elements use buyer-blue  (#1E66C9)
//   • supplier-output / success elements use brand-green      (#28C55E family)
//   • AI = violet (#6F4FCE), validation = amber (#C97A14)
// Hexes below were sampled directly from the design render, not eyeballed.

const NAVY = "#0B1A2F";
const INK = "#0B1A2F";
const MUTE = "#56627A";
const HAIR = "#E6E9F0";
const PANEL = "#F6F7FA";

const BLUE = "#1E66C9"; // buyer-blue — CTA, early-stage chips, first pipeline node
const BLUE_SOFT = "#E3EDFB"; // pale blue chip / eyebrow background
const BLUE_NODE = "#2D7AE0"; // used in Eyebrow dot
const VIOLET = "#6F4FCE";
const AMBER = "#C97A14";

// ─── Steps ────────────────────────────────────────────────────────────────────

type Pill = { label: string; fg: string; bg: string };

const STEPS: Array<{
  n: string;
  title: string;
  desc: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
  pills?: Pill[];
}> = [
  {
    n: "01",
    title: "Receive in any format",
    desc:
      "Buyers send POs however they like — a PDF email attachment, an XLSX export, cXML over webhook, EDI dropped on SFTP. ProcuLink ingests all of it through one inbox.",
    color: BLUE,
    bg: BLUE_SOFT,
    icon: <UploadIcon />,
    pills: [
      { label: "PDF", fg: "#B4452B", bg: "#FBE7E1" },
      { label: "XLSX", fg: "#2E8E3A", bg: "#E2F1E2" },
      { label: "CXML", fg: "#6F4FCE", bg: "#EEE7FB" },
      { label: "EDI", fg: "#C97A14", bg: "#FAEFD6" },
      { label: "CSV", fg: "#56627A", bg: "#EEF1F6" },
    ],
  },
  {
    n: "02",
    title: "Parse to a canonical order",
    desc:
      "Every order is parsed into one neutral structure — the canonical order. PO number, parties, line items, terms and totals each become a field with a confidence score and visible provenance.",
    color: BLUE,
    bg: BLUE_SOFT,
    icon: <LayersIcon />,
  },
  {
    n: "03",
    title: "Resolve exceptions with AI",
    desc:
      "When a buyer item code doesn't match the supplier catalog, an LLM proposes the right code with its reasoning and source. Your team confirms or rejects — nothing is auto-applied without confidence you can see.",
    color: VIOLET,
    bg: "#EEE7FB",
    icon: <SparkIcon />,
  },
  {
    n: "04",
    title: "Validate against your rules",
    desc:
      "Per-supplier rules catch missing fields, wrong currency, or unresolved codes before anything leaves your system. Bad orders never reach the supplier.",
    color: AMBER,
    bg: "#FAEFD6",
    icon: <CheckSquareIcon />,
  },
  {
    n: "05",
    title: "Transform & deliver",
    desc:
      "The canonical order is transformed into the exact format the supplier requires and delivered over their channel — webhook, SFTP, email or ERP connector. Every attempt is logged in an append-only audit trail.",
    color: "#2E8E3A",
    bg: "#E2F1E2",
    icon: <SendIcon />,
    pills: [
      { label: "CXML", fg: "#6F4FCE", bg: "#EEE7FB" },
      { label: "UBL", fg: "#56627A", bg: "#EEF1F6" },
      { label: "CSV", fg: "#2E8E3A", bg: "#E2F1E2" },
      { label: "JSON", fg: "#C97A14", bg: "#FAEFD6" },
    ],
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      <style>{responsiveCss}</style>

      {/* ── Hero (dark) ─────────────────────────────────────────────────── */}
      <section
        className="hiw-hero"
        style={{
          background: `radial-gradient(105% 120% at 50% -8%, #0E2545 0%, ${NAVY} 58%)`,
          textAlign: "center",
        }}
      >
        <Eyebrow dark>How it works</Eyebrow>

        <h1
          className="hiw-h1"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            color: "#FFFFFF",
            margin: "20px auto 0",
            maxWidth: 640,
            lineHeight: 1.08,
          }}
        >
          From any purchase order to a delivered supplier document
        </h1>

        <p
          className="hiw-hero-sub"
          style={{
            lineHeight: 1.6,
            color: "#9FB0C7",
            maxWidth: 520,
            margin: "18px auto 0",
          }}
        >
          Six stages, one workflow. Here&apos;s exactly what happens when an
          order is sent to the supplier.
        </p>

        {/* Terminal mock + pipeline */}
        <div
          className="hiw-terminal"
          style={{
            maxWidth: 1116,
            margin: "44px auto 0",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 16,
            boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55)",
            overflow: "hidden",
            textAlign: "left",
          }}
        >
          {/* Title bar */}
          <div
            className="hiw-term-bar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <span style={{ display: "inline-flex", gap: 7 }}>
              <Dot c="#E05A52" />
              <Dot c="#E0B13A" />
              <Dot c="#3FA84C" />
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 12.5,
                color: "#7E8DA3",
                marginLeft: 6,
              }}
            >
              order pipeline
            </span>
          </div>

          <div className="hiw-term-body" style={{ padding: "28px 28px 30px" }}>
            <AnimatedPipelinePanel />
          </div>
        </div>
      </section>

      {/* ── Steps (light) ───────────────────────────────────────────────── */}
      <section className="hiw-steps" style={{ maxWidth: 860, margin: "0 auto" }}>
        {STEPS.map((step, i) => (
          <div key={step.n}>
            <div className="hiw-step-row">
              {/* Big number */}
              <div
                className="hiw-step-num"
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "#C6CDDA",
                  letterSpacing: "-0.02em",
                }}
              >
                {step.n}
              </div>

              {/* Content */}
              <div>
                <div className="hiw-step-head" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      background: step.bg,
                      color: step.color,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {step.icon}
                  </span>
                  <h2
                    className="hiw-step-title"
                    style={{
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: INK,
                      lineHeight: 1.15,
                      margin: 0,
                    }}
                  >
                    {step.title}
                  </h2>
                </div>

                <p
                  className="hiw-step-desc"
                  style={{
                    lineHeight: 1.7,
                    color: MUTE,
                    maxWidth: 560,
                    margin: 0,
                  }}
                >
                  {step.desc}
                </p>

                {step.pills && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 16 }}>
                    {step.pills.map((p) => (
                      <span
                        key={p.label}
                        style={{
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                          color: p.fg,
                          background: p.bg,
                          padding: "4px 8px",
                          borderRadius: 6,
                        }}
                      >
                        {p.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {i < STEPS.length - 1 && (
              <div style={{ height: 1, background: HAIR }} />
            )}
          </div>
        ))}
      </section>

      {/* ── CTA band (light gray) ───────────────────────────────────────── */}
      <section
        className="hiw-cta"
        style={{
          background: PANEL,
          borderTop: `1px solid ${HAIR}`,
          textAlign: "center",
        }}
      >
        <Eyebrow>See it live</Eyebrow>
        <h2
          className="hiw-cta-title"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: INK,
            margin: "18px auto 0",
            maxWidth: 620,
            lineHeight: 1.1,
          }}
        >
          Walk through a real delivery
        </h2>
        <p
          className="hiw-cta-sub"
          style={{
            lineHeight: 1.65,
            color: MUTE,
            maxWidth: 470,
            margin: "16px auto 0",
          }}
        >
          Watch a single upload become a delivered supplier order — parsed,
          mapped, validated, and sent.
        </p>
        <div style={{ marginTop: 34 }}>
          <Link
            href="/watch"
            className="hiw-cta-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              background: BLUE,
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 8px 22px -8px rgba(30,102,201,0.55)",
            }}
          >
            Watch the walkthrough
            <ArrowRight />
          </Link>
        </div>
      </section>
    </div>
  );
}

// ─── Responsive CSS (scoped via hiw- classes; keeps this a Server Component) ────

const responsiveCss = `
.hiw-hero { padding: 84px 24px 96px; }
.hiw-h1 { font-size: clamp(34px, 5.2vw, 56px); }
.hiw-hero-sub { font-size: 17px; }

/* Terminal — layout lives in classes (not inline) so the breakpoint can override it */
.hiw-io { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.hiw-rail { display: grid; grid-template-columns: repeat(6, 1fr); align-items: start; }
.hiw-rail-line { top: 7px; left: 8.3333%; right: 8.3333%; height: 2px; }
.hiw-node { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.hiw-cells { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }

.hiw-steps { padding: 80px 24px 88px; }
.hiw-step-row { display: grid; grid-template-columns: 72px 1fr; gap: 24px; padding: 28px 0; }
.hiw-step-num { font-size: 40px; padding-top: 4px; }
.hiw-step-title { font-size: clamp(20px, 2.6vw, 25px); }
.hiw-step-desc { font-size: 15.5px; }
.hiw-cta { padding: 84px 24px 92px; }
.hiw-cta-title { font-size: clamp(28px, 4vw, 42px); }
.hiw-cta-sub { font-size: 16px; }

@media (max-width: 640px) {
  .hiw-hero { padding: 56px 18px 60px; }
  .hiw-h1 { font-size: 30px; max-width: 100%; }
  .hiw-hero-sub { font-size: 15px; }
  .hiw-terminal { margin-top: 32px; border-radius: 13px; }
  .hiw-term-bar { padding: 12px 16px; }
  .hiw-term-body { padding: 20px 16px 22px; }
  /* Input → output: stack the two halves vertically, full-width */
  .hiw-io { flex-direction: column; align-items: flex-start; gap: 12px; }
  /* Stage rail becomes a vertical list of labelled nodes */
  .hiw-rail { grid-template-columns: 1fr; }
  .hiw-node { flex-direction: row; align-items: center; gap: 12px; padding: 7px 0; }
  .hiw-node > span:last-child { font-size: 14px; }
  .hiw-rail-line { left: 6px; right: auto; top: 14px; bottom: 14px; width: 2px; height: auto; }
  /* Data cells stack to one column */
  .hiw-cells { grid-template-columns: 1fr; gap: 10px; }

  /* Steps: number sits inline above the content, tighter rhythm */
  .hiw-steps { padding: 44px 18px 48px; }
  .hiw-step-row { grid-template-columns: 1fr; gap: 6px; padding: 22px 0; }
  .hiw-step-num { font-size: 26px; padding-top: 0; }
  .hiw-step-head { gap: 11px; margin-bottom: 11px; }
  .hiw-step-title { font-size: 20px; }
  .hiw-step-desc { font-size: 14px; }

  .hiw-cta { padding: 52px 18px 56px; }
  .hiw-cta-title { font-size: 26px; }
  .hiw-cta-sub { font-size: 14px; }
  .hiw-cta-btn { padding: 13px 24px; }
}
`;

// ─── Small presentational helpers ──────────────────────────────────────────────

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: dark ? "#AFC6EA" : BLUE,
        background: dark ? "rgba(30,102,201,0.10)" : BLUE_SOFT,
        border: dark ? "1px solid rgba(30,102,201,0.30)" : "1px solid #CBDDF6",
        borderRadius: 999,
        padding: "5px 12px",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: dark ? BLUE_NODE : BLUE,
          display: "inline-block",
        }}
      />
      {children}
    </span>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ width: 11, height: 11, borderRadius: "50%", background: c, display: "inline-block" }} />;
}

// ─── Icons (inline, stroke = currentColor) ─────────────────────────────────────

function UploadIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function CheckSquareIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
