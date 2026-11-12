"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ANNUAL_BILLING_ENABLED,
  DOCUMENT_PLAN_FEATURES,
  LEGACY_PAID_PLANS,
  PLAN_BY_ID,
  PUBLIC_LADDER,
  yearlyMonthlyEquivalent,
  type Plan,
} from "@/lib/plans";
import { NUMBER_LOCALE } from "@/lib/format-number";
import { DOCUMENT_SLIDER_MAX, DOCUMENT_SLIDER_STEP, recommendPlan } from "./recommendPlan";

// ─────────────────────────────────────────────────────────────────────────────
// Pricing page — the document ladder. Visual contract: the marketing-scoped
// .plk-* classes below (the app's globals.css must not be edited), every colour a
// design token.
//
// Every card is a plan in PUBLIC_LADDER (src/lib/plans.ts): the trial, the four document
// plans, Enterprise. Plans differ by documents a month and flows only, so the document
// plans share one bullet list (DOCUMENT_PLAN_FEATURES) and every number on a card is read
// off the plan. The legacy paid plans are hidden here; their names appear only in the
// "I'm on …" FAQ question, derived from LEGACY_PAID_PLANS.
//
// There is no "Most popular" badge: nothing measures popularity. The featured treatment
// belongs only to the card the recommender points at, so it reflects the visitor's own answer.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("en-IE");

/** "150 documents a month · 5 flows" — the trial's allowance is a one-off total, not monthly. */
function allowanceLine(plan: Plan): string {
  const flows = plan.flowLimit == null ? "unlimited flows" : `${fmt(plan.flowLimit)} flows`;
  return `${fmt(plan.orderLimit!)} documents${plan.orderLimitIsMonthly ? " a month" : ""} · ${flows}`;
}

/** "A, B, C or D" */
const joinNames = (names: string[]) => `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

const LEGACY_PLAN_NAMES = joinNames(LEGACY_PAID_PLANS.map((p) => p.name));

// ERP connectors are not built in the document engine, and "Custom suppliers" is order-era wording: neither Enterprise bullet is sold here.
const ENTERPRISE_FEATURES = PLAN_BY_ID.enterprise.features.filter((f) => !/\berp\b|suppliers/i.test(f));

function cardFeatures(plan: Plan): string[] {
  if (plan.id === "enterprise") return ENTERPRISE_FEATURES;
  if (plan.id === "pilot") return [];
  return [...DOCUMENT_PLAN_FEATURES, `€${plan.overageEur!.toFixed(2)} per extra document`];
}

// Answers are ReactNode so an answer can link to the page that owns the detail.
const FAQ: Array<[string, ReactNode]> = [
  [
    `I'm on ${LEGACY_PLAN_NAMES}. What changes?`,
    "Nothing until you change plan. You keep your current price and limits. When you change plan, you choose from the plans on this page.",
  ],
  [
    "What happens when the trial ends?",
    "Your workspace becomes read-only. You can still open and export everything, but new documents aren't accepted until you choose a plan.",
  ],
  [
    "Can I change plans later?",
    "Yes — up or down, any time. We prorate the difference.",
  ],
  // Cancelling is the one plan change that stops orders arriving, and it used to be
  // undisclosed: the answer above ("up or down, any time") reads as though cancelling
  // is just another move along the ladder. It is not — every ingest path refuses once
  // the subscription ends, and nothing is queued for later, so a sender who keeps
  // emailing documents gets silence. Say so before the buyer pays, not after a
  // PO goes missing. Pinned by cancelDisclosure.test.tsx.
  [
    "What happens if I cancel?",
    "If you cancel, ProcuLink stops accepting new documents when your subscription ends. Everything you have already processed remains readable and exportable — past documents, flows and outputs stay until you ask us to delete them, and activity records such as delivery attempts are removed after 180 days (see the Privacy Policy) — but nothing new comes in on any route: uploads, emailed documents and the file API all stop, and mailbox, SFTP, FTP and S3 pickups pause and leave your files where they are. Uploads, emails and API calls sent after that are not held for later, so tell your senders before you cancel. Resubscribing turns processing back on immediately, with your setup untouched.",
  ],
  // STORED and PROCESSED are two different questions, and this answer used to give
  // one answer to both: "All order data is stored and processed in the EU". The
  // storage half is our position; the processing half is false and was already
  // retracted from /security on 2026-07-30 — OpenAI receives order content at
  // api.openai.com, and Postmark carries the outbound purchase order itself as an
  // email attachment. The retraction swept /security and missed this page, so the
  // sentence the packet exists to kill stayed live here for a day. This answer now
  // says "document storage is EU-region" — the same words the fine print at the bottom
  // of this page and both site footers already use, and no more specific than that.
  // A draft that named Cloudflare R2 and Neon here was rejected in review: those two
  // regions are unsourced, and pinning an unsourced claim to named vendors makes it
  // more precise without making it more true.
  [
    "Where is my data stored?",
    "Document storage is EU-region and encrypted with AES-GCM at rest. Some processing runs on named US subprocessors under standard contractual clauses — sign-in, AI extraction, payments, and email in both directions, including the documents we email to the destinations you set. See the Security page for the full posture.",
  ],
];


export default function PricingPage() {
  // Monthly/Annual toggle — annual billing is LIVE (offer⇔works): annual is 10 × monthly, and
  // checkout maps it to the plan's live Stripe yearly price. ANNUAL_BILLING_ENABLED stays an
  // env-overridable kill switch (NEXT_PUBLIC_ANNUAL_BILLING_ENABLED=false hides the toggle).
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const yearly = ANNUAL_BILLING_ENABLED && billing === "yearly";

  // Recommender — documents a month only (./recommendPlan.ts): the cheapest plan whose
  // allowance covers it, Enterprise above the largest.
  const [documents, setDocuments] = useState(200);
  const recommended = useMemo(() => recommendPlan(documents), [documents]);

  return (
    <div style={{ background: "var(--surface)", color: "var(--ink)" }}>
      <style>{PRICING_CSS}</style>

      {/* ── Hero (navy chrome, blue + green radials — mirrors .hero) ──────── */}
      <header className="plk-hero">
        <div className="plk-hero-inner">
          <span className="plk-eyebrow">
            <span className="plk-eyebrow-dot" />
            Pricing
          </span>

          <h1 className="plk-h1">Pay for documents. Every feature is included.</h1>

          <p className="plk-sub">
            Every plan has every way to send documents in, every output and every check. Plans
            differ only by how many documents you process and how many flows you set up.
          </p>
          <p className="plk-sub">
            A document is one file of up to 10 pages. Longer files count once for every 10 pages.
          </p>

          <div className="plk-reco">
            <label className="plk-reco-label" htmlFor="plk-documents">
              How many documents do you process per month?
            </label>
            <div className="plk-reco-input-row">
              <input
                id="plk-documents"
                className="plk-reco-input"
                type="range"
                min={DOCUMENT_SLIDER_STEP}
                max={DOCUMENT_SLIDER_MAX}
                step={DOCUMENT_SLIDER_STEP}
                value={documents}
                onChange={(e) => setDocuments(Number(e.target.value))}
                aria-label="Documents per month"
                aria-describedby="plk-reco-readout"
              />
              <span className="plk-reco-count" id="plk-reco-readout" aria-live="polite">
                {documents.toLocaleString(NUMBER_LOCALE)}
                <small> documents/mo</small>
              </span>
            </div>

            <div className="plk-reco-out" role="status">
              <span className="plk-reco-out-label">Recommended plan</span>
              <strong className="plk-reco-out-plan">{recommended.name}</strong>
              <span className="plk-reco-out-price">
                {recommended.isCustom ? "Custom" : `${recommended.priceLabel}/mo`}
              </span>
              <Link
                href={recommended.isCustom ? recommended.cta.href : "/sign-up"}
                className="plk-btn plk-btn-blue plk-reco-cta"
              >
                {recommended.isCustom ? "Contact sales" : `Start with ${recommended.name}`}{" "}
                <span aria-hidden>→</span>
              </Link>
              {!recommended.isCustom && (
                <span className="plk-reco-why">{allowanceLine(recommended)}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Pricing cards — the whole public ladder in one grid ──────────── */}
      <section className="plk-section" style={{ paddingTop: 48 }}>
        <div className="plk-wrap">
          {ANNUAL_BILLING_ENABLED && (
            <div className="plk-toggle-wrap">
              <div className="plk-billing-toggle" role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={!yearly ? "on" : ""}
                  aria-pressed={!yearly}
                  onClick={() => setBilling("monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={yearly ? "on" : ""}
                  aria-pressed={yearly}
                  onClick={() => setBilling("yearly")}
                >
                  Annual · 2 months free
                </button>
              </div>
            </div>
          )}

          <div className="plk-pricing-grid">
            {PUBLIC_LADDER.map((plan) => (
              <PriceCard key={plan.id} plan={plan} yearly={yearly} recommended={plan.id === recommended.id} />
            ))}
          </div>

          <p className="plk-fine">
            All plans include EU-region document storage and AES-GCM encryption.{" "}
            <Link href="/subprocessors" style={{ textDecoration: "underline" }}>
              Where each subprocessor runs
            </Link>{" "}
            is listed in full.
          </p>
          {/* Cancelling is the one thing on this page a buyer can get wrong expensively, and
              the FAQ answer is inside a collapsed panel — so the headline consequence also
              sits here, in the open, next to the prices it applies to. */}
          <p className="plk-fine" style={{ marginTop: 10 }}>
            Cancel any time. New documents stop arriving on every channel once your subscription
            ends — what you have already processed stays available to read and export.
          </p>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="plk-section tint">
        <div className="plk-wrap narrow">
          <div className="plk-section-head">
            <span className="plk-section-eyebrow">FAQ</span>
            <h2 className="plk-section-title">Questions, answered</h2>
          </div>
          <div>
            {FAQ.map(([q, a]) => (
              <FaqItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA band ────────────────────────────────────────────── */}
      <section className="plk-section navy" style={{ textAlign: "center" }}>
        <div className="plk-wrap narrow">
          <h2 className="plk-section-title" style={{ color: "#fff" }}>
            Not sure which plan fits?
          </h2>
          <p className="plk-section-sub">
            Start the free trial and see how many documents you process.
          </p>
          <div className="plk-cta-row">
            <Link href="/sign-up" className="plk-btn plk-btn-blue lg">
              Start your free trial <span aria-hidden>→</span>
            </Link>
            <Link href="/book-demo" className="plk-btn plk-btn-outline lg">
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function PriceCard({ plan, yearly, recommended }: { plan: Plan; yearly: boolean; recommended: boolean }) {
  const isTrial = plan.id === PLAN_BY_ID.pilot.id;
  const isMonthly = plan.priceMonthly != null && plan.priceMonthly > 0;
  // Annual: the plan's yearly price as a monthly equivalent, with the billed-annually total beneath.
  const showYearly = yearly && isMonthly && plan.priceYearly != null;
  const bigPrice = showYearly ? `€${fmt(yearlyMonthlyEquivalent(plan)!)}` : isTrial ? "Free" : plan.priceLabel;

  return (
    <article className={recommended ? "plk-price-card featured" : "plk-price-card"}>
      {recommended && <span className="plk-price-badge">Recommended for you</span>}

      <div className="plk-tier">{plan.name}</div>

      <div className="plk-price">
        {bigPrice}
        {isMonthly && <small>/mo</small>}
        {isTrial && <small> for {plan.priceCadence}</small>}
      </div>
      <div className="plk-price-note">
        {showYearly
          ? `billed annually (€${fmt(plan.priceYearly!)}/yr)`
          : plan.id === "enterprise"
            ? plan.priceCadence
            : ""}
      </div>
      {plan.orderLimit != null && <div className="plk-overage-note">{allowanceLine(plan)}</div>}

      <Link
        href={plan.cta.href}
        className={recommended ? "plk-btn plk-btn-blue" : "plk-btn plk-btn-secondary"}
      >
        {isMonthly ? `Choose ${plan.name}` : plan.cta.label} <span aria-hidden>→</span>
      </Link>

      <ul className="plk-feats">
        {cardFeatures(plan).map((feature) => (
          <li key={feature}>
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function CheckIcon() {
  // Flat brand-green check glyph — matches the design's lightweight feature
  // checks (Icon name="check" color var(--brand-green)).
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="plk-check">
      <path
        d="M3 8.5l3 3 7-7"
        stroke="var(--brand-green)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FaqItem({ q, a }: { q: string; a: ReactNode }) {
  const [open, setOpen] = useState(false);
  // The open height is MEASURED from the answer, not hardcoded. The previous
  // `maxHeight: 240` silently clipped any answer taller than that -- at 390px the
  // cancellation answer needs 246px, so its last line ("tell your senders before
  // you cancel") was cut off, which is the one sentence that answer exists to deliver.
  // A pixel cap re-breaks on any copy, font, or viewport change and nothing would catch it.
  // The inner element keeps its natural height even while the wrapper is collapsed, so
  // scrollHeight is readable on the render that opens the panel.
  const answerRef = useRef<HTMLDivElement>(null);
  return (
    <div className="plk-faq-item">
      <button type="button" className="plk-faq-q" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {q}
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 250ms var(--ease-out)",
          }}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="var(--ink-faint)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* Sizes to its CONTENT, not to a magic number. The previous `maxHeight: 240` silently
          clipped any answer taller than that — at 390px the cancellation answer needs 246px, so
          the last line ("tell your senders before you cancel") was cut off, which is the
          single sentence that answer exists to deliver. A pixel cap also re-breaks on any font,
          copy, or viewport change, and nothing would catch it.
          `grid-template-rows: 0fr → 1fr` animates open exactly like a max-height transition but
          resolves to the real height at every width. The inner element needs `min-height: 0` to
          be allowed to collapse (grid items default to `auto`); its `overflow: hidden` comes
          from `.plk-faq-a`. */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: open ? (answerRef.current?.scrollHeight ?? 0) : 0,
          transition: "max-height 300ms var(--ease-out)",
        }}
      >
        {/* Padding is CONSTANT so the measured scrollHeight already includes it — animating it
            alongside max-height would leave the panel 18px short on the render that opens it. */}
        <div ref={answerRef} className="plk-faq-a" style={{ paddingBottom: 18 }}>
          {a}
        </div>
      </div>
    </div>
  );
}

// ─── Page-scoped CSS — reproduces the design's marketing classes + responsive ──
// Mobile-first. Mirrors marketing.css .hero / .section / .pricing-grid /
// .price-card / .billing-toggle / .faq-item, including the design breakpoints
// (≤1100px → 2 cols, ≤760px → 1 col). The primary grid is now 3 cards, so the
// 3-col layout fits comfortably; secondary tiers reuse the same grid when shown.
const PRICING_CSS = `
.plk-section { padding: 84px 0; }
.plk-section.tint { background: var(--bg); }
.plk-section.navy { background: var(--navy); color: #fff; }
.plk-wrap { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
.plk-wrap.narrow { max-width: 920px; }

/* Hero */
.plk-hero {
  position: relative; overflow: hidden;
  background: var(--navy); color: #fff;
}
.plk-hero::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(800px 420px at 50% -8%, rgba(30,102,201,0.22), transparent 60%),
    radial-gradient(620px 380px at 84% 18%, rgba(46,142,58,0.16), transparent 60%);
}
.plk-hero-inner { position: relative; max-width: 1180px; margin: 0 auto; padding: 64px 32px 56px; text-align: center; }
.plk-eyebrow {
  display: inline-flex; align-items: center; gap: 7px;
  height: 28px; padding: 0 13px; border-radius: 14px;
  background: var(--navy-surface); border: 1px solid var(--navy-border);
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--navy-text);
}
.plk-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-blue); box-shadow: 0 0 0 3px rgba(30,102,201,0.25); }
.plk-h1 {
  font-family: var(--font-display); font-weight: 700;
  font-size: clamp(34px, 5vw, 52px); line-height: 1.05; letter-spacing: -0.035em;
  margin: 20px auto 0; max-width: 18ch; text-wrap: balance; color: #fff;
}
.plk-sub { color: var(--navy-text); font-size: clamp(15px, 1.6vw, 18px); line-height: 1.6; max-width: 56ch; margin: 18px auto 0; text-wrap: pretty; }

/* Volume recommender (leads with the ROI helper's recommendation) */
.plk-reco {
  margin: 30px auto 0; max-width: 620px; text-align: left;
  background: var(--navy-surface); border: 1px solid var(--navy-border);
  border-radius: var(--radius-lg); padding: 22px 24px;
}
.plk-reco-label { display: block; font-size: 13.5px; font-weight: 600; color: #fff; margin-bottom: 14px; }
.plk-reco-input-row { display: flex; align-items: center; gap: 16px; }
.plk-reco-input { flex: 1; height: 28px; accent-color: var(--brand-blue); cursor: pointer; touch-action: none; }
.plk-reco-count {
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 16px; font-weight: 700; color: #fff; white-space: nowrap; min-width: 132px; text-align: right;
}
.plk-reco-count small { font-size: 11px; font-weight: 500; color: var(--navy-text); font-family: var(--font-sans); }
.plk-reco-out {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px;
  margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--navy-border);
}
.plk-reco-out-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--navy-text); }
.plk-reco-out-plan { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
.plk-reco-out-price { font-size: 14px; font-weight: 600; color: var(--navy-text); }
.plk-reco-cta { width: auto; margin-top: 0; margin-left: auto; }
.plk-reco-label-2 { margin-top: 18px; }
.plk-reco-why { flex-basis: 100%; font-size: 12.5px; line-height: 1.5; color: var(--navy-text); }

/* Section head + eyebrow (design .section-head / .section-eyebrow / .section-title) */
.plk-section-head { text-align: center; max-width: 620px; margin: 0 auto 30px; }
.plk-section-eyebrow {
  display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px; border-radius: 13px;
  background: var(--brand-blue-soft); color: var(--brand-blue-deep);
  font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 16px;
}
.plk-section-title { font-family: var(--font-display); font-size: clamp(28px, 3.6vw, 40px); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; margin: 0; text-wrap: balance; }
.plk-section.navy .plk-section-eyebrow { background: var(--navy-surface); color: var(--navy-text); border: 1px solid var(--navy-border); }
.plk-section-sub { color: var(--navy-text); font-size: 16px; line-height: 1.6; margin: 14px auto 0; max-width: 460px; text-wrap: pretty; }

/* Billing toggle (design .billing-toggle) */
.plk-toggle-wrap { margin-bottom: 26px; display: flex; justify-content: center; }
.plk-billing-toggle { display: inline-flex; background: var(--surface-2); border-radius: var(--radius); padding: 3px; gap: 2px; }
.plk-billing-toggle button {
  border: none; background: none; padding: 7px 16px; border-radius: 5px;
  font-size: 13px; font-weight: 600; color: var(--ink-muted); cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast);
}
.plk-billing-toggle button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card); }

/* Pricing grid + card (design .pricing-grid / .price-card) */
.plk-pricing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
.plk-price-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 22px 18px; position: relative; display: flex; flex-direction: column;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast);
}
.plk-price-card:not(.featured):hover { border-color: var(--border-strong); box-shadow: var(--shadow-pop); transform: translateY(-2px); }
.plk-price-card.featured {
  border-color: var(--brand-blue);
  box-shadow: 0 0 0 1px var(--brand-blue), var(--shadow-pop);
  z-index: 1;
}
.plk-price-badge {
  position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
  background: var(--gradient-bridge-deck); color: #fff;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 4px 12px; border-radius: 11px; white-space: nowrap;
}
.plk-tier { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.015em; color: var(--ink); }
.plk-tier-sub { color: var(--ink-muted); font-size: 13px; min-height: 38px; line-height: 1.45; margin-top: 4px; }
.plk-price { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.035em; margin: 14px 0 2px; color: var(--ink); line-height: 1; }
.plk-price small { font-size: 14px; color: var(--ink-muted); font-family: var(--font-sans); font-weight: 500; letter-spacing: 0; }
.plk-price-note { font-size: 12px; color: var(--ink-faint); min-height: 18px; }
.plk-overage-note { font-size: 11.5px; color: var(--ink-muted); margin-top: 4px; line-height: 1.45; }

/* Card CTA (design .btn / .btn-blue / .btn-secondary) */
.plk-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 38px; padding: 0 14px; border-radius: var(--radius);
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em;
  border: 1px solid transparent; white-space: nowrap; text-decoration: none; width: 100%; margin-top: 18px;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}
.plk-btn:active { transform: translateY(0.5px); }
.plk-btn.lg { height: 42px; padding: 0 22px; font-size: 13.5px; width: auto; margin-top: 0; }
.plk-btn-blue { background: var(--brand-blue); color: #fff; }
.plk-btn-blue:hover { background: var(--brand-blue-deep); }
.plk-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border-strong); }
.plk-btn-secondary:hover { background: var(--surface-2); border-color: var(--border-strong); }
.plk-btn-outline { background: transparent; color: #fff; border-color: var(--navy-border); }
.plk-btn-outline:hover { background: var(--navy-surface); }

/* Feature list (design .price-feats) */
.plk-feats { list-style: none; padding: 0; margin: 20px 0 0; display: flex; flex-direction: column; gap: 11px; flex: 1; }
.plk-feats li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; color: var(--ink); line-height: 1.4; }
.plk-check { margin-top: 1px; flex-shrink: 0; }


.plk-fine { text-align: center; font-size: 12px; color: var(--ink-faint); line-height: 1.6; max-width: 880px; margin: 24px auto 0; }

/* FAQ (design .faq-item / .faq-q / .faq-a) */
.plk-faq-item { border-bottom: 1px solid var(--border); }
.plk-faq-q {
  width: 100%; text-align: left; background: none; border: none; padding: 18px 0;
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  font-size: 15px; font-weight: 600; color: var(--ink); cursor: pointer; min-height: 44px;
}
.plk-faq-a { overflow: hidden; color: var(--ink-muted); font-size: 14px; line-height: 1.6; }

/* Closing CTA row (design .row.center.gap-3) */
.plk-cta-row { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 26px; flex-wrap: wrap; }

/* ── Responsive (mirrors marketing.css pricing breakpoints) ─────────────── */
@media (max-width: 1100px) {
  .plk-pricing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .plk-pricing-grid { grid-template-columns: 1fr; }
  /* On mobile the CTA wraps to its own full-width row beneath the plan readout;
     add a clear gap so "≈ €X/mo" doesn't crowd the "Start with …" button. */
  .plk-reco-cta { margin-left: 0; width: 100%; margin-top: 16px; }
}
@media (max-width: 560px) {
  .plk-wrap { padding: 0 18px; }
  .plk-hero-inner { padding: 44px 18px 48px; }
  .plk-section { padding: 56px 0; }
  .plk-cta-row .plk-btn { width: 100%; }
  .plk-reco { padding: 18px 16px; }
}
`;
