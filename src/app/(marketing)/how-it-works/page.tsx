import Link from "next/link";

// ─── Palette ────────────────────────────────────────────────────────────────
// Primary accent is the brand green (CSS var --brand-green / #28C55E).
// Per-step icon chips keep their category colours (blue / violet-AI / amber /
// green) to read as distinct stages, matching the design.

const NAVY = "#0B1A2F";
const INK = "#0B1A2F";
const MUTE = "#56627A";
const HAIR = "#E6E9F0";
const PANEL = "#F6F7FA";
const GREEN = "var(--brand-green)";
const GREEN_DEEP = "var(--brand-green-deep)";

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
    color: "#1E66C9",
    bg: "#E3EDFB",
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
    color: "#1E66C9",
    bg: "#E3EDFB",
    icon: <LayersIcon />,
  },
  {
    n: "03",
    title: "Resolve exceptions with AI",
    desc:
      "When a buyer item code doesn't match the supplier catalog, an LLM proposes the right code with its reasoning and source. Your team confirms or rejects — nothing is auto-applied without confidence you can see.",
    color: "#6F4FCE",
    bg: "#EEE7FB",
    icon: <SparkIcon />,
  },
  {
    n: "04",
    title: "Validate against your rules",
    desc:
      "Per-supplier rules catch missing fields, wrong currency, or unresolved codes before anything leaves your system. Bad orders never reach the supplier.",
    color: "#C97A14",
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
      { label: "EDIFACT", fg: "#C97A14", bg: "#FAEFD6" },
      { label: "X12", fg: "#1E66C9", bg: "#E3EDFB" },
    ],
  },
];

// Pipeline stages shown in the hero terminal mock.
const PIPELINE = ["Receive", "Parse", "Normalize", "Validate", "Transform", "Deliver"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* ── Hero (dark) ─────────────────────────────────────────────────── */}
      <section
        style={{
          background: `radial-gradient(120% 140% at 80% -10%, #16324F 0%, ${NAVY} 55%)`,
          padding: "84px 24px 96px",
          textAlign: "center",
        }}
      >
        <Eyebrow dark>How it works</Eyebrow>

        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(34px, 5.2vw, 56px)",
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
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: "#9FB0C7",
            maxWidth: 520,
            margin: "18px auto 0",
          }}
        >
          Five stages, one workflow. Here&apos;s exactly what happens when an
          order is sent to the supplier.
        </p>

        {/* Terminal mock + pipeline */}
        <div
          style={{
            maxWidth: 1120,
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <span style={{ display: "inline-flex", gap: 7 }}>
              <Dot c="#F2685E" />
              <Dot c="#F4BE50" />
              <Dot c="#5BCB73" />
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

          <div style={{ padding: "28px 28px 30px" }}>
            {/* Input → output badges */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                marginBottom: 26,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <MonoTag fg="#F2A1A1" bg="rgba(242,104,94,0.16)">PDF</MonoTag>
                <Arrow />
                <MonoLabel>buyer order</MonoLabel>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <MonoLabel style={{ color: GREEN }}>supplier output</MonoLabel>
                <MonoTag fg="#A9F0BE" bg="rgba(40,197,94,0.16)">CXML</MonoTag>
              </span>
            </div>

            {/* Stage rail */}
            <div
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: `repeat(${PIPELINE.length}, 1fr)`,
                alignItems: "start",
                marginBottom: 28,
              }}
            >
              {/* connecting line */}
              <div
                style={{
                  position: "absolute",
                  top: 7,
                  left: `${100 / PIPELINE.length / 2}%`,
                  right: `${100 / PIPELINE.length / 2}%`,
                  height: 2,
                  background:
                    "linear-gradient(90deg, rgba(40,197,94,0.15), rgba(40,197,94,0.55) 50%, rgba(40,197,94,0.15))",
                }}
              />
              {PIPELINE.map((label, i) => (
                <div
                  key={label}
                  style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: i === 0 ? GREEN : NAVY,
                      border: `2px solid ${i === 0 ? GREEN : "rgba(255,255,255,0.28)"}`,
                      boxShadow: i === 0 ? "0 0 0 4px rgba(40,197,94,0.18)" : "none",
                      zIndex: 1,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: i === 0 ? 700 : 500,
                      color: i === 0 ? "#FFFFFF" : "#7E8DA3",
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* Data cells */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 14,
              }}
            >
              <DataCell label="PO Number" value="PO-2026-008412" />
              <DataCell label="Grand Total" value="€71,240.00" />
              <DataCell label="Ship To" value="Dortmund, DE" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Steps (light) ───────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px 88px", maxWidth: 860, margin: "0 auto" }}>
        {STEPS.map((step, i) => (
          <div key={step.n}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr",
                gap: 24,
                padding: "28px 0",
              }}
            >
              {/* Big number */}
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 40,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "#D5DAE3",
                  letterSpacing: "-0.02em",
                  paddingTop: 4,
                }}
              >
                {step.n}
              </div>

              {/* Content */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
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
                    style={{
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                      fontSize: "clamp(20px, 2.6vw, 25px)",
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
                  style={{
                    fontSize: 15.5,
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
        style={{
          background: PANEL,
          borderTop: `1px solid ${HAIR}`,
          padding: "84px 24px 92px",
          textAlign: "center",
        }}
      >
        <Eyebrow>See it live</Eyebrow>
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(28px, 4vw, 42px)",
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
          style={{
            fontSize: 16,
            lineHeight: 1.65,
            color: MUTE,
            maxWidth: 470,
            margin: "16px auto 0",
          }}
        >
          Open the product and resolve an exception yourself — the review
          workbench is interactive.
        </p>
        <div style={{ marginTop: 34 }}>
          <Link
            href="/watch"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              background: GREEN,
              color: "#FFFFFF",
              textDecoration: "none",
              boxShadow: "0 8px 22px -8px rgba(40,197,94,0.55)",
            }}
          >
            Open the workbench
            <ArrowRight />
          </Link>
        </div>
      </section>
    </div>
  );
}

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
        color: dark ? "#A9F0BE" : GREEN_DEEP,
        background: dark ? "rgba(40,197,94,0.12)" : "var(--brand-green-soft)",
        border: dark ? "1px solid rgba(40,197,94,0.25)" : "1px solid #C5EFD2",
        borderRadius: 999,
        padding: "5px 12px",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: dark ? "#5BCB73" : GREEN,
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

function MonoTag({ children, fg, bg }: { children: React.ReactNode; fg: string; bg: string }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        color: fg,
        background: bg,
        padding: "3px 8px",
        borderRadius: 6,
      }}
    >
      {children}
    </span>
  );
}

function MonoLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12.5,
        color: "#9FB0C7",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6C7C93",
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 14,
          fontWeight: 600,
          color: "#CBD6E6",
        }}
      >
        {value}
      </div>
    </div>
  );
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

function Arrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6C7C93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
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
