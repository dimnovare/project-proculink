import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import OnePagerPage from "./one-pager/page";
import { stripComments, syntaxFor } from "@/test/sourceScan";
import DpaPage from "./dpa/page";
import SubprocessorsPage from "./subprocessors/page";
import SecurityPage from "./security/page";
import CustomersPage from "./customers/page";
import PrivacyPage from "./privacy/page";
import PricingPage from "./pricing/page";
import MarketingLayout from "./layout";
import HomePage from "@/app/(home)/page";
import SignInPage from "@/app/sign-in/[[...sign-in]]/page";
import SignUpPage from "@/app/sign-up/[[...sign-up]]/page";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { SUBPROCESSORS_UPDATED } from "@/lib/subprocessors";
import { SETUP_FEE_NOTE } from "@/lib/plans";

// Trust-commitment audit (2026-07-24), same spirit as the J2 fabrication purge:
// a legal page may only promise what a solo-founder operation actually does.
//
// Two commitments were stated as hard, staffed guarantees that no process
// backed:
//
//   1. /dpa — "We will return a counter-signed PDF within 5 business days."
//      legal@proculink.eu does now deliver (Cloudflare Email Routing forwards
//      to the founder), so the request channel is real. The turnaround is a
//      best effort by one person, not an SLA, and must read that way.
//
//   2. /dpa Annex III + /subprocessors — "subscribe to change notifications …
//      we track the subscriber list manually". There is no list and no mailing
//      mechanism. The honest mechanism is the page itself: dated, published in
//      advance, with planned changes stated before they take effect.
//
// These assertions are deliberately phrased as "the retracted promise must not
// come back", because that is the failure mode — copy drifting back toward a
// guarantee nobody staffs.

// Rendered text, as a visitor reads it.
//
// NOT container.textContent. That concatenates adjacent nodes with nothing
// between them — a card titled "Where your data lives" followed by a body
// starting "All order data…" reads as "livesAll order data", and the auth
// panel reads "fully auditedEU data residency". Every \b-anchored assertion
// then silently stops matching at exactly the seam where copy changes, which
// is the worst possible place for a copy test to go blind. Joining the text
// nodes with a space restores the word boundaries.
//
// <style> contents are text nodes too; CSS tokens are not copy, so they go.
function text(ui: React.ReactElement) {
  const { container } = render(ui);
  return visibleText(container);
}

function visibleText(root: HTMLElement) {
  root.querySelectorAll("style,script").forEach((el) => el.remove());
  // A disclosure the reader cannot see is not a disclosure. Refuting this file
  // found three ways to keep every positive assertion green while hiding the
  // text from users: wrap it in `hidden`, in `aria-hidden="true"`, or in
  // `display:none`. jsdom does no layout, so this is a source-level
  // approximation — it catches the shapes an editor would actually write, not
  // every CSS path that could hide something.
  root
    .querySelectorAll('[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"]')
    .forEach((el) => el.remove());
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function html(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.innerHTML;
}

/**
 * The visible text of one <h2> section: the heading's following siblings, up to
 * the next <h2>.
 *
 * Needed because the legal pages each render the FULL subprocessor table further
 * down, so a page-wide `toMatch(/OpenAI/)` passes no matter what the prose above
 * it says. That is the same vacuity that let "AI document extraction" ship while
 * the table said "…and mapping suggestions" — the 2026-07-30 pass fixed it for
 * /security with `residencyCard()`, and every later section assertion needs the
 * same scoping or it inherits the bug.
 */
function section(ui: React.ReactElement, heading: RegExp): string {
  const { container } = render(ui);
  const h = Array.from(container.querySelectorAll("h2")).find((el) =>
    heading.test(el.textContent ?? ""),
  );
  expect(h, `an <h2> matching ${heading}`).toBeTruthy();
  const parts: string[] = [];
  let stopped = false;
  for (let el = (h as HTMLElement).nextElementSibling; el; el = el.nextElementSibling) {
    if (el.tagName === "H2") { stopped = true; break; }
    parts.push(visibleText(el as HTMLElement));
  }
  // If this is not the last <h2> on the page, the sibling walk MUST have met
  // another one. When it does not, the page has been restructured — a single
  // wrapper <div> around the rest of the document is enough — and this helper
  // silently returns the whole remainder, INCLUDING the subprocessor table that
  // supplies every string the positive assertions look for. A scoped guard
  // quietly becoming a page-wide grep is worse than no guard, so it fails here.
  const headings = Array.from(container.querySelectorAll("h2"));
  expect(
    stopped || headings[headings.length - 1] === h,
    `section(${heading}) ran to the end of the page without meeting the next <h2> — the DOM was restructured and this assertion is no longer scoped`,
  ).toBe(true);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Source-text reads for the two pages that are heavy client components
// (the home page hero + footer, the pricing fine print). Same pattern as
// src/test/plain-language-copy.test.ts — cheap, and no Clerk/query provider.
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

afterEach(cleanup);

describe("/dpa counter-signature commitment", () => {
  it("does not promise a staffed counter-signature turnaround", () => {
    const body = text(<DpaPage />);
    expect(body).not.toMatch(/we will return a counter-signed/i);
    expect(body).not.toMatch(/within 5 business days\./i);
  });

  it("keeps the counter-signature offer, as a best effort with a real inbox", () => {
    const body = text(<DpaPage />);
    expect(body).toMatch(/counter-sign/i);
    expect(body).toMatch(/aim to/i);
    expect(body).toContain("legal@proculink.eu");
  });

  it("names the operating entity from the legal-entity source", () => {
    const body = text(<DpaPage />);
    expect(body).toContain(LEGAL_ENTITY.legalName);
    expect(body).toContain(LEGAL_ENTITY.registryCode);
  });
});

describe("subprocessor change notice", () => {
  it("does not offer a subscriber list on /dpa Annex III", () => {
    const body = text(<DpaPage />);
    expect(body).not.toMatch(/subscribe to change notifications/i);
    expect(body).not.toMatch(/subscriber list/i);
    expect(body).not.toMatch(/Subprocessor notifications/);
  });

  it("does not offer a subscriber list on /subprocessors", () => {
    const body = text(<SubprocessorsPage />);
    expect(body).not.toMatch(/subscribe to subprocessor change notifications/i);
    expect(body).not.toMatch(/subscriber list/i);
    expect(body).not.toMatch(/we will email all subscribers/i);
  });

  it("keeps the 30-day commitment and ties it to this dated page", () => {
    const body = text(<SubprocessorsPage />);
    expect(body).toMatch(/30 days/);
    expect(body).toMatch(/source of truth/i);
    expect(body).toContain(SUBPROCESSORS_UPDATED);
  });

  it("states whether a subprocessor change is currently pending", () => {
    const body = text(<SubprocessorsPage />);
    expect(body).toMatch(/planned changes/i);
  });

  it("routes objections to the inbox that is known to deliver", () => {
    const body = text(<SubprocessorsPage />);
    expect(body).toContain("legal@proculink.eu");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup-fee waiver claim (2026-07-30) — same class as the two fabricated pilot
// profiles purged from /customers.
//
// SETUP_FEE_NOTE closed with "waived for early design partners", which asserts
// that early design partners EXIST and are receiving that waiver. A read-only
// census of the production Neon database on 2026-07-30 says otherwise:
//
//   9 organisations; exactly ONE has ever held an order (25 orders, 35 delivery
//   attempts, 30 suppliers, plan=growth, active Stripe subscription) — the
//   founder's own operating org, slug personal-workspace-d3be. The other 8 are
//   pre-launch shells created 2026-05-28…2026-06-03: 0 orders, 0 delivery
//   attempts, no billing email, no Stripe subscription, all pilot/trialing.
//
// So there is no non-founder org that could have been waived. The fee, the
// amounts and the "arranged manually" mechanics are all real and must stay
// disclosed — only the tense of the waiver was false. It is now a standing
// offer ("we will waive it for the first design partners we take on"), which
// the founder can honour on the day someone takes it up.
//
// Phrased as "the retracted claim must not come back", because that is the
// failure mode: copy drifting back toward implied customers we do not have.

// Prettier wraps JSX text, so compare whitespace-normalised source. The source
// reader itself is `read`, declared with the other helpers at the top of this
// file — this suite used to carry a second, identical copy of it.
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("setup-fee design-partner waiver", () => {
  it("does not claim early design partners are already being waived", () => {
    expect(SETUP_FEE_NOTE).not.toMatch(/waived for early design partners/i);
    expect(SETUP_FEE_NOTE).not.toMatch(/early design partners/i);
  });

  it("states the waiver as an offer we can still honour", () => {
    expect(SETUP_FEE_NOTE).toMatch(/we will waive it for the first design partners we take on/i);
  });

  it("keeps the fee, the amounts and the manual mechanics disclosed", () => {
    expect(SETUP_FEE_NOTE).toContain("€500 per supplier for the first 3, then €150 each");
    expect(SETUP_FEE_NOTE).toMatch(/arranged manually/i);
    expect(SETUP_FEE_NOTE).toMatch(/never auto-charged/i);
  });

  it("keeps the note on the pricing page", () => {
    expect(read("src/app/(marketing)/pricing/page.tsx")).toContain("{SETUP_FEE_NOTE}");
  });

  it("says the same thing in the ROI calculator fine print", () => {
    const src = flat(read("src/components/marketing/ROICalculator.tsx"));
    expect(src).not.toMatch(/waived for early design partners/i);
    expect(src).not.toMatch(/early design partners/i);
    expect(src).toMatch(/we will waive it for the first design partners we take on/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Marketing truth audit (2026-07-30) — WP-10.
//
// /security claimed: "All order data is processed and stored in EU-region
// infrastructure. No data leaves the region without an explicit, contracted
// subprocessor agreement."
//
// Both sentences were false as written. src/lib/subprocessors.ts already lists
// four US subprocessors (Clerk, OpenAI, Stripe, Postmark), and the backend's
// appsettings.Production.json sets Ai:Provider=openai with no endpoint
// override — the OpenAI ChatClient is constructed with (model, apiKey) only,
// so purchase-order line text is sent to api.openai.com in the US on the
// default AI path. Routine US processing is the norm, not a contracted
// exception, and no data-residency claim may imply otherwise.
//
// Phrased as "the absolute promise must not come back", because that is the
// failure mode: copy drifting back toward a guarantee the architecture breaks.
//
// ── Second pass, 2026-07-30 ──────────────────────────────────────────────────
// The first correction shipped with assertions that pinned nothing. Five
// separate rewrites put the false copy back while this file still reported
// every test green:
//
//   1. quoting the retracted sentence ("all order data is processed and
//      stored") let a word-order swap plus "Nothing" for "No data" through;
//   2. quoting the two invented pilot profiles let a reworded pair through;
//   3. the home-page stat guard sat inside `if (label exists)`, so deleting
//      the label deleted the check;
//   4. the footer pins read SOURCE TEXT, so `{/* … */}<span >…</span>` beat
//      both a `not.toContain` and its positive twin;
//   5. the `href="/subprocessors"` check passed against the original false
//      copy — that link predates the correction entirely.
//
// So: assert RENDERED text everywhere (every page in this suite renders under
// jsdom without a Clerk provider), pin the SHAPE of the promise rather than
// its wording, and scope the link check to the card that actually makes the
// claim.

// An absolute quantifier governing our data, and a region, in one sentence.
// This is the shape of the promise, so a rewrite cannot slip past it.
// WIDENED 2026-07-31. Ten attempted bypasses were written against the first
// version — /\b(all|every|no|nothing)\b[^.]{0,60}\b(order )?data\b[^.]{0,60}\b(EU|EEA|region)\b/i
// — and ten of ten walked through it:
//
//   "Any order data you send stays in the EU."               quantifier outside the list
//   "100% of order data is stored in the EU."                same
//   "All order FILES are stored and processed in the EU."    one noun swapped, guard gone
//   "All customer data (incl. purchase orders) is in the EU."  the dot in "incl." ends [^.]
//   "Nothing you upload ever leaves the European Union."     \bEU\b does not match "European"
//   "All order data stays on servers in the Netherlands."    a country is not a "region"
//
// Every one of those reads to a customer exactly like the sentence this file
// retracted. So the noun, the quantifier and the place-name all widen, the hop
// distance doubles, and an abbreviation no longer terminates the window.
//
// This is a SHAPE guard, not a truth oracle: it cannot tell a true residency
// sentence from a false one, and deleting the word "All" quiets it without
// changing what a reader understands. The coupling rule below is the guard that
// does not depend on grammar.
const QUANTIFIER = String.raw`\b(all|every|any|each|none|no|nothing|entire|whole)\b|100\s*%`;
const OUR_DATA = String.raw`\b(data|files?|documents?|information|records?|orders?|uploads?)\b`;
// The lookbehind is load-bearing. "…processes Controller personal data OUTSIDE
// the EEA, [SCCs] apply" is a DISCLOSURE of a transfer, not a promise of
// residency — it is the honest half of the DPA, and without this it trips the
// guard. A shape guard that fires on the disclosure and not on the promise
// would push copy in exactly the wrong direction.
const EU_PLACE = String.raw`(?<!\boutside\s(?:of\s)?(?:the\s)?)\b(EU|EEA|European|Europe|region|Frankfurt|Amsterdam|Netherlands|Germany|Ireland)\b`;
// [^.] stops at "incl.", so "All customer data (incl. purchase orders) is stored
// in the EU" escapes the guard on a punctuation mark.
//
// The obvious repair — "a dot ends the sentence only if followed by whitespace
// and a CAPITAL" — silently does nothing here, because these regexes carry the
// `i` flag and `[A-Z]` under `i` matches lowercase too. It looked right, it read
// right, and it changed no behaviour at all. Case cannot be part of the test.
//
// So: a dot stays INSIDE the window when it sits inside a word (decimals, €0.50)
// or when it closes a known abbreviation. Anything else ends the sentence.
const ABBREV = String.raw`(?:incl|etc|approx|vs|e\.g|i\.e|no|nos|max|min|Ltd|Inc|Co)`;
const SAME_SENTENCE = String.raw`(?:[^.]|\.(?=\S)|(?<=\b${ABBREV})\.)`;

const ABSOLUTE_RESIDENCY_PROMISE = new RegExp(
  `(?:${QUANTIFIER})${SAME_SENTENCE}{0,120}${OUR_DATA}${SAME_SENTENCE}{0,120}${EU_PLACE}`,
  "i",
);

// The same promise in its other grammar: nothing ever leaves.
// "never" was missing from the quantifier list, which is exactly why the
// retracted "documents never leave your region" sailed past both guards
// everywhere except the one card that happened to pin it by hand.
const NOTHING_LEAVES_PROMISE = new RegExp(
  `\\b(no|none|nothing|never)\\b${SAME_SENTENCE}{0,120}\\bleaves?\\b${SAME_SENTENCE}{0,120}(?:${EU_PLACE}|\\bcountry\\b)`,
  "i",
);

// The card on /security that actually makes the residency claim. Assertions
// about that claim are scoped to it: the same page also renders the whole
// subprocessor table, and a page-wide grep is satisfied by the table no matter
// what the claim says. That is how "AI document extraction and mapping
// suggestions" passed while the card said only the first half.
function residencyCard(): HTMLElement {
  const { container } = render(<SecurityPage />);
  const card = Array.from(container.querySelectorAll("article")).find((el) =>
    /US subprocessors/i.test(visibleText(el as HTMLElement)),
  );
  expect(card, "the /security card that makes the residency claim").toBeTruthy();
  return card as HTMLElement;
}

describe("EU residency claim", () => {
  it("does not promise that all data stays in the region", () => {
    const body = text(<SecurityPage />);
    expect(body).not.toMatch(ABSOLUTE_RESIDENCY_PROMISE);
    expect(body).not.toMatch(NOTHING_LEAVES_PROMISE);
  });

  it("names the EU-region infrastructure that can actually be checked", () => {
    const body = text(<SecurityPage />);
    expect(body).toMatch(/Cloudflare R2/);
    expect(body).toMatch(/Neon/);
    expect(body).toMatch(/Railway/);
  });

  it("prints no Railway region identifier, because we do not have a real one", () => {
    // "europe-west4" is not a Railway region id at all — the EU West id is
    // "europe-west4-drams3a" — and the only thing that ever cited it was a
    // comment in our own subprocessor file. A precise wrong location is
    // harder to defend than an absent one, so it is absent.
    expect(text(<SecurityPage />)).not.toMatch(/europe-west4/i);
    expect(text(<SubprocessorsPage />)).not.toMatch(/europe-west4/i);
    expect(text(<PrivacyPage />)).not.toMatch(/europe-west4/i);
  });

  it("discloses that named US subprocessors process data under SCCs", () => {
    const card = visibleText(residencyCard());
    expect(card).toMatch(/standard contractual clauses/i);
    expect(card).toMatch(/sign-in/i);
    expect(card).toMatch(/payments/i);
  });

  it("gives the AI subprocessor its whole purpose, not half of it", () => {
    // /subprocessors says "AI document extraction and mapping suggestions".
    // The card said only the first half, which reads as if mapping suggestions
    // were computed somewhere else. They are not: the same OpenAI call sites,
    // none of them overriding the base URL, reach api.openai.com.
    expect(visibleText(residencyCard())).toMatch(
      /AI document extraction and mapping suggestions/i,
    );
  });

  it("says the purchase order itself is emailed through a US provider", () => {
    // "Inbound email" named half the exposure. The email delivery channel
    // attaches the generated purchase order and sends it to the supplier
    // through the same US provider, which has no EU option to enable.
    const card = visibleText(residencyCard());
    expect(card).toMatch(/purchase orders we email/i);
    expect(card).toMatch(/passes through a US provider/i);
  });

  it("names the outbound network route as unknown, not as EU", () => {
    // Nothing in the product pins where our traffic leaves from, and the one
    // measurement anyone ever took came back United States. Softening that to
    // "probably EU" would be the same defect in a friendlier direction, so the
    // card has to say it does not know.
    const card = visibleText(residencyCard());
    expect(card).toMatch(/cannot tell you( today)? which country/i);
    expect(card).not.toMatch(
      /(route|path|traffic)[^.]{0,80}\b(stays|remains|is|leaves) (in|within|from) the EU\b/i,
    );
  });

  it("keeps the residency claim one click from the list that qualifies it", () => {
    expect(residencyCard().querySelector('a[href="/subprocessors"]')).not.toBeNull();
  });

  it("keeps the home-page residency stat linked to the explanation", () => {
    const { container } = render(<HomePage />);
    const stat = Array.from(container.querySelectorAll("a")).find((a) =>
      /residency/i.test(a.textContent ?? ""),
    );
    expect(stat, 'the hero "Data residency" stat').toBeTruthy();
    expect(stat?.getAttribute("href")).toBe("/security");
  });

  it("links the home-page footer residency line to the explanation", () => {
    expectQualifiedFooter(<HomePage />);
  });

  it("links the shared marketing footer residency line to the explanation", () => {
    expectQualifiedFooter(<MarketingLayout>{null}</MarketingLayout>);
  });

  it("drops the bare residency claim from the pricing fine print", () => {
    const body = text(<PricingPage />);
    // No \b anchors: textContent runs adjacent elements together, so
    // "…fully auditedEU data residency" has no word boundary before "EU" —
    // that is exactly how the sign-in page's copy of this line escaped.
    expect(body).not.toMatch(/EU data residency/i);
    expect(body).toMatch(/EU-region order storage/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Third pass, 2026-07-31 — WP-10 remediation.
//
// The 2026-07-30 correction rewrote /security and pinned it hard. Both of the
// two regexes above were applied to /security ONLY, so the identical promise
// stayed live, untouched and untested, on two other pages for a day:
//
//   • /pricing FAQ  — "All order data is stored AND PROCESSED in the EU"
//   • /dpa   §4     — "All Controller personal data is processed in EU-region
//                      or EU-compliant infrastructure"
//
// Both match ABSOLUTE_RESIDENCY_PROMISE exactly as written. Nothing ran it
// against them. This is the WP-30 lesson in a different file: the SENTENCE was
// swept on one page, the CLAIM was not, and a per-page assertion repeats that
// mistake every time. So the guard is now a page TABLE — adding a public page
// to this suite subscribes it to the promise check automatically, and the only
// way to escape is to delete the page from the table, which is visible in review.
//
// The failure message prints the offending match, because "PricingPage matched
// ABSOLUTE_RESIDENCY_PROMISE" without the text is a 20-minute scavenger hunt.

const PUBLIC_PAGES: Array<[string, () => React.ReactElement]> = [
  ["/security", () => <SecurityPage />],
  ["/subprocessors", () => <SubprocessorsPage />],
  ["/privacy", () => <PrivacyPage />],
  ["/dpa", () => <DpaPage />],
  ["/pricing", () => <PricingPage />],
  ["/customers", () => <CustomersPage />],
  ["/one-pager", () => <OnePagerPage />],
  ["/ (home)", () => <HomePage />],
  ["marketing layout", () => <MarketingLayout>{null}</MarketingLayout>],
  ["/sign-in", () => <SignInPage />],
  ["/sign-up", () => <SignUpPage />],
];

// A page that mentions EU residency at all, in ANY grammar.
//
// The two regexes above both require a QUANTIFIER and the token "data", so they
// are blind to the claim's most common shape: a bare noun phrase. "/one-pager"
// carried "EU-region infrastructure." as its entire trust section and matched
// neither. So the third guard is not another forbidden phrase — it is a COUPLING
// rule, and it is the one the packet actually states: a residency claim may stand
// only where the qualification is present or one click away.
const MENTIONS_RESIDENCY = /\bEU[-\s]region\b|\bdata residency\b|\bresidency\b/i;

// The qualification, in either of the two forms that count.
const NAMES_THE_OTHER_HALF =
  /\bUS subprocessors?\b|\bstandard contractual clauses\b|\bSCCs?\b|\boutside the EEA\b|\bOpenAI\b|\bPostmark\b/i;

describe("no page promises what the architecture breaks", () => {
  // /sign-in and /sign-up branch on the Clerk env vars at render time; CI sets
  // placeholder keys. Pin the unconfigured branch so they render their own
  // AuthShell rather than Clerk's <SignIn />, which needs a provider.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [name, page] of PUBLIC_PAGES) {
    it(`makes no absolute residency promise on ${name}`, () => {
      const body = text(page());
      // Anchor: a page that renders nothing passes every negative assertion.
      expect(body.length, `${name} rendered no text`).toBeGreaterThan(80);
      const absolute = body.match(ABSOLUTE_RESIDENCY_PROMISE);
      expect(absolute?.[0], `${name} promises: "${absolute?.[0]}"`).toBeUndefined();
      const leaves = body.match(NOTHING_LEAVES_PROMISE);
      expect(leaves?.[0], `${name} promises: "${leaves?.[0]}"`).toBeUndefined();
    });

    it(`qualifies its residency claim, or links to it, on ${name}`, () => {
      const { container } = render(page());
      const body = visibleText(container);
      expect(body.length, `${name} rendered no text`).toBeGreaterThan(80);
      if (!MENTIONS_RESIDENCY.test(body)) return; // no claim, nothing to qualify

      const linked = container.querySelector('a[href="/security"], a[href="/subprocessors"]');
      const qualified = NAMES_THE_OTHER_HALF.test(body);
      expect(
        linked !== null || qualified,
        `${name} claims EU residency but neither names the US subprocessors nor links to /security or /subprocessors`,
      ).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Where the two corrected pages must now be POSITIVELY right. A negative guard
// alone is satisfied by deleting the section, and a deleted disclosure is a
// worse outcome than a badly-worded one.

describe("/dpa international transfers", () => {
  const clause = () => section(<DpaPage />, /international transfers/i);

  it("does not hide the transfer behind an undefined term", () => {
    // "EU-compliant infrastructure" is defined nowhere in the GDPR or in this
    // document. It was carrying the false half of "All Controller personal data
    // is processed in EU-region or EU-compliant infrastructure".
    expect(clause()).not.toMatch(/EU-compliant/i);
  });

  it("discloses that named categories are processed outside the EEA", () => {
    const body = clause();
    expect(body).toMatch(/outside the EEA/i);
    expect(body).toMatch(/United States/i);
  });

  it("names the outbound purchase order as one of those transfers", () => {
    // Postmark attaches the generated artifact and sends it to the supplier
    // over api.postmarkapp.com. A DPA that lists "email" without saying the
    // order itself travels leaves the reader to guess the exposure.
    expect(clause()).toMatch(/purchase order/i);
  });

  it("discloses the AI transfer as widely as the marketing pages do", () => {
    // /security and /privacy both say "AI document extraction and mapping
    // suggestions". A contract that discloses only the first half discloses
    // LESS than the marketing copy — which is the wrong way round, and is the
    // same half-a-purpose defect that shipped for Postmark and for OpenAI on
    // /security itself.
    expect(clause()).toMatch(/mapping suggestions/i);
  });

  it("keeps the Article 46 safeguard UNIVERSAL, not scoped to a closed list", () => {
    // A draft ended "…apply to those transfers", whose antecedent is the four
    // categories named in the sentence before. That drops SCC cover from every
    // other non-EEA sub-processor — Vercel, Sentry, PostHog, Cloudflare,
    // Railway — and from any sub-processor added later, which clause 3 of this
    // same document promises to add on 30 days' notice. The conditional has to
    // quantify over ANY sub-processor, or the safeguard shrinks silently.
    const body = clause();
    expect(body).toMatch(/standard contractual clauses/i);
    expect(body).toMatch(/2021\/914/);
    expect(body).toMatch(/\bany sub-?processor\b/i);
    expect(body).not.toMatch(/apply to those transfers/i);
  });

  it("asserts no storage region, because this document covers personal data", () => {
    // A draft opened "Controller personal data is stored in EU-region
    // infrastructure", borrowing a frame from /security. It does not transfer:
    // /security is about ORDER data; Annex I here lists account name, work
    // email and organisation, which Clerk holds in the US (EU residency
    // "available", not enabled), Stripe holds billing identity in the US, and
    // Postmark holds message content in the US. Under Art. 4(2) storage is
    // processing, so the sentence also contradicted the one that followed it.
    const body = clause();
    expect(body).not.toMatch(/stored in EU/i);
    expect(body).not.toMatch(/EU-region/i);
  });
});

describe("/privacy data storage and residency", () => {
  const residency = () => section(<PrivacyPage />, /data storage and residency/i);

  it("names the US providers that receive order content", () => {
    // Scoped to the section on purpose: this page renders the full SUBPROCESSORS
    // table lower down, so a page-wide grep for these three passes even when the
    // residency section omits them — which is exactly what it used to do.
    const body = residency();
    expect(body).toMatch(/OpenAI/);
    expect(body).toMatch(/Postmark/);
    expect(body).toMatch(/Stripe/);
  });

  it("says the purchase order itself is carried by a US provider", () => {
    expect(residency()).toMatch(/purchase orders we email to your suppliers/i);
  });

  it("separates storage from the outbound route, and calls the route unknown", () => {
    const body = residency();
    expect(body).toMatch(/cannot tell you( today)? which country/i);
    expect(body).not.toMatch(
      /(route|path|traffic)[^.]{0,80}\b(stays|remains|is|leaves) (in|within|from) the EU\b/i,
    );
  });

  it("does not hide the transfer behind an undefined term", () => {
    expect(residency()).not.toMatch(/EU-compliant/i);
  });

  it("does not sharpen the unsourced regions into an aggregate claim", () => {
    // The lead-in went "Your data is stored in EU-region OR EU-COMPLIANT
    // infrastructure" → "…are stored in EU-region infrastructure" in a first
    // draft. Dropping the disjunct strengthened an unsourced claim on no new
    // evidence — the #42 defect exactly. Railway, Neon and R2 regions are still
    // unsourced; the per-vendor strings below are inherited unchanged, and the
    // lead-in must not aggregate them into a promise none of them carries.
    const lead = residency().split(/File storage/)[0];
    expect(lead).not.toMatch(/\bstored in EU/i);
    expect(lead).not.toMatch(/\bEU-region infrastructure\b/i);
  });

  it("describes the no-AI mode the same way /security does", () => {
    // Both pages describe Organisation.SelfHostedOcr. /security stopped calling it
    // "self-hosted" because nothing runs on customer infrastructure; if /privacy
    // keeps the old word, the site says two different things about one flag —
    // which is precisely how Postmark shipped as inbound-only for months.
    expect(residency()).not.toMatch(/self-hosted/i);
    expect(residency()).toMatch(/turned AI extraction off/i);
  });
});

describe("/pricing residency answer", () => {
  const answer = () => text(<PricingPage />);

  it("does not claim EU processing, only EU storage", () => {
    // The FAQ said "stored and processed in the EU". Storage is our position;
    // processing is contradicted by OpenAI and Postmark, both US, both on the
    // normal path. The word that made it false was "processed".
    expect(answer()).not.toMatch(/stored and processed in the EU/i);
    expect(answer()).not.toMatch(/processed[^.]{0,40}\bin the EU\b/i);
  });

  it("discloses the US subprocessors in the same breath as the storage claim", () => {
    const body = answer();
    expect(body).toMatch(/US subprocessors/i);
    expect(body).toMatch(/standard contractual clauses/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /security "Responsible AI" — the no-AI mode is real, and the card oversold it.
//
// `Organisation.SelfHostedOcr` genuinely suppresses OpenAI at six chokepoints,
// each with a strict-mock Times.Never test, and fails safe. That guarantee is
// worth stating. What the card added on top of it was not true:
//
//   • "runs entirely in your environment" — the OCR engine runs in-process in
//     OUR Railway containers. No customer-deployable artifact exists.
//   • "documents never leave your region" — they go to Railway, Neon and R2
//     exactly as for every other org.
//   • "Enterprise customers can opt into" — zero write sites, no endpoint, no
//     settings screen, no BillingFeature/PlanConstants entry. It is a manual
//     toggle we set, not an opt-in, and it is bound to no plan.
//
// Scoped to the card, like residencyCard(): /security also renders the whole
// subprocessor table, and a page-wide grep for "OpenAI" is satisfied by that
// table no matter what this card claims.

// Matched on the HEADING, and required to be UNIQUE.
//
// The first version searched every <article> for the words "Responsible AI"
// anywhere in its text. An earlier card that merely mentions "responsible AI" in
// prose then satisfies the search, `find` returns it, and three of the five
// negatives below pass against a card that was never under test while the real
// one carries the false sentence. A decoy mutation proved exactly that.
function aiCard(): HTMLElement {
  const { container } = render(<SecurityPage />);
  const matches = Array.from(container.querySelectorAll("article")).filter((el) =>
    /^\s*Responsible AI\s*$/i.test(el.querySelector("h3,h2")?.textContent ?? ""),
  );
  expect(matches.length, 'exactly one /security card headed "Responsible AI"').toBe(1);
  return matches[0] as HTMLElement;
}

describe("the no-AI mode is described as what it is", () => {
  // Every negative here runs TWICE: once scoped to the card, and once over the
  // whole page. Scoping alone is beatable by moving the sentence to a different
  // card — the text survives verbatim and the scoped assertion never sees it.
  // These three claims are false wherever they appear on this page.
  const bothScopes = (re: RegExp, label: string) => {
    expect(visibleText(aiCard()), `${label} (in the Responsible AI card)`).not.toMatch(re);
    expect(text(<SecurityPage />), `${label} (anywhere on /security)`).not.toMatch(re);
  };

  it("does not claim anything runs in the customer's environment", () => {
    bothScopes(/in your environment/i, "runs in your environment");
    bothScopes(/\bself-hosted\b/i, "self-hosted");
    bothScopes(/on-?prem/i, "on-prem");
  });

  it("does not claim documents stay in the customer's region", () => {
    bothScopes(/(never|not) leaves? your (region|country|environment)/i, "never leaves your region");
    bothScopes(NOTHING_LEAVES_PROMISE, "nothing ever leaves");
  });

  it("does not sell it as a plan feature or a self-serve opt-in", () => {
    // No BillingFeature member, no PlanConstants.MinimumPlan row, no write site.
    // The /i matters: "available to enterprise customers on request" beat the
    // case-sensitive version of this assertion, which was the only
    // case-sensitive one in the file.
    bothScopes(/opt in(to)?\b|opt-in/i, "opt-in");
    expect(visibleText(aiCard())).not.toMatch(/\benterprise\b/i);
  });

  it("keeps the guarantee that is actually true and enforced", () => {
    const body = visibleText(aiCard());
    expect(body).toMatch(/nothing about its orders reaches OpenAI/i);
    expect(body).toMatch(/on request/i);
  });

  it("says plainly that it does not move where files are stored", () => {
    expect(visibleText(aiCard())).toMatch(/does not change where your files are stored/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Surfaces the render table cannot reach, guarded by SOURCE TEXT instead.
//
// /settings needs Clerk + a QueryClient, and there are 30+ help articles in MDX.
// Rendering all of them here would be slow and brittle, but leaving them out is
// how all three of these shipped: the residency retraction was applied to the
// pages someone thought of, and these were not on the list. A source scan is a
// weaker instrument than a render, and it is enormously stronger than nothing.

const APP_SRC = join(ROOT, "src", "app");

// Comments MUST come out before any of these scans. The first draft of the
// "Workspace region" guard failed against its own explanatory comment — the one
// that quotes the retired label to say why it is retired. A source scan cannot
// tell copy from a note about copy, so it has to be given code only. Reuses the
// repo's stripper (src/test/sourceScan.ts) rather than a second implementation:
// that one has already been fixed once, for a URL-scheme bug in `prev !== ":"`.
const code = (rel: string) => flat(stripComments(read(rel), syntaxFor(rel)));

function everyFile(dir: string, ext: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, ext, acc);
    else if (entry.endsWith(ext)) acc.push(full);
  }
  return acc;
}

// Marketing pages deliberately NOT in PUBLIC_PAGES, each with the reason. The
// point of the list is that it is a list: a page can be left out, but leaving it
// out is an edit somebody reviews, not a thing nobody notices. "Adding a page
// subscribes it to the check" was untrue while the only mechanism was memory —
// which is the same mechanism that missed /pricing and /dpa on 30 July.
const NOT_IN_THE_TABLE: Record<string, string> = {
  "terms": "no residency or subprocessor claim; contract terms only",
  "aup": "acceptable-use rules only",
  "formats": "format/channel capability table, no data-location claim",
  "how-it-works": "product walkthrough, no data-location claim",
  "changelog": "dated release notes",
  "support": "contact routes only",
  "book-demo": "scheduling embed",
  "welcome": "post-checkout confirmation",
  "watch": "video page",
  "help": "help index; the articles themselves are scanned as source below",
  "help/guides": "guide index; same",
};

// ─────────────────────────────────────────────────────────────────────────────
// The guard, tested against itself.
//
// Every sentence below was written by someone trying to restore the retracted
// promise past the FIRST version of these regexes, and every one succeeded. They
// are kept as a fixture because a regex that is never tested on its own inputs
// is a regex nobody will dare widen later — and because the honest half has to
// keep passing, or the guard starts pushing copy away from disclosure.

const MUST_BE_CAUGHT: Array<[string, string]> = [
  ["quantifier outside the original list", "Any order data you send stays in the EU."],
  ["a percentage as the quantifier", "100% of order data is stored and processed in the EU."],
  ["'entire' as the quantifier", "Your entire order history is stored and processed in the EU."],
  ["'files' instead of 'data'", "All order files are stored and processed in the EU."],
  ["'information' instead of 'data'", "No order information ever leaves our European infrastructure."],
  ["'documents' instead of 'data'", "All documents you upload are stored in the EU."],
  ["an abbreviation mid-sentence", "All customer data (incl. purchase orders) is stored in the EU."],
  ["a city instead of a region", "All order data is stored and processed in Frankfurt."],
  ["a country instead of a region", "All order data stays on servers in the Netherlands."],
  ["'European' rather than 'EU'", "Nothing you upload ever leaves the European Union."],
  ["a long run-up to the noun", "All of the purchase orders you upload, together with everything we derive from them, remain data we keep in the EU."],
  ["'never' rather than 'nothing'", "Your documents never leave the EU."],
  ["the original retracted sentence", "All order data is stored and processed in the EU and encrypted with AES-GCM at rest."],
  ["the original DPA sentence", "All Controller personal data is processed in EU-region or EU-compliant infrastructure."],
];

// The other half of the job: these are TRUE and must not be blocked. A guard
// that fires on an honest disclosure teaches the next author to disclose less.
const MUST_BE_ALLOWED: Array<[string, string]> = [
  ["disclosing a transfer out", "Where any sub-processor processes Controller personal data outside the EEA, the relevant Standard Contractual Clauses apply."],
  ["naming the US categories", "Some processing runs on named US subprocessors under standard contractual clauses — sign-in, AI extraction, payments, and email in both directions."],
  ["admitting the route is unknown", "The network path out to your supplier is chosen by our hosting provider and is not pinned to a region by us, so we cannot tell you today which country an outbound delivery leaves from."],
  ["a narrow storage statement", "Order storage is EU-region and encrypted with AES-GCM at rest."],
  ["the no-AI guarantee", "We can also turn AI extraction off for an organisation entirely, so nothing about its orders reaches OpenAI."],
  // This one pins the sentence boundary itself. Widening the window to tolerate
  // abbreviations is only safe while a REAL full stop still ends it — otherwise
  // the guard quietly becomes "these words appear somewhere on the page", fires
  // on unrelated pairs, and gets weakened again by whoever hits the false alarm.
  ["a quantifier and a region in DIFFERENT sentences", "Every order is validated before delivery. Our error monitoring runs in the EU region."],
];

describe("the promise guard catches the ways round it", () => {
  for (const [why, sentence] of MUST_BE_CAUGHT) {
    it(`catches ${why}`, () => {
      const hit =
        ABSOLUTE_RESIDENCY_PROMISE.test(sentence) || NOTHING_LEAVES_PROMISE.test(sentence);
      expect(hit, `neither guard fires on: "${sentence}"`).toBe(true);
    });
  }

  for (const [why, sentence] of MUST_BE_ALLOWED) {
    it(`allows ${why}`, () => {
      const absolute = sentence.match(ABSOLUTE_RESIDENCY_PROMISE);
      expect(absolute?.[0], `blocked an honest sentence on: "${absolute?.[0]}"`).toBeUndefined();
      const leaves = sentence.match(NOTHING_LEAVES_PROMISE);
      expect(leaves?.[0], `blocked an honest sentence on: "${leaves?.[0]}"`).toBeUndefined();
    });
  }
});

describe("the residency guard covers the marketing surface", () => {
  it("has every marketing page either in the table or explicitly excluded", () => {
    const marketing = join(ROOT, "src", "app", "(marketing)");
    const pages = everyFile(marketing, "page.tsx")
      .map((f) => f.slice(marketing.length + 1).replace(/\\/g, "/").replace(/\/page\.tsx$/, ""))
      .filter((r) => !r.includes("[")); // dynamic segments render per-slug, not as a page
    const covered = new Set(
      PUBLIC_PAGES.map(([name]) => name.replace(/^\/|\s.*$/g, "")).concat(Object.keys(NOT_IN_THE_TABLE)),
    );
    const unaccounted = pages.filter((r) => !covered.has(r));
    expect(
      unaccounted,
      "marketing pages in neither PUBLIC_PAGES nor NOT_IN_THE_TABLE — add them to one",
    ).toEqual([]);
  });

  it("finds the marketing pages at all", () => {
    // Anchor. If the walk returns nothing the assertion above is vacuous, and a
    // path that silently stops matching is exactly how a coverage gate dies.
    expect(everyFile(join(ROOT, "src", "app", "(marketing)"), "page.tsx").length).toBeGreaterThan(12);
  });
});

describe("in-app and help surfaces make the same claim as the legal pages", () => {
  it("does not present a per-workspace region that nothing configures", () => {
    // Nothing stores or sets a workspace region. The row said "Workspace region
    // — EU" inside a block badged Fixed, next to a genuinely fixed fact, which
    // read as a configured guarantee to a paying customer.
    const src = code("src/app/(app)/settings/page.tsx");
    expect(src).not.toMatch(/Workspace region/i);
    expect(src).toMatch(/Order storage/);
  });

  it("keeps the in-app storage claim one click from the page that qualifies it", () => {
    const src = code("src/app/(app)/settings/page.tsx");
    // The claim and the link have to be in the same element, not merely both
    // present somewhere in a 1,900-line file.
    expect(src).toMatch(/<Link href="\/security"[^>]*>EU-region<\/Link>/);
  });

  it("attributes the no-AI mode to no plan or tier in any help article", () => {
    // /security stopped calling this an Enterprise opt-in because there is no
    // BillingFeature member, no PlanConstants.MinimumPlan row and no write site
    // for the flag. A help article that still calls it an enterprise option
    // re-sells exactly what the trust page just retracted.
    const articles = everyFile(APP_SRC, ".mdx");
    expect(articles.length, "help articles to scan").toBeGreaterThan(10);
    const offenders = articles
      .map((f) => [f, flat(stripComments(readFileSync(f, "utf8"), "mdx"))] as const)
      .filter(([, body]) => /no-egress|AI extraction turned off|turned AI extraction off/i.test(body))
      .filter(([, body]) => /\b(enterprise|business|integration|distributor|operations|growth)\b[^.]{0,40}\b(option|plan|tier|feature|only)\b/i.test(body));
    expect(
      offenders.map(([f]) => relativeToSrc(f)),
      "help articles selling the no-AI mode as a plan feature",
    ).toEqual([]);
  });
});

const relativeToSrc = (f: string) => f.slice(f.indexOf(join("src", "app")));

/**
 * A footer may say where orders are STORED, and must link to the page that
 * qualifies it. Scoped to <footer>: the home hero legitimately carries an
 * "EU / Data residency" stat, which is allowed precisely because it is a link.
 */
function expectQualifiedFooter(ui: React.ReactElement) {
  const { container } = render(ui);
  const footer = container.querySelector("footer");
  expect(footer, "a <footer> to check").toBeTruthy();
  expect(visibleText(footer as HTMLElement)).not.toMatch(/EU data residency/i);
  const link = Array.from((footer as HTMLElement).querySelectorAll("a")).find(
    (a) => (a.textContent ?? "").trim() === "EU-region order storage",
  );
  expect(link, 'the "EU-region order storage" link').toBeTruthy();
  expect(link?.getAttribute("href")).toBe("/security");
}

// ─────────────────────────────────────────────────────────────────────────────
// The sign-in and sign-up brand panels kept the bare "EU data residency" line
// that was removed from three footers for over-claiming — unlinked, on the two
// highest-intent pages on the site. Same claim, same fix.

describe("sign-in and sign-up trust line", () => {
  const AUTH_PAGES: Array<[string, () => React.ReactElement]> = [
    ["sign-in", () => <SignInPage />],
    ["sign-up", () => <SignUpPage />],
  ];

  // Both pages branch at render time on the Clerk env vars, and CI sets
  // placeholder keys where a dev machine has none — so without pinning this,
  // the suite renders Clerk's real <SignIn /> on CI and dies on "useSession can
  // only be used within the <ClerkProvider />". Pin the unconfigured branch:
  // AuthShell renders the same AuthBrandPanel in all three branches, so the
  // trust line under test is identical either way.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [name, page] of AUTH_PAGES) {
    it(`does not carry the bare residency claim on /${name}`, () => {
      const body = text(page());
      // Anchor: without this the negative below passes just as happily on a
      // page that stopped rendering the brand panel at all.
      expect(body).toMatch(/AES-GCM at rest/);
      expect(body).not.toMatch(/EU data residency/i);
    });

    it(`qualifies the claim and links it on /${name}`, () => {
      const { container } = render(page());
      const link = Array.from(container.querySelectorAll("a")).find(
        (a) => (a.textContent ?? "").trim() === "EU-region order storage",
      );
      expect(link, 'the "EU-region order storage" link').toBeTruthy();
      expect(link?.getAttribute("href")).toBe("/security");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /customers shipped two fabricated pilot profiles ("Mid-market wholesaler ·
// ~120 POs/month", "Industrial distributor · ~500 POs/month") behind a
// "Coming soon — anonymised pilot" badge. Production has no engagement that
// matches either, so the anonymisation was concealing invention rather than an
// identity. An anonymised-but-fabricated profile is the same defect as a named
// fake one, so the fix is an empty page that says so — not a softer fiction.
//
// Quoting the two retired profiles was useless as a guard: "a mid-sized
// wholesaler, roughly 120 purchase orders a month" restores both of them word
// for word past every literal pin. What actually distinguishes the honest page
// from the dishonest one is VOICE — the page is allowed to quote one invented
// profile as the specimen it refuses to publish, and it does exactly that in
// the "Why it is empty" panel. Outside quotation marks the page is speaking in
// its own voice, and there it may not describe a customer we do not have.
//
// Two independent guards, because one is always beatable:
//   • voice   — no archetype, volume or pilot language outside quotation marks;
//   • arity   — at most ONE archetype anywhere, quoted or not. Two profiles
//               need two archetypes, so the restored pair dies even if someone
//               puts both of them inside quotes.

// Built fresh on each use: a /g regex carries lastIndex between calls.
const ARCHETYPE = "\\b(wholesaler|distributor|retailer|manufacturer|reseller|merchant)s?\\b";

/** Drop quoted spans — a quotation is a specimen, not a claim. */
const unquoted = (s: string) => s.replace(/[“"][^“”"]*[”"]/g, " ");

describe("customer references", () => {
  it("describes no customer in the page's own voice", () => {
    const body = unquoted(text(<CustomersPage />));
    expect(body).not.toMatch(new RegExp(ARCHETYPE, "i"));
    expect(body).not.toMatch(/\b\d[\d,.]*\s*\+?\s*(purchase orders|orders|POs)\b/i);
    expect(body).not.toMatch(/\b(pilots?|design partners?|case stud(y|ies))\b/i);
  });

  it("ships no second profile, quoted or not", () => {
    const body = text(<CustomersPage />);
    expect((body.match(new RegExp(ARCHETYPE, "gi")) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("does not claim pilots or customers we cannot point at", () => {
    const body = text(<CustomersPage />);
    expect(body).not.toMatch(/we(?:'|&apos;|’)?re in early pilots/i);
    expect(body).not.toMatch(/procurement teams using ProcuLink/i);
  });

  it("states plainly that there are no public references yet", () => {
    const body = text(<CustomersPage />);
    expect(body).toMatch(/no public (customer )?references/i);
  });

  it("offers checkable capability pages instead of social proof", () => {
    const markup = html(<CustomersPage />);
    expect(markup).toContain('href="/formats"');
    expect(markup).toContain('href="/security"');
  });
});
