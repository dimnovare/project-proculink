import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
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
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function html(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.innerHTML;
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
const ABSOLUTE_RESIDENCY_PROMISE =
  /\b(all|every|no|nothing)\b[^.]{0,60}\b(order )?data\b[^.]{0,60}\b(EU|EEA|region)\b/i;

// The same promise in its other grammar: nothing ever leaves.
const NOTHING_LEAVES_PROMISE =
  /\b(no|none|nothing)\b[^.]{0,60}\bleaves?\b[^.]{0,60}\b(EU|EEA|region|country|Europe)\b/i;

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
