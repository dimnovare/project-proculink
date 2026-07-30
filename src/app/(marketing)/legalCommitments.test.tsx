import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import DpaPage from "./dpa/page";
import SubprocessorsPage from "./subprocessors/page";
import SecurityPage from "./security/page";
import CustomersPage from "./customers/page";
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

function text(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.textContent ?? "";
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

describe("EU residency claim", () => {
  it("does not claim all order data is processed in the EU", () => {
    const body = text(<SecurityPage />);
    expect(body).not.toMatch(/all order data is processed and stored/i);
    expect(body).not.toMatch(/no data leaves the region/i);
  });

  it("names the EU-region infrastructure that can actually be checked", () => {
    const body = text(<SecurityPage />);
    expect(body).toMatch(/Cloudflare R2/);
    expect(body).toMatch(/Neon/);
    expect(body).toMatch(/europe-west4/);
  });

  it("discloses that named US subprocessors process data under SCCs", () => {
    const body = text(<SecurityPage />);
    expect(body).toMatch(/US subprocessors/i);
    expect(body).toMatch(/standard contractual clauses/i);
    // The four categories that actually leave the EU today.
    expect(body).toMatch(/AI document extraction/i);
    expect(body).toMatch(/inbound email/i);
    expect(body).toMatch(/payments/i);
  });

  it("links the residency claim to the subprocessor list", () => {
    expect(html(<SecurityPage />)).toContain('href="/subprocessors"');
  });

  it("keeps the home-page residency stat only if it links to the explanation", () => {
    const src = read("src/app/(home)/page.tsx");
    if (/label: "Data residency"/.test(src)) {
      expect(src).toMatch(/label: "Data residency",\s*href: "\/security"/);
    }
  });

  it("links the home-page footer residency line to the explanation", () => {
    const src = read("src/app/(home)/page.tsx");
    expect(src).not.toContain("<span>EU data residency</span>");
    expect(src).toMatch(/EU-region order storage/);
  });

  it("links the shared marketing footer residency line to the explanation", () => {
    const src = read("src/app/(marketing)/layout.tsx");
    expect(src).not.toContain("<span>EU data residency</span>");
    expect(src).toMatch(/EU-region order storage/);
  });

  it("drops the bare residency claim from the pricing fine print", () => {
    const src = read("src/app/(marketing)/pricing/page.tsx");
    expect(src).not.toMatch(/All plans include EU data residency/);
    expect(src).toMatch(/EU-region order storage/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /customers shipped two fabricated pilot profiles ("Mid-market wholesaler ·
// ~120 POs/month", "Industrial distributor · ~500 POs/month") behind a
// "Coming soon — anonymised pilot" badge. Production has no engagement that
// matches either, so the anonymisation was concealing invention rather than an
// identity. An anonymised-but-fabricated profile is the same defect as a named
// fake one, so the fix is an empty page that says so — not a softer fiction.

describe("customer references", () => {
  it("ships no invented pilot profiles", () => {
    const body = text(<CustomersPage />);
    expect(body).not.toMatch(/mid-market wholesaler/i);
    expect(body).not.toMatch(/industrial distributor/i);
    expect(body).not.toMatch(/POs\/month/i);
    expect(body).not.toMatch(/anonymised pilot/i);
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
