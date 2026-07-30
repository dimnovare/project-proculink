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
