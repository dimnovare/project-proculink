import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { SUBPROCESSORS } from "@/lib/subprocessors";

export const metadata = pageMetadata({
  path: "/security",
  title: "Security & trust — ProcuLink",
  description:
    "ProcuLink sits between your buyers and suppliers. How we protect that position — encryption, EU-region storage, an append-only audit trail, and responsible AI.",
  ogDescription:
    "Encryption, EU-region storage, an append-only audit trail, access control, and responsible AI — how ProcuLink protects the orders passing through it.",
});

// ─── Palette (exact design tokens, sampled from tokens.css / globals.css) ──────
// Security uses a green-accent topology over the canonical navy chrome:
//   • supplier / trust accents use brand-green        (#2E8E3A family)
//   • the primary CTA ("Request security docs") is buyer-blue (#1E66C9)
// These match the --brand-* CSS variables already in globals.css — do NOT
// reintroduce the retired bright emerald (banned repo-wide; see
// src/test/token-contrast.test.ts).
const NAVY = "#0B1A2F";
const INK = "#0B1A2F";
const MUTE = "#56627A";
const HAIR = "#E2E6EE";
const PANEL = "#F6F7FA";

const GREEN = "#2E8E3A"; // brand green — card top edge + eyebrow dot
const GREEN_DEEP = "#1E6D29"; // brand green deep — icon glyph stroke
const GREEN_SOFT = "#E2F1E2"; // brand green soft — mint icon tile
const BLUE = "#1E66C9"; // buyer-blue — primary CTA

// ─── Security posture (the six feature cards) ──────────────────────────────────

const POSTURE: Array<{ title: string; body: React.ReactNode; icon: React.ReactNode }> = [
  {
    title: "Encryption everywhere",
    body: "AES-GCM at rest and TLS 1.2+ in transit (TLS 1.3 where supported). Supplier delivery credentials are encrypted with AES-256-GCM authenticated encryption and never written to application logs.",
    icon: <KeyIcon />,
  },
  {
    // Two facts, kept apart on purpose. WHERE DATA IS STORED is one question;
    // WHICH NETWORK PATH our traffic takes to reach your supplier is a
    // different one, and we can only answer the first. Collapsing the two into
    // a single "EU data residency" string is what made the previous version of
    // this card untrue. See docs/qa/2026-07-30-residency-ground-truth.md in the
    // backend repo for the sourced position behind every sentence here.
    title: "Where your data lives",
    body: (
      <>
        Your order files, the database behind them, and the API all run in EU-region
        infrastructure — Cloudflare R2, Neon, and Railway. Some processing runs on named US
        subprocessors under standard contractual clauses: sign-in, AI document extraction and
        mapping suggestions, payments, and email in both directions — the orders your suppliers
        email in, and the purchase orders we email out to them. If you deliver an order by
        email, the order itself passes through a US provider. Each one is listed with its
        location and contract on{" "}
        <Link href="/subprocessors" style={{ color: GREEN_DEEP, textDecoration: "underline" }}>
          /subprocessors
        </Link>
        . Where your data is stored and the route it travels are two different questions: the
        network path out to your supplier is chosen by our hosting provider and is not pinned to
        a region by us, so we cannot tell you today which country an outbound delivery leaves
        from.
      </>
    ),
    icon: <BuildingIcon />,
  },
  {
    title: "Append-only audit trail",
    // The second sentence used to read "Export the full delivery log for any order at any time."
    // Both halves of it were wrong, and the second more seriously than the first.
    //
    // 1. It named no tier. The workspace-wide log is GET /api/audit, gated on
    //    BillingFeature.AdvancedAudit -> Operations (PlanConstants.cs:276), so a Growth or Pilot
    //    reader took an Operations capability as included. /operations/log refuses them outright
    //    with `advanced_audit_requires_operations` (CrossingsLog.tsx:413-416).
    // 2. "for any order at any time" described a per-order export that does not exist as such.
    //    The only CSV export in the product is on that same gated page (CrossingsLog.tsx:441).
    //    It does honour the ?orderId= filter, so an Operations customer can export one order's
    //    entries — but only within the page it loaded (newest 200 events org-wide), which the
    //    page itself discloses via `windowPartial`. "Full ... at any time" was not true even
    //    there, so naming a tier alone would not have fixed it.
    //
    // What every plan really gets is the per-order trail: GET /api/orders/{id}/audit is
    // deliberately ungated — pinned as the IL scanner's negative control in
    // BillingGateEnforcementIsRealTests.cs:143-155 — and is rendered at OrderWorkshop.tsx:377.
    // That is worth stating plainly rather than dropping; it is the half of the claim that was
    // always true.
    body: "Every parse, edit, validation and delivery attempt is recorded in an append-only audit log. On every plan you can open a single order and read its complete history — each attempt, the supplier's response code, and any error. The workspace-wide delivery log across all orders, with filtering and CSV export, is included from the Operations plan up.",
    icon: <ClockIcon />,
  },
  {
    title: "Validation before delivery",
    body: "Per-supplier rules block malformed orders before they ever reach a supplier endpoint — wrong currency, missing fields, unresolved codes.",
    icon: <RulesIcon />,
  },
  {
    title: "Access control",
    // The second sentence used to read "Role-based access and SAML/OIDC SSO are available on
    // Enterprise — we set them up with you during onboarding." Both halves were unbacked. SSO has
    // no Settings surface and no entitlement consumer anywhere in this app (see the note in
    // plans.ts on the Enterprise card), and role-based access is on no plan's feature list either,
    // so /security was the only surface asserting it. Neither comes back without a screen behind it.
    body: "Org-scoped data isolation on every query, scoped API keys you can revoke instantly, and short-lived sessions by default.",
    icon: <UserIcon />,
  },
  // The no-AI mode is REAL and the old sentence oversold it in three separate ways.
  //
  // What the code actually does — Organisation.SelfHostedOcr, verified 2026-07-31:
  // it suppresses OpenAI at six independent chokepoints (PDF extraction, XLSX
  // extraction, SKU mapping, field auto-map, schema inference, inbound-email NLP),
  // each pinned by a strict-mock `Times.Never` test. A failed READ of the flag is
  // treated as no-egress (OpenAiMappingService.cs, OpenAiSchemaInferencer.cs both
  // `return true` on exception), so the common failure mode is safe. One narrow
  // path is not: both gates open `if (orgId == Guid.Empty) return false`, and the
  // schema inferencer resolves its org id inside a try/catch that yields
  // Guid.Empty — so an unidentifiable tenant fails OPEN on catalog schema
  // inference. Narrow and exception-only, but it is not "fails safe everywhere",
  // and the card's wording should not depend on it being so.
  //
  // What it does NOT do:
  //   • "runs entirely in your environment" — FALSE. The local OCR engine
  //     (RapidOcrNet) runs in-process inside OUR Railway API and Worker
  //     containers. There is no customer-deployable artifact anywhere: no helm
  //     chart, no installer, no tenant-supplied endpoint, zero hits for
  //     Tesseract/OcrProvider/EndpointOverride in the backend repo. The flag
  //     removes one subprocessor; it does not move processing one metre.
  //   • "documents never leave your region" — FALSE, and it follows from the
  //     above: the files still travel to Railway compute, Neon and R2 exactly as
  //     for every other org.
  //   • "Enterprise customers can opt into" — FALSE as stated. There are ZERO
  //     write sites for the flag in production code, no endpoint, no settings
  //     screen, and no BillingFeature/PlanConstants entry binding it to
  //     Enterprise. It is a manual database toggle we set, which is a thing we
  //     do for you, not a thing you can opt into.
  //
  // Also deliberately dropped: the scanned-PDF OCR promise. The engine is only
  // registered when `NoEgressOcr:Enabled` is set, that key appears in NO committed
  // config, and whether it is set on production Railway is not establishable from
  // the repo. So the card claims the guarantee that holds either way — no egress —
  // and not the capability whose production status we cannot check.
  {
    title: "Responsible AI",
    body: "Mapping suggestions never auto-apply without a confidence score and source. Your data is never used to train third-party models. We can also turn AI extraction off for an organisation entirely, so nothing about its orders reaches OpenAI: the AI steps are switched off, our own parsers do the reading, and anything they cannot read is left for manual entry rather than sent out. We set that for you on request; it is not a self-serve setting, and it does not change where your files are stored.",
    icon: <ZapIcon />,
  },
];

const COMPLIANCE_ROWS: Array<[string, string]> = [
  ["GDPR", "Compliant · DPA available"],
  ["SOC 2", "Readiness on our roadmap"],
  ["ISO 27001", "On our roadmap"],
];

// Rendered from the single-source subprocessor list (src/lib/subprocessors.ts)
// so this card can never diverge from /subprocessors and /privacy.
const SUBPROCESSOR_ROWS: Array<[string, string]> = SUBPROCESSORS.map((s) => [s.name, s.purpose]);

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  return (
    <div style={{ background: "#FFFFFF", color: INK }}>
      <style>{css}</style>

      {/* ── Hero (navy) ─────────────────────────────────────────────────── */}
      <header
        className="sec-hero"
        style={{
          position: "relative",
          overflow: "hidden",
          background: NAVY,
          color: "#FFFFFF",
          textAlign: "center",
        }}
      >
        {/* Radial brand bloom — blue lift behind the headline + green corner glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(800px 420px at 50% -8%, rgba(30,102,201,0.22), transparent 60%), radial-gradient(620px 380px at 84% 18%, rgba(46,142,58,0.16), transparent 60%)",
          }}
        />
        <div className="sec-hero-inner" style={{ position: "relative" }}>
          <span
            className="sec-eyebrow"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 28,
              padding: "0 13px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid #1B2D49",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#9DB2CE",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />
            Security &amp; trust
          </span>

          <h1
            className="sec-h1"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              color: "#FFFFFF",
              margin: "20px auto 0",
              maxWidth: "16ch",
              textWrap: "balance",
            }}
          >
            Built for orders you can&apos;t afford to get wrong
          </h1>

          <p
            className="sec-hero-sub"
            style={{
              color: "#9DB2CE",
              lineHeight: 1.6,
              maxWidth: "56ch",
              margin: "18px auto 0",
            }}
          >
            ProcuLink sits between your buyers and suppliers. We treat that position —
            and your data — with the seriousness it deserves.
          </p>
        </div>
      </header>

      {/* ── Security posture — 6 cards, 3-up grid, green top edge ────────── */}
      <section className="sec-section" style={{ background: "#FFFFFF" }}>
        <div className="sec-wrap">
          <div className="sec-feature-grid">
            {POSTURE.map((p) => (
              <article key={p.title} className="sec-card">
                <div
                  className="sec-feature-icon"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: GREEN_SOFT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  {p.icon}
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 17,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: INK,
                    margin: "0 0 8px",
                  }}
                >
                  {p.title}
                </h3>
                <p style={{ color: MUTE, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Compliance + Subprocessors — two-column list cards ──────────── */}
      <section
        className="sec-section sec-tint"
        style={{ background: PANEL, borderTop: `1px solid ${HAIR}` }}
      >
        <div className="sec-wrap sec-two-col">
          <div>
            <h2 className="sec-col-title">Compliance</h2>
            <ListCard rows={COMPLIANCE_ROWS} />
          </div>
          <div>
            <h2 className="sec-col-title">Subprocessors</h2>
            <ListCard rows={SUBPROCESSOR_ROWS} />
            <p style={{ fontSize: 12.5, color: MUTE, margin: "12px 2px 0" }}>
              Full list with locations, contracts, and change notifications:{" "}
              <Link href="/subprocessors" style={{ color: GREEN_DEEP, textDecoration: "underline" }}>
                /subprocessors
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── Navy CTA band ───────────────────────────────────────────────── */}
      <section className="sec-section sec-navy" style={{ background: NAVY, textAlign: "center" }}>
        <div className="sec-wrap sec-narrow">
          <h2
            className="sec-cta-title"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              color: "#FFFFFF",
              margin: 0,
            }}
          >
            Need our security package?
          </h2>
          <p
            className="sec-cta-sub"
            style={{ color: "#9DB2CE", lineHeight: 1.6, margin: "14px auto 0", maxWidth: 480 }}
          >
            We&apos;ll share our DPA, security overview, and architecture
            documentation under NDA.
          </p>
          <div className="sec-cta-actions">
            <a
              href="mailto:security@proculink.eu?subject=Security%20package%20request"
              className="sec-btn sec-btn-blue"
              style={{ background: BLUE, color: "#FFFFFF" }}
            >
              Request security docs <ArrowRight />
            </a>
            <Link
              href="/sign-up"
              className="sec-btn sec-btn-secondary"
              style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #1B2D49" }}
            >
              Start free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── List card (Compliance / Subprocessors) ────────────────────────────────────

function ListCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
        overflow: "hidden",
      }}
    >
      {rows.map(([label, note], i) => (
        <div
          key={label}
          className="sec-list-row"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "14px 18px",
            borderTop: i === 0 ? "none" : "1px solid #EDF0F5",
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, letterSpacing: "-0.01em", flexShrink: 0 }}>
            {label}
          </span>
          <span style={{ fontSize: 12.5, color: MUTE, textAlign: "right", minWidth: 0 }}>{note}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Scoped layout + responsive CSS (keeps this a Server Component) ─────────────

const css = `
.sec-wrap { max-width: 1180px; margin: 0 auto; padding: 0 32px; }
.sec-wrap.sec-narrow { max-width: 920px; }
.sec-section { padding: 84px 0; }

.sec-hero-inner { padding: 64px 32px 56px; }
.sec-h1 { font-size: clamp(34px, 5vw, 52px); }
.sec-hero-sub { font-size: clamp(15px, 1.6vw, 18px); }

.sec-feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.sec-card {
  background: #FFFFFF;
  border: 1px solid #E2E6EE;
  border-top: 3px solid ${GREEN};
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(11,26,47,0.04);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.sec-card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px -18px rgba(11,26,47,0.22); }

.sec-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.sec-col-title {
  font-family: 'Bricolage Grotesque', Inter, sans-serif;
  font-size: 24px; font-weight: 600; letter-spacing: -0.02em;
  color: ${INK}; margin: 0 0 16px;
}

.sec-cta-title { font-size: clamp(28px, 3.6vw, 40px); }
.sec-cta-sub { font-size: 16px; }
.sec-cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 26px; }
.sec-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 46px; padding: 0 24px; border-radius: 8px;
  font-size: 14.5px; font-weight: 600; text-decoration: none;
  transition: filter 0.12s ease, background 0.12s ease;
}
.sec-btn-blue:hover { filter: brightness(1.06); }
.sec-btn-secondary:hover { background: rgba(255,255,255,0.06) !important; }

@media (max-width: 920px) {
  .sec-feature-grid { grid-template-columns: 1fr; }
  .sec-two-col { grid-template-columns: 1fr; gap: 20px; }
}
@media (max-width: 560px) {
  .sec-wrap { padding: 0 18px; }
  .sec-section { padding: 56px 0; }
  .sec-hero-inner { padding: 44px 18px 48px; }
  .sec-h1 { font-size: 30px; }
  .sec-hero-sub { font-size: 15px; }
  .sec-col-title { font-size: 21px; }
  .sec-cta-actions { flex-direction: column; gap: 10px; }
  .sec-cta-actions .sec-btn { width: 100%; }
}
`;

// ─── Icons (inline SVG, green-deep stroke to match the design source) ───────────

function KeyIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 20 3" />
      <path d="m17 6 3 3" />
      <path d="m14 9 2.5 2.5" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 3.5" />
    </svg>
  );
}

function RulesIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m7.5 12.2 3 3 6-6.4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={GREEN_DEEP} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" />
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
