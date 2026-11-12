import Link from "next/link";
import { Card } from "@/components/bridge/layout/Card";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { FOOTER_COLS } from "@/components/marketing/footerColumns";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";
import { PLAN_BY_ID } from "@/lib/plans";

// Brand tokens: ALIASES for the CSS custom properties in globals.css, never copies of
// their values (enforced by scripts/check-tokens.mjs).
const BLUE = "var(--brand-blue)";
const BLUE_DEEP = "var(--brand-blue-deep)";
const BLUE_BRIGHT = "var(--brand-blue-bright)";
const GREEN_BRIGHT = "var(--brand-green-bright)";
const NAVY = "var(--navy)";
const NAVY_SURFACE = "var(--navy-surface)";
const NAVY_BORDER = "var(--navy-border)";
const NAVY_TEXT = "var(--navy-text)";
const NAVY_FAINT = "var(--navy-faint)";
const INK = "var(--ink)";
const INK_MUTED = "var(--ink-muted)";
const SURFACE = "var(--surface)";
const BG = "var(--bg)";

// Every number on this page is read off the ladder, never typed.
const TRIAL = PLAN_BY_ID.pilot;
const STARTER_PRICE = PLAN_BY_ID.starter.priceMonthly;

const STEPS: Array<{ title: string; body: string }> = [
  { title: "Send it", body: "Upload a file, forward an email, or let us collect it from a mailbox, an SFTP or FTP server, an S3 bucket, or our API." },
  { title: "We read it", body: "We read every value and table on the first document. There's no template to build first." },
  { title: "You check it", body: "The original stays on screen beside what we read. Fix a value, or point at it on the page so we find it next time." },
  { title: "We send it", body: "Choose CSV, JSON, XML, Excel, PDF, text or fixed-width, then send it by email, to a web address, to an SFTP or FTPS server, or download it." },
];

const WHY: Array<{ title: string; body: string }> = [
  { title: "No templates", body: "A new sender's layout doesn't mean new setup. We read the first document as it arrives." },
  { title: "Checks you can see", body: "We flag a total that doesn't add up or a value that's missing, and hold a document we've already seen instead of sending it twice." },
  { title: "One price list", body: `Every channel, output and check on every plan. You pay for documents, from €${STARTER_PRICE} a month.` },
];

const CTA_PRIMARY: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 8,
  padding: "13px 26px",
  fontSize: 14,
  fontWeight: 600,
  background: BLUE,
  color: SURFACE,
  textDecoration: "none",
  boxShadow: "0 8px 24px rgba(30,102,201,0.32)",
};

const CTA_SECONDARY: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 8,
  padding: "13px 26px",
  fontSize: 14,
  fontWeight: 600,
  background: NAVY_SURFACE,
  color: SURFACE,
  textDecoration: "none",
  border: `1px solid ${NAVY_BORDER}`,
};

export default function RootPage() {
  return (
    <div style={{ minHeight: "100dvh", background: SURFACE, fontFamily: "Inter, system-ui, sans-serif" }}>
      <MarketingNav />

      {/* The home page renders through the ROOT layout (not the marketing layout), so it
          must supply its own <main> landmark (WCAG 1.3.1). */}
      <main id="main-content" tabIndex={-1} className="outline-none">

      {/* ── Hero ── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background:
            "radial-gradient(800px 420px at 50% -8%, rgba(30,102,201,0.22), transparent 60%), radial-gradient(620px 380px at 84% 18%, rgba(46,142,58,0.16), transparent 60%), var(--navy)",
          paddingTop: 64,
          paddingBottom: 76,
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 28,
              borderRadius: 14,
              padding: "0 13px",
              background: NAVY_SURFACE,
              border: `1px solid ${NAVY_BORDER}`,
              marginBottom: 22,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: NAVY_TEXT,
            }}
          >
            Document data, without the retyping
          </div>

          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(36px, 6vw, 64px)",
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.06,
              color: SURFACE,
              maxWidth: 800,
              margin: "0 0 22px",
              textWrap: "balance",
            }}
          >
            <span style={{ color: BLUE_BRIGHT }}>Any document in.</span>{" "}
            <span style={{ color: GREEN_BRIGHT }}>Clean data out.</span>
          </h1>

          <p style={{ fontSize: "clamp(15px, 1.6vw, 18px)", lineHeight: 1.6, color: NAVY_TEXT, maxWidth: 600, margin: "0 0 14px" }}>
            ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: NAVY_TEXT, maxWidth: 600, margin: "0 0 6px" }}>
            Free for {TRIAL.priceCadence} · {TRIAL.orderLimit} documents · from €{STARTER_PRICE} a month after
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: NAVY_TEXT, maxWidth: 600, margin: "0 0 30px" }}>
            Scans and phone photos are read too.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/sign-up" style={CTA_PRIMARY}>Start your free trial</Link>
            <Link href="/how-it-works" style={CTA_SECONDARY}>See how it works</Link>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-4 sm:px-8" style={{ background: BG, paddingTop: 76, paddingBottom: 76 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <h2 style={{ ...sectionTitle, textAlign: "center" }}>How it works</h2>
          <ol className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4" style={{ listStyle: "none", padding: 0, margin: "36px 0 0" }}>
            {STEPS.map((s, i) => (
              <Card key={s.title} as="li">
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: BLUE_DEEP }}>{i + 1}</div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: INK, margin: "8px 0 0" }}>{s.title}</h3>
                <p style={{ ...bodyCopy, fontSize: 14, margin: "8px 0 0" }}>{s.body}</p>
              </Card>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Why ── */}
      <section className="px-4 sm:px-8" style={{ background: SURFACE, paddingTop: 76, paddingBottom: 76 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <ul className="grid grid-cols-1 gap-[18px] md:grid-cols-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {WHY.map((w) => (
              <Card key={w.title} as="li">
                <h3 style={{ fontSize: 16, fontWeight: 600, color: INK, margin: 0 }}>{w.title}</h3>
                <p style={{ ...bodyCopy, fontSize: 14, margin: "8px 0 0" }}>{w.body}</p>
              </Card>
            ))}
          </ul>
          <p style={{ ...bodyCopy, textAlign: "center", margin: "28px auto 0", maxWidth: 560 }}>
            Have your receiving system&apos;s documentation? Upload it and we propose the output for you to check.
          </p>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="px-4 sm:px-8" style={{ background: BG, paddingTop: 76, paddingBottom: 76 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <h2 style={sectionTitle}>For anyone who retypes documents</h2>
          <p style={bodyCopy}>
            Purchase orders, invoices, delivery notes, price lists, forms — any document you handle again and again.
          </p>
        </div>
      </section>

      {/* ── Closing band ── */}
      <section className="px-4 sm:px-8" style={{ background: NAVY, paddingTop: 84, paddingBottom: 84, textAlign: "center" }}>
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(28px, 3.6vw, 40px)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            color: SURFACE,
            margin: 0,
          }}
        >
          Try it on your own documents
        </h2>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
          <Link href="/sign-up" style={CTA_PRIMARY}>Start your free trial</Link>
          <Link href="/book-demo" style={{ ...CTA_SECONDARY, background: "transparent" }}>Talk to us</Link>
        </div>
      </section>

      </main>

      {/* Multi-column navy footer */}
      <footer style={{ background: NAVY, color: NAVY_FAINT }}>
        <div className="mx-auto max-w-[1100px] px-6 sm:px-8" style={{ padding: "48px 24px 0" }}>
          <div className="grid gap-10 grid-cols-2 sm:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5" style={{ textDecoration: "none" }}>
                <ProcuLinkMark size={24} mono />
                <span style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: SURFACE, fontWeight: 700, fontSize: 17 }}>ProcuLink</span>
              </Link>
              <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 300, marginTop: 14 }}>
                The missing link between buyers and suppliers. ProcuLink reads your documents, checks
                them and sends them on in the format you need — with a full audit trail on every document.
              </p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.h}>
                <h3 style={{ color: SURFACE, fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</h3>
                {/* ≥44px-tall flex rows so each footer link is a full touch target
                    (WCAG 2.5.8); row height replaces the container gap. */}
                <div className="flex flex-col">
                  {col.links.map(([label, href]) => (
                    <a key={label} href={href} className="flex items-center min-h-[44px]" style={{ color: NAVY_FAINT, fontSize: 13, textDecoration: "none" }}>{label}</a>
                  ))}
                  {col.h === "Company" && process.env.NEXT_PUBLIC_STATUS_URL && (
                    <a href={process.env.NEXT_PUBLIC_STATUS_URL} target="_blank" rel="noopener noreferrer" className="flex items-center min-h-[44px]" style={{ color: NAVY_FAINT, fontSize: 13, textDecoration: "none" }}>Status</a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-12" style={{ borderTop: "1px solid var(--navy-line)", padding: "18px 0 28px", fontSize: 12 }}>
            <span>{COPYRIGHT_NOTICE}</span>
            <span className="flex items-center gap-3"><Link href="/security" style={{ color: "inherit", textDecoration: "none" }}>EU-region document storage</Link><span>·</span><span>AES-GCM at rest</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Section primitives ───────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
  fontSize: "clamp(26px, 3.4vw, 36px)",
  fontWeight: 600,
  letterSpacing: "-0.03em",
  lineHeight: 1.12,
  color: INK,
  margin: "14px 0 0",
  textWrap: "balance",
};

const bodyCopy: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: INK_MUTED,
  margin: "14px 0 0",
};
