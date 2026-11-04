import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { Card } from "@/components/bridge/layout/Card";
import { COMPANY_TRUST_LINE, LEGAL_ENTITY } from "@/lib/legal-entity";
import { PLAN_BY_ID } from "@/lib/plans";
import { PilotApplicationForm } from "./PilotApplicationForm";

// ─────────────────────────────────────────────────────────────────────────────
// /pilot — the Pilot Programme page. It replaces /customers, which now 308s here
// (src/lib/retired-routes.ts).
//
// /customers existed to say there were no public references yet. That was honest,
// and it made the absence the content. This page says the same true thing the useful
// way round: there is a programme, here is what it involves, and a named reference is
// something agreed with a client — only with their approval of wording and figures —
// not something this page claims to have. It describes NO existing pilot, customer or
// result. legalCommitments.test.tsx pins that, in the voice rules it carried for
// /customers.
//
// Claims on this page are the ones the product makes true by default:
//   • no ERP or integration needed to start — upload accepts PDF, Excel (XLSX), CSV, XML;
//   • the supplier needs no account or new software;
//   • real, test or anonymised orders all work;
//   • nothing is sent automatically unless the client switches auto-delivery on;
//   • a confirmed item-code match is saved per supplier and reused on later orders.
// Output is never described as PDF or Excel — ProcuLink reads those formats, it does
// not write them.
//
// The supported-pilot terms (free, roughly 60–90 days, one repeat supplier, discounted
// access for a named reference) are a COMMERCIAL commitment written from the advisor's
// pilot proposal. They need founder sign-off before this ships — see the PR body.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata = pageMetadata({
  path: "/pilot",
  title: "Pilot programme — ProcuLink",
  description:
    "Test ProcuLink FREE on one repeat supplier. Start with the PDF, Excel or CSV order you already use, review the result before anything is sent, and decide on evidence.",
  ogDescription:
    "A FREE supported pilot on one repeat supplier: your item codes matched to the supplier's once, then reused on later orders. Review first, automate later.",
});

const PILOT = PLAN_BY_ID.pilot;

const GOOD_TEST_CASE = [
  "You order from the same supplier every week or every month.",
  "Your item or part numbers are not the same as the supplier's.",
  "Someone looks the supplier's codes up in a spreadsheet, a catalogue, an old order or from memory.",
  "Your orders go out as PDF, Excel or CSV files, usually by email.",
];

const HOW_IT_WORKS: Array<[string, string]> = [
  [
    "FREE, for roughly 60–90 days",
    "Long enough for repeat orders to show whether reusing your item-code matches really makes the next order easier.",
  ],
  [
    "One repeat supplier",
    "One supplier workflow is the whole pilot. The rest of your purchasing stays exactly as it is.",
  ],
  [
    "Review first",
    "ProcuLink prepares the supplier-ready order; you check it and send it yourself. Nothing is sent automatically unless you choose to.",
  ],
  [
    "Your supplier doesn't need to join",
    "They don't need an account or new software. If you later switch on email delivery, they keep receiving an ordinary email with the order attached.",
  ],
  [
    "Real, test or anonymised orders",
    "Start with whatever you are comfortable sharing. No ERP or integration is needed — you upload the files you already create.",
  ],
  [
    "A baseline before the first result",
    "Before we start, we agree a simple baseline, so the decision at the end rests on evidence rather than on “it feels quicker”.",
  ],
  [
    "Afterwards, your decision",
    "If the pilot proves useful, you decide whether to continue. If you are willing to become a named reference, we can discuss discounted ongoing access — and nothing is published without your approval of the wording and figures.",
  ],
];

const MEASURES: Array<[string, string]> = [
  [
    "Straight-through rate",
    "The share of orders that reach supplier-ready output without anyone correcting a match or changing the result. It should rise as matches are reused.",
  ],
  [
    "Supplier corrections and queries",
    "Orders your supplier rejected, held, queried or asked you to correct and resend.",
  ],
  [
    "Minutes per comparable order",
    "Measured on representative orders before and during the pilot, with first-time setup recorded separately.",
  ],
  [
    "Orders done by hand anyway",
    "When a suitable order still goes the old way, we note why. It is one of the most useful things a pilot can tell us.",
  ],
];

const CHECKABLE: Array<[string, string]> = [
  ["/security", "Security"],
  ["/privacy", "Privacy"],
  ["/dpa", "DPA"],
  ["/subprocessors", "Subprocessors"],
  ["/formats", "Formats and channels"],
];

export default function PilotPage() {
  return (
    <div className="plk-pilot">
      <style>{PILOT_CSS}</style>

      {/* ── Opening ─────────────────────────────────────────────────────── */}
      <header className="plk-pilot-wrap plk-pilot-hero">
        <span className="plk-pilot-eyebrow">
          <span className="plk-pilot-eyebrow-dot" aria-hidden />
          Pilot programme
        </span>
        <h1 className="plk-pilot-h1">Would you like to test ProcuLink on one repeat supplier — FREE?</h1>
        <p className="plk-pilot-lead">
          A useful pilot does not need to involve your whole purchasing process. One repeat
          supplier is a good place to start.
        </p>
        <p className="plk-pilot-p">
          A good test case is one where your team currently looks up supplier item codes, changes a
          file by hand or corrects the same kind of order again and again. You can start with real,
          test or anonymised orders, and nothing needs to be sent automatically while you evaluate
          the result.
        </p>
        <div className="plk-pilot-ctas">
          <a href="#apply" className="plk-pilot-btn plk-pilot-btn-primary">
            Apply for a FREE supported pilot <span aria-hidden>→</span>
          </a>
          <Link href="/book-demo" className="plk-pilot-btn plk-pilot-btn-secondary">
            Prefer to talk first? Book a 20-minute call
          </Link>
        </div>
      </header>

      {/* ── The problem the pilot tests ──────────────────────────────────── */}
      {/* edge="bridge": this card is about the RELATIONSHIP between a buyer-side code and a
          supplier-side code — a field mapping, which is exactly what the edge rule reserves
          "spans both" for (src/components/bridge/layout/Card.tsx). */}
      <section className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-codes">
        <Card edge="bridge">
          <h2 id="pilot-codes" className="plk-pilot-h2">
            Your item number is not always your supplier&apos;s item number.
          </h2>
          <p className="plk-pilot-p">
            ProcuLink remembers the match between the two, so nobody has to look it up every time
            you order. You confirm a supplier&apos;s code once; the match is saved for that supplier
            and reused on later orders.
          </p>
          <div className="plk-pilot-match" aria-hidden>
            <span className="plk-pilot-code plk-pilot-code-buyer">Your item code</span>
            <span className="plk-pilot-arrow">→</span>
            <span className="plk-pilot-code plk-pilot-code-supplier">Supplier&apos;s item code</span>
            <span className="plk-pilot-saved">Saved for the next order</span>
          </div>
          <p className="plk-pilot-p plk-pilot-muted">
            Wrong or missing supplier codes can mean an order is queried, corrected or held after
            you thought it had gone through.
          </p>
        </Card>
      </section>

      {/* ── Who it suits ─────────────────────────────────────────────────── */}
      <section className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-fit">
        <h2 id="pilot-fit" className="plk-pilot-h2">What a good test case looks like</h2>
        <ul className="plk-pilot-list">
          {GOOD_TEST_CASE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-how">
        <h2 id="pilot-how" className="plk-pilot-h2">How the supported pilot works</h2>
        <dl className="plk-pilot-terms">
          {HOW_IT_WORKS.map(([term, detail]) => (
            <div key={term} className="plk-pilot-term">
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── What gets measured ───────────────────────────────────────────── */}
      <section className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-measure">
        <h2 id="pilot-measure" className="plk-pilot-h2">What we measure together</h2>
        <p className="plk-pilot-p">
          We write down how the workflow runs today, then compare the same workflow after enough
          repeat orders to see whether it genuinely improved.
        </p>
        <div className="plk-pilot-grid">
          {MEASURES.map(([title, detail]) => (
            <Card key={title} as="article">
              <h3 className="plk-pilot-h3">{title}</h3>
              <p className="plk-pilot-small">{detail}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Two different things called "pilot" ──────────────────────────── */}
      {/* The self-service Pilot's terms are read off the plan ladder, never typed: this page
          must not quote a trial size the pricing page has moved past. */}
      <section className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-vs">
        <h2 id="pilot-vs" className="plk-pilot-h2">Supported pilot or self-service Pilot?</h2>
        <div className="plk-pilot-grid plk-pilot-grid-2">
          <Card as="article">
            <h3 className="plk-pilot-h3">Self-service {PILOT.name}</h3>
            <p className="plk-pilot-small">
              {PILOT.priceLabel} for {PILOT.priceCadence} · {PILOT.orderLimit} orders ·{" "}
              {PILOT.supplierLimit} {PILOT.supplierLimit === 1 ? "supplier" : "suppliers"} · no credit
              card. Explore on your own, at your own pace.
            </p>
            <Link href={PILOT.cta.href} className="plk-pilot-link">
              {PILOT.cta.label} <span aria-hidden>→</span>
            </Link>
          </Card>
          <Card as="article">
            <h3 className="plk-pilot-h3">Supported pilot</h3>
            <p className="plk-pilot-small">
              FREE for roughly 60–90 days on one repeat supplier, with hands-on help and a baseline
              agreed up front. You apply, and we reply to agree whether it is a fit.
            </p>
            <a href="#apply" className="plk-pilot-link">
              Apply below <span aria-hidden>↓</span>
            </a>
          </Card>
        </div>
      </section>

      {/* ── Application ──────────────────────────────────────────────────── */}
      <section id="apply" className="plk-pilot-wrap plk-pilot-section" aria-labelledby="pilot-apply">
        <h2 id="pilot-apply" className="plk-pilot-h2">Apply for a FREE supported pilot</h2>
        <p className="plk-pilot-p">
          A few questions about how you order today. We don&apos;t ask which supplier — that is
          agreed later, once you have decided a pilot is worth exploring. We reply within one
          business day.
        </p>
        <PilotApplicationForm />
        <p className="plk-pilot-p plk-pilot-after-form">
          Prefer to talk first?{" "}
          <Link href="/book-demo" className="plk-pilot-link">
            Book a 20-minute call <span aria-hidden>→</span>
          </Link>
        </p>
      </section>

      {/* ── Company trust ────────────────────────────────────────────────── */}
      {/* An accountable company a procurement buyer can look up and contract with — the legal
          entity, its registry code and where it is registered — instead of a founder profile. */}
      <section className="plk-pilot-wrap plk-pilot-section plk-pilot-last" aria-labelledby="pilot-about">
        <h2 id="pilot-about" className="plk-pilot-h2">About ProcuLink</h2>
        <p className="plk-pilot-p">
          ProcuLink is developed and operated by {LEGAL_ENTITY.legalName}, an Estonian company
          registered in Tallinn. It was created around a simple purchasing problem: buyers
          repeatedly translating their own item codes and order data into the form individual
          suppliers expect.
        </p>
        <p className="plk-pilot-trust">{COMPANY_TRUST_LINE}</p>
        <nav aria-label="Check before you apply" className="plk-pilot-checks">
          {CHECKABLE.map(([href, label]) => (
            <Link key={href} href={href} className="plk-pilot-link">
              {label}
            </Link>
          ))}
          <a href="mailto:hello@proculink.eu" className="plk-pilot-link">
            hello@proculink.eu
          </a>
        </nav>
      </section>
    </div>
  );
}

// Page-scoped CSS. Every colour is a token — the design-token gate (scripts/check-tokens.mjs)
// ledgers raw hex and numeric colour functions per file in BOTH directions; this file has none.
const PILOT_CSS = `
.plk-pilot { background: var(--surface); color: var(--ink); }
.plk-pilot-wrap { max-width: 880px; margin: 0 auto; padding: 0 32px; }
.plk-pilot-hero { padding-top: 64px; padding-bottom: 8px; }
.plk-pilot-section { margin-top: 56px; }
.plk-pilot-last { padding-bottom: 88px; }
.plk-pilot-eyebrow {
  display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px; border-radius: 13px;
  background: var(--brand-blue-soft); color: var(--brand-blue-deep);
  font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
}
.plk-pilot-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-blue); }
.plk-pilot-h1 {
  font-family: var(--font-display); font-weight: 700; font-size: clamp(30px, 4.4vw, 46px);
  line-height: 1.08; letter-spacing: -0.03em; margin: 18px 0 0; max-width: 22ch; text-wrap: balance;
}
.plk-pilot-lead { font-size: clamp(16px, 1.7vw, 18.5px); line-height: 1.6; color: var(--ink); margin: 20px 0 0; max-width: 62ch; }
.plk-pilot-h2 { font-family: var(--font-display); font-size: clamp(21px, 2.4vw, 26px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 14px; text-wrap: balance; }
.plk-pilot-h3 { font-family: var(--font-display); font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 6px; }
.plk-pilot-p { font-size: 15px; line-height: 1.7; color: var(--ink-muted); margin: 14px 0 0; max-width: 66ch; }
.plk-pilot-h2 + .plk-pilot-p { margin-top: 0; }
.plk-pilot-muted { font-size: 13.5px; }
.plk-pilot-small { font-size: 13.5px; line-height: 1.6; color: var(--ink-muted); margin: 0; }
.plk-pilot-ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.plk-pilot-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 20px;
  border-radius: var(--radius); font-size: 14px; font-weight: 600; text-decoration: none; border: 1px solid transparent;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
.plk-pilot-btn-primary { background: var(--brand-blue); color: var(--surface); }
.plk-pilot-btn-primary:hover { background: var(--brand-blue-deep); }
.plk-pilot-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border-strong); }
.plk-pilot-btn-secondary:hover { background: var(--surface-2); }
.plk-pilot-match { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 18px; }
.plk-pilot-code {
  font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; padding: 6px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.plk-pilot-code-buyer { color: var(--brand-blue-deep); border-color: var(--brand-blue); }
.plk-pilot-code-supplier { color: var(--brand-green-deep); border-color: var(--brand-green); }
.plk-pilot-arrow { color: var(--ink-muted); font-weight: 700; }
.plk-pilot-saved { font-size: 12.5px; font-weight: 600; color: var(--brand-green-deep); }
.plk-pilot-list { margin: 0; padding-left: 20px; display: grid; gap: 8px; max-width: 66ch; }
.plk-pilot-list li { font-size: 15px; line-height: 1.6; color: var(--ink-muted); }
.plk-pilot-terms { margin: 0; display: grid; gap: 0; border-top: 1px solid var(--border); }
.plk-pilot-term { display: grid; grid-template-columns: minmax(0, 15rem) minmax(0, 1fr); gap: 6px 24px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.plk-pilot-term dt { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.plk-pilot-term dd { margin: 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-muted); }
.plk-pilot-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
.plk-pilot-grid-2 { margin-top: 0; }
.plk-pilot-link {
  display: inline-flex; align-items: center; gap: 4px; min-height: 44px;
  color: var(--brand-blue-deep); font-weight: 600; font-size: 14px; text-decoration: underline; text-underline-offset: 2px;
}
.plk-pilot-after-form { margin-top: 10px; }
.plk-pilot-trust { font-family: var(--font-mono); font-size: 12.5px; color: var(--ink); margin: 14px 0 0; overflow-wrap: anywhere; }
.plk-pilot-checks { display: flex; flex-wrap: wrap; gap: 0 20px; margin-top: 6px; }
@media (max-width: 640px) {
  .plk-pilot-wrap { padding: 0 16px; }
  .plk-pilot-hero { padding-top: 44px; }
  .plk-pilot-section { margin-top: 44px; }
  .plk-pilot-grid { grid-template-columns: 1fr; }
  .plk-pilot-term { grid-template-columns: 1fr; }
  .plk-pilot-btn { width: 100%; }
}
`;
