import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PricingPage from "./page";

// WP-11 defect #4 — /pricing must say what cancelling does BEFORE you buy.
//
// Cancelling a subscription flips the workspace to a state where ProcuLink refuses
// EVERY ingest path: inbound email, IMAP polling, SFTP and S3 pickups, the REST
// ingress API, and browser uploads. Orders simply stop arriving. Today a customer
// discovers that only when a supplier asks why their purchase order never came
// through — the pricing page said nothing, and the FAQ's "Can I change plans later?"
// answer ("up or down, any time") actively implies the opposite.
//
// The other trust-commitment tests in this folder pin retracted promises so they
// cannot come back. This one pins the reverse: a disclosure that must not quietly
// disappear, because removing it makes the page misleading again.
//
// It also guards the plain-language rule. The internal status name for this state is
// a snake_case token; a buyer must never be shown it, and the page must not lean on
// "paused"/"frozen" jargon without saying what actually stops.

function text(ui: React.ReactElement) {
  const { container } = render(ui);
  return container.textContent ?? "";
}

afterEach(cleanup);

describe("/pricing cancellation disclosure", () => {
  it("tells the buyer that cancelling stops new orders being accepted", () => {
    const body = text(<PricingPage />);

    expect(body).toMatch(/cancel/i);
    // The consequence, not just the word "cancel".
    expect(body).toMatch(/stop|no longer/i);
  });

  it("names the channels that stop, so 'we only use email' readers are covered", () => {
    const body = text(<PricingPage />);
    const disclosure = body.slice(body.search(/If you cancel/i));

    expect(disclosure).toMatch(/email/i);
    expect(disclosure).toMatch(/SFTP/i);
    expect(disclosure).toMatch(/API/i);
  });

  it("says existing data stays readable, so the warning is not read as data loss", () => {
    const body = text(<PricingPage />);
    const disclosure = body.slice(body.search(/If you cancel/i));

    expect(disclosure).toMatch(/still|keep|remain/i);
  });

  it("tells the buyer to redirect suppliers, since nothing is queued for later", () => {
    const body = text(<PricingPage />);
    const disclosure = body.slice(body.search(/If you cancel/i));

    expect(disclosure).toMatch(/redirect|point .* elsewhere|before you cancel/i);
  });

  it("never leaks the internal status name or unexplained jargon", () => {
    const body = text(<PricingPage />);

    expect(body).not.toMatch(/read_only/);
    expect(body).not.toMatch(/read-only/i);
    expect(body).not.toMatch(/frozen/i);
  });
});
