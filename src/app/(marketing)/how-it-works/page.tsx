import { BridgeIllustration } from "@/components/marketing/BridgeIllustration";
import Link from "next/link";

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    title: "Upload your source document",
    desc: "Drop a PDF, attach an EDI file, forward an email, or connect an API. ProcuLink accepts every format your buyers send — without any pre-processing.",
    detail: [
      "PDF (scanned & digital)",
      "XLSX / CSV",
      "EDI X12 850",
      "cXML PunchOut",
      "Plain-text email",
      "REST API payload",
    ],
    color: "#1E66C9",
    bg: "#E3EDFB",
    icon: "↑",
  },
  {
    n: "02",
    title: "Extract with field-level confidence",
    desc: "Our AI engine reads the document and extracts header, line item, and footer data — annotating each field with a confidence score. You see exactly where it's certain and where it needs a second look.",
    detail: [
      "Per-field confidence 0–100%",
      "Zone anatomy overlay",
      "Ambiguity highlighting",
      "Raw-value audit trail",
    ],
    color: "#6F4FCE",
    bg: "#EEE7FB",
    icon: "✦",
  },
  {
    n: "03",
    title: "Map buyer codes to supplier codes",
    desc: "Every buyer calls a bolt something different. The Mapping Editor translates buyer part numbers into supplier codes — learning from each order to improve over time.",
    detail: [
      "AI-suggested mappings",
      "Manual override",
      "CSV bulk import",
      "Confidence bar per translation",
    ],
    color: "#C97A14",
    bg: "#FAEFD6",
    icon: "⇄",
  },
  {
    n: "04",
    title: "Validate against your rules",
    desc: "Configurable rules check for missing prices, past delivery dates, unknown codes, and total mismatches. Critical violations auto-block. Warnings go to review.",
    detail: [
      "Error / warning / info severity",
      "Auto-block on critical rules",
      "Per-entity scope (header, line, supplier…)",
      "Custom rule builder",
    ],
    color: "#2E8E3A",
    bg: "#E2F1E2",
    icon: "✓",
  },
  {
    n: "05",
    title: "Deliver to supplier",
    desc: "One click. The structured order is delivered to the supplier endpoint in their preferred format — cXML, EDI, JSON, or HTTP webhook — with a full audit entry in the Delivery Log.",
    detail: [
      "cXML PunchOut delivery",
      "EDI X12 860 response",
      "API endpoint push",
      "Delivery ACK recorded",
    ],
    color: "#2E8E3A",
    bg: "#E2F1E2",
    icon: "⇉",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* Hero */}
      <section
        style={{
          padding: "72px 32px 56px",
          textAlign: "center",
          borderBottom: "1px solid #E2E6EE",
          background: "#F6F7FA",
        }}
      >
        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(32px, 5vw, 52px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#0B1A2F",
            marginBottom: 14,
            maxWidth: 720,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.1,
          }}
        >
          From any purchase order to a delivered supplier document
        </h1>
        <p style={{ fontSize: 16, color: "#56627A", maxWidth: 520, margin: "0 auto 32px" }}>
          Five stages, one bridge — watch an order cross from raw buyer document to a
          delivered supplier order, fully audited.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 48 }}>
          <Link href="/watch" style={{ display: "inline-flex", alignItems: "center", borderRadius: 8, padding: "11px 24px", fontSize: 13.5, fontWeight: 600, background: "#1E66C9", color: "#FFFFFF", textDecoration: "none" }}>
            Walk through a real crossing →
          </Link>
          <Link href="/sign-up" style={{ display: "inline-flex", alignItems: "center", borderRadius: 8, padding: "11px 24px", fontSize: 13.5, fontWeight: 600, background: "#FFFFFF", color: "#0B1A2F", textDecoration: "none", border: "1px solid #E2E6EE" }}>
            Start free
          </Link>
        </div>

        {/* Pipeline bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0,
            maxWidth: 720,
            margin: "0 auto",
            flexWrap: "wrap",
          }}
        >
          {STEPS.map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: step.bg,
                    border: `2px solid ${step.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    color: step.color,
                    fontWeight: 700,
                  }}
                >
                  {step.icon}
                </div>
                <span style={{ fontSize: 10.5, color: "#8A93A5", fontWeight: 600 }}>
                  {step.n}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    width: 48,
                    height: 2,
                    background:
                      i === 0
                        ? "linear-gradient(90deg, #1E66C9, #6F4FCE)"
                        : i === 1
                        ? "linear-gradient(90deg, #6F4FCE, #C97A14)"
                        : i === 2
                        ? "linear-gradient(90deg, #C97A14, #2E8E3A)"
                        : "linear-gradient(90deg, #2E8E3A, #2E8E3A)",
                    margin: "0 4px",
                    marginBottom: 20,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section style={{ padding: "72px 32px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 64 }}>
          {STEPS.map((step, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: i % 2 === 0 ? "1fr 320px" : "320px 1fr",
                gap: 48,
                alignItems: "center",
              }}
            >
              {/* Text block */}
              <div style={{ order: i % 2 === 0 ? 0 : 1 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: step.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      color: step.color,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {step.icon}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: step.color,
                    }}
                  >
                    Step {step.n}
                  </span>
                </div>

                <h2
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: "clamp(22px, 3vw, 30px)",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#0B1A2F",
                    marginBottom: 14,
                    lineHeight: 1.2,
                  }}
                >
                  {step.title}
                </h2>
                <p
                  style={{
                    fontSize: 14.5,
                    lineHeight: 1.7,
                    color: "#56627A",
                    marginBottom: 20,
                  }}
                >
                  {step.desc}
                </p>

                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                  {step.detail.map((d, j) => (
                    <li
                      key={j}
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: step.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: "#56627A" }}>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual card */}
              <div
                style={{
                  order: i % 2 === 0 ? 1 : 0,
                  background: "#F6F7FA",
                  border: `1px solid #E2E6EE`,
                  borderLeft: `3px solid ${step.color}`,
                  borderRadius: 10,
                  padding: "32px 24px",
                  minHeight: 180,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: step.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 26,
                    color: step.color,
                  }}
                >
                  {step.icon}
                </div>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#0B1A2F",
                    textAlign: "center",
                  }}
                >
                  {step.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: step.color,
                    background: step.bg,
                    padding: "3px 10px",
                    borderRadius: 99,
                  }}
                >
                  Step {step.n}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Wire illustration */}
      <section
        style={{
          background: "#0B1A2F",
          padding: "72px 32px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(26px, 4vw, 38px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "#FFFFFF",
            marginBottom: 12,
          }}
        >
          Every route, live on one canvas
        </h2>
        <p style={{ fontSize: 15, color: "#C5D2E4", marginBottom: 48, maxWidth: 440, margin: "0 auto 48px" }}>
          The Wire Topology view shows all your buyer-supplier wires, their health, and in-flight orders at a glance.
        </p>
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto 48px",
            padding: "32px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
          }}
        >
          <BridgeIllustration />
        </div>
        <Link
          href="/sign-up"
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 8,
            padding: "12px 32px",
            fontSize: 14,
            fontWeight: 600,
            background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
            color: "#FFFFFF",
            textDecoration: "none",
            boxShadow: "0 4px 20px rgba(30,102,201,0.35)",
          }}
        >
          Start bridging free →
        </Link>
      </section>
    </div>
  );
}
