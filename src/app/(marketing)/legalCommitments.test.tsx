import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DpaPage from "./dpa/page";
import SubprocessorsPage from "./subprocessors/page";
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
