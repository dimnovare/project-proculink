import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { STAGES } from "@/components/bridge/StatusJourney";
import AnimatedPipelinePanel from "./AnimatedPipelinePanel";

export const metadata = pageMetadata({
  path: "/how-it-works",
  title: "How it works — ProcuLink",
  description:
    "Read it. Check it. Transform it. Send it. ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
  ogDescription:
    "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
});

// ─── Palette — ALIASES for the design tokens, never copies of their values ────
// The page follows a buyer → supplier topology:
//   • buyer / process / primary-CTA elements use buyer-blue  (--brand-blue)
//   • supplier-output / success elements use forest green    (--brand-green)
//   • AI = violet (--ai), validation = amber (--amber-text, AA-darkened)
//
// These were hex copies "sampled pixel-exact from the design render". Sampling a
// render is how a page ends up a generation behind the tokens: BLUE_SOFT still
// held the previous generation's value, and the header comment above described
// the green family by one of the three emerald greens that
// 11-unified-page-rules.md explicitly BANS. Enforced by scripts/check-tokens.mjs.

const NAVY = "var(--navy)";
const INK = "var(--ink)";
const MUTE = "var(--ink-muted)";
const HAIR = "var(--border)";
const PANEL = "var(--bg)";

const BLUE = "var(--brand-blue)"; // buyer-blue — CTA, early-stage chips, first pipeline node
const BLUE_SOFT = "var(--brand-blue-soft)"; // pale blue chip / eyebrow background
const AMBER = "var(--amber-text)";
// Supplier/output green. --brand-green on --brand-green-soft is 3.55:1 and fails
// AA for the 11px pill text this page draws; --brand-green-deep is 5.57:1.
const GREEN = "var(--brand-green-deep)";
const GREEN_SOFT = "var(--brand-green-soft)";
const AMBER_SOFT = "var(--amber-soft)";

// ─── The four steps ────────────────────────────────────────────────────────────
// Titles are Copy C14. The paragraphs are long-form, approved on the preview, and
// claim only what every engine-on org has: text-layer PDF, CSV and Excel in, plus
// the formats and scans switches (D1); the intake channels and output formats the
// flow engine really offers; the visible check and the duplicate hold.

const WORKFLOW: Array<{ title: string; desc: string; color: string; bg: string; icon: React.ReactNode }> = [
  {
    title: "Send it",
    desc: "Upload a file, forward an email to the address your flow gives you, or let ProcuLink collect files from a mailbox, an SFTP, FTP or FTPS server, an S3 bucket, or our API. PDFs with a text layer, CSV and Excel files are read, and so are Word, text, XML and JSON files.",
    color: BLUE,
    bg: BLUE_SOFT,
    icon: <UploadIcon />,
  },
  {
    title: "We read it",
    desc: "We read every value and every table on the first document, row by row. There is no template to build first, so a new sender with a new layout does not mean new setup. Scans and phone photos are read too.",
    color: BLUE,
    bg: BLUE_SOFT,
    icon: <LayersIcon />,
  },
  {
    title: "You check it",
    desc: "The original stays on screen beside what we read. Fix a value that is wrong, or draw a box around it on the page so we find it in the same place next time. We flag a total that does not add up or a value that is missing, and we hold a document we have already seen instead of sending it twice.",
    color: AMBER,
    bg: AMBER_SOFT,
    icon: <CheckSquareIcon />,
  },
  {
    title: "We send it",
    desc: "Choose CSV, JSON, XML, Excel, PDF, text or fixed-width, then send the result by email, to a web address, to an SFTP or FTPS server, or download it. Have your receiving system's documentation? Upload it and we propose the output for you to check.",
    color: GREEN,
    bg: GREEN_SOFT,
    icon: <SendIcon />,
  },
];

export default function HowItWorksPage() {
  return (
    <div style={{ background: "var(--surface)" }}>
      <style>{responsiveCss}</style>

      {/* ── Hero (dark) ─────────────────────────────────────────────────── */}
      <section
        className="hiw-hero"
        style={{
          background: `radial-gradient(105% 120% at 50% -8%, var(--navy-glow) 0%, ${NAVY} 58%)`,
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
            color: "var(--surface)",
            margin: "20px auto 0",
            maxWidth: 720,
            lineHeight: 1.08,
          }}
        >
          Read it. Check it. Transform it. Send it.
        </h1>

        <p
          className="hiw-hero-sub"
          style={{
            lineHeight: 1.6,
            color: "var(--navy-faint)",
            maxWidth: 600,
            margin: "18px auto 0",
          }}
        >
          ProcuLink reads the files you receive, shows what it read beside the
          original, and sends the data on in the format your system needs.
        </p>
        <p
          className="hiw-hero-sub"
          style={{
            lineHeight: 1.6,
            color: "var(--navy-faint)",
            maxWidth: 600,
            margin: "12px auto 0",
          }}
        >
          Scans and phone photos are read too.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 32 }}>
          <Link
            href="/sign-up"
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
              color: "var(--surface)",
              textDecoration: "none",
            }}
          >
            Start your free trial
            <ArrowRight />
          </Link>
          <a
            href="#pipeline"
            className="hiw-cta-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 9,
              padding: "13px 22px",
              fontSize: 14.5,
              fontWeight: 600,
              color: "var(--navy-pale)",
              textDecoration: "none",
            }}
          >
            For technical readers: the pipeline ↓
          </a>
        </div>
      </section>

      {/* ── The workflow (light) — what a buyer does, first ─────────────── */}
      <section className="hiw-steps" style={{ maxWidth: 860, margin: "0 auto" }} aria-labelledby="hiw-workflow-title">
        <div style={{ textAlign: "center" }}>
          <Eyebrow>The workflow</Eyebrow>
          <h2
            id="hiw-workflow-title"
            className="hiw-section-title"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: INK,
              margin: "16px auto 0",
              maxWidth: 620,
              lineHeight: 1.12,
            }}
          >
            How it works
          </h2>
        </div>
        <ol style={{ listStyle: "none", padding: 0, margin: "28px 0 0" }}>
          {WORKFLOW.map((step, i) => (
            <li key={step.title}>
              <StepRow n={String(i + 1).padStart(2, "0")} {...step} />
              {i < WORKFLOW.length - 1 && <div style={{ height: 1, background: HAIR }} />}
            </li>
          ))}
        </ol>
      </section>

      {/* ── The pipeline (dark) — for technical readers ─────────────────── */}
      <section
        id="pipeline"
        className="hiw-hero"
        style={{
          background: `radial-gradient(105% 120% at 50% -8%, var(--navy-glow) 0%, ${NAVY} 58%)`,
          textAlign: "center",
          scrollMarginTop: 70,
        }}
        aria-labelledby="hiw-pipeline-title"
      >
        <Eyebrow dark>For technical readers</Eyebrow>

        <h2
          id="hiw-pipeline-title"
          className="hiw-section-title"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "var(--surface)",
            margin: "20px auto 0",
            maxWidth: 680,
            lineHeight: 1.1,
          }}
        >
          {STAGES.join(" · ")}
        </h2>

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
              <Dot c="var(--dot-red)" />
              <Dot c="var(--dot-amber)" />
              <Dot c="var(--dot-green)" />
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 12.5,
                color: "var(--navy-muted)",
                marginLeft: 6,
              }}
            >
              pipeline
            </span>
          </div>

          <div className="hiw-term-body" style={{ padding: "28px 28px 30px" }}>
            <AnimatedPipelinePanel />
          </div>
        </div>
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
        <h2
          className="hiw-cta-title"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: INK,
            margin: "0 auto",
            maxWidth: 620,
            lineHeight: 1.1,
          }}
        >
          Try it on your own documents
        </h2>
        <div style={{ marginTop: 34, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href="/sign-up"
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
              color: "var(--surface)",
              textDecoration: "none",
              boxShadow: "0 8px 22px -8px rgba(30,102,201,0.55)",
            }}
          >
            Start your free trial
            <ArrowRight />
          </Link>
          <Link
            href="/book-demo"
            className="hiw-cta-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 9,
              padding: "13px 26px",
              fontSize: 14.5,
              fontWeight: 600,
              color: "var(--brand-blue-deep)",
              textDecoration: "none",
            }}
          >
            Talk to us
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
.hiw-rail { display: grid; grid-template-columns: repeat(5, 1fr); align-items: start; }
.hiw-rail-line { top: 7px; left: 10%; right: 10%; height: 2px; }
.hiw-node { display: flex; flex-direction: column; align-items: center; gap: 12px; }

.hiw-section-title { font-size: clamp(28px, 4vw, 42px); }
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
  .hiw-section-title { font-size: 26px; max-width: 100%; }
  .hiw-hero-sub { font-size: 15px; }
  .hiw-terminal { margin-top: 32px; border-radius: 13px; }
  .hiw-term-bar { padding: 12px 16px; }
  .hiw-term-body { padding: 20px 16px 22px; }
  /* Input → output: stack the two halves vertically, full-width */
    /* Stage rail becomes a vertical list of labelled nodes */
  .hiw-rail { grid-template-columns: 1fr; }
  .hiw-node { flex-direction: row; align-items: center; gap: 12px; padding: 7px 0; }
  .hiw-node > span:last-child { font-size: 14px; }
  .hiw-rail-line { left: 6px; right: auto; top: 14px; bottom: 14px; width: 2px; height: auto; }
  /* Data cells stack to one column */
  
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

/** One numbered row — shared by the buyer workflow and the pipeline stages. */
function StepRow({
  n,
  title,
  desc,
  color,
  bg,
  icon,
}: {
  n: string;
  title: string;
  desc: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="hiw-step-row">
      {/* Big number */}
      <div
        aria-hidden
        className="hiw-step-num"
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontWeight: 700,
          lineHeight: 1,
          color: "var(--ink-faint)",
          letterSpacing: "-0.02em",
        }}
      >
        {n}
      </div>

      {/* Content */}
      <div>
        <div className="hiw-step-head" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: bg,
              color,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
          <h3
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
            {title}
          </h3>
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
          {desc}
        </p>

      </div>
    </div>
  );
}

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
        color: dark ? "var(--navy-pale)" : BLUE,
        background: dark ? "rgba(30,102,201,0.10)" : BLUE_SOFT,
        border: dark ? "1px solid rgba(30,102,201,0.30)" : "1px solid var(--navy-pale-line)",
        borderRadius: 999,
        padding: "5px 12px",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          // NOT --brand-blue on the dark pill. A brighter one-off blue lived
          // here at 478b809 *because* --brand-blue is too dark on navy;
          // aliasing it onto --brand-blue was a REGRESSION, 3.7794:1 ->
          // 2.8880:1 over the composited pill background, under WCAG 1.4.11's
          // 3:1 floor. --brand-blue-bright exists for exactly this: 6.2832:1.
          // (Hex values omitted on purpose — this gate scans comments.)
          background: dark ? "var(--brand-blue-bright)" : BLUE,
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
