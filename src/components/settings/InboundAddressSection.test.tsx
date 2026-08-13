/**
 * InboundAddressSection — behaviour.
 *
 * The load-bearing tests here are the HONESTY ones. This screen replaced a row that asserted a
 * working inbound address it had never verified, and the same shape has shipped repeatedly in this
 * product (an unfetched or failed query rendering as a confident "there is none"). So the suite
 * pins, specifically:
 *
 *   • loading and failed-load never claim there are no addresses, and never claim mail stopped;
 *   • a legacy address states the CONSEQUENCE of its expiry, not a bare date;
 *   • an address the server could not decrypt renders as un-displayable and STAYS revocable,
 *     rather than rendering blank or vanishing;
 *   • rotation copy says the old address keeps working, which is what the backend actually does;
 *   • revoking needs a second, informed click;
 *   • a non-administrator gets the role sentence, never a raw 403.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { InboundAddress } from "@/lib/api/inboundEmail";

const getInboundAddresses = vi.fn();
const rotateInboundAddress = vi.fn();
const revokeInboundAddress = vi.fn();

vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  // The pure helpers (state, expiry, kind constants) stay REAL — they are the logic under test.
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return {
    ...actual,
    getInboundAddresses: () => getInboundAddresses(),
    rotateInboundAddress: () => rotateInboundAddress(),
    revokeInboundAddress: (id: string) => revokeInboundAddress(id),
  };
});

import { InboundAddressSection } from "./InboundAddressSection";

function address(over: Partial<InboundAddress> = {}): InboundAddress {
  return {
    id: "addr-1",
    kind: "primary",
    label: "Primary",
    address: "a1b2c3d4e5f6@orders.proculink.eu",
    prefix: "a1b2",
    isActive: true,
    createdAt: "2026-08-01T00:00:00Z",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...over,
  };
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InboundAddressSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getInboundAddresses.mockResolvedValue([address()]);
});

afterEach(cleanup);

describe("InboundAddressSection — showing and copying the address", () => {
  it("renders the address the server issued", async () => {
    renderSection();
    expect(await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu")).toBeInTheDocument();
  });

  it("copies the address and confirms it visibly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /copy email address/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a1b2c3d4e5f6@orders.proculink.eu"));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });
});

describe("InboundAddressSection — never asserts what it has not verified", () => {
  it("does not claim there are no addresses while the list is still loading", () => {
    // A promise that never settles: the component is pinned mid-load.
    getInboundAddresses.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/returned no email addresses/i)).not.toBeInTheDocument();
  });

  it("on a failed load, says it could not read them and does NOT claim mail stopped", async () => {
    getInboundAddresses.mockRejectedValue(new Error("boom"));
    renderSection();

    expect(await screen.findByText(/could not load your email addresses/i)).toBeInTheDocument();
    // The failure is about READING the list. It must not be reported as an absence…
    expect(screen.queryByText(/returned no email addresses/i)).not.toBeInTheDocument();
    // …nor as an interruption to delivery, which a failed GET says nothing about.
    expect(screen.getByText(/orders already being emailed to your address are unaffected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("keeps an address that cannot be decrypted visible and revocable", async () => {
    getInboundAddresses.mockResolvedValue([address({ address: null })]);
    renderSection();

    expect(await screen.findByText(/cannot be displayed, so it cannot be copied/i)).toBeInTheDocument();
    // It may still be accepting mail, so the one control that stops it must remain.
    expect(screen.getByRole("button", { name: /^revoke$/i })).toBeInTheDocument();
    // And it must not offer to copy an address it does not have.
    expect(screen.queryByRole("button", { name: /copy email address/i })).not.toBeInTheDocument();
  });

  it("omits the last-received line rather than guessing when the server has no record", async () => {
    getInboundAddresses.mockResolvedValue([address({ lastUsedAt: null })]);
    renderSection();

    await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu");
    expect(screen.queryByText(/last received/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/never/i)).not.toBeInTheDocument();
  });
});

describe("InboundAddressSection — legacy addresses state the consequence of expiry", () => {
  it("names what stops working, not just the date", async () => {
    const future = new Date(Date.now() + 90 * 86_400_000).toISOString();
    getInboundAddresses.mockResolvedValue([address({ kind: "legacy_slug", expiresAt: future })]);
    renderSection();

    expect(await screen.findByText(/Older address/)).toBeInTheDocument();
    // A bare date is the failure this screen exists to prevent.
    expect(
      screen.getByText(/purchase orders emailed to it will not arrive/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/stops working on/i)).toBeInTheDocument();
  });

  it("reports an already-expired address as no longer arriving", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    getInboundAddresses.mockResolvedValue([address({ kind: "legacy_slug", expiresAt: past })]);
    renderSection();

    expect(await screen.findByText("Stopped working")).toBeInTheDocument();
    expect(screen.getByText(/no longer arrive/i)).toBeInTheDocument();
    // Nothing to revoke on an address that already stopped.
    expect(screen.queryByRole("button", { name: /^revoke$/i })).not.toBeInTheDocument();
  });

  // Guards the "unknown value renders as the favourable one" failure this repo keeps hitting: the
  // warning is keyed on the EXPIRY, so a kind this build has never seen still gets warned about.
  it("warns about an unrecognised kind that carries an expiry", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    getInboundAddresses.mockResolvedValue([address({ kind: "some_future_kind", expiresAt: future })]);
    renderSection();

    expect(await screen.findByText(/Older address/)).toBeInTheDocument();
    expect(screen.getByText(/will not arrive/i)).toBeInTheDocument();
  });

  // The converse: an unrecognised kind with no expiry must not be crowned "Current address".
  it("does not call an unrecognised kind the current address", async () => {
    getInboundAddresses.mockResolvedValue([address({ kind: "some_future_kind" })]);
    renderSection();

    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Current address")).not.toBeInTheDocument();
  });
});

describe("InboundAddressSection — rotating", () => {
  it("says the existing address keeps working, because it does", async () => {
    renderSection();
    await screen.findByText("a1b2c3d4e5f6@orders.proculink.eu");

    expect(
      screen.getByText(/keep receiving purchase orders until you revoke them/i),
    ).toBeInTheDocument();
  });

  it("mints a new address and shows it", async () => {
    rotateInboundAddress.mockResolvedValue([
      address({ id: "addr-2", address: "ffffffffffff@orders.proculink.eu" }),
      address(),
    ]);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /create a new address/i }));

    expect(await screen.findByText("ffffffffffff@orders.proculink.eu")).toBeInTheDocument();
    expect(rotateInboundAddress).toHaveBeenCalledTimes(1);
  });
});

describe("InboundAddressSection — revoking is deliberate and irreversible", () => {
  it("does not revoke on the first click, and states the consequence before the second", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));

    expect(revokeInboundAddress).not.toHaveBeenCalled();
    expect(screen.getByText(/stop arriving from the next message onward/i)).toBeInTheDocument();
    expect(screen.getByText(/senders are not told/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("revokes only after the confirming click", async () => {
    revokeInboundAddress.mockResolvedValue([address({ isActive: false, revokedAt: "2026-08-13T00:00:00Z" })]);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole("button", { name: /revoke this address/i }));

    await waitFor(() => expect(revokeInboundAddress).toHaveBeenCalledWith("addr-1"));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });

  it("backs out without calling the API", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep it/i }));

    expect(revokeInboundAddress).not.toHaveBeenCalled();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });
});

describe("InboundAddressSection — a member who is not an administrator", () => {
  const forbidden = () =>
    new ApiHttpError("requires_org_admin", 403, { error: "requires_org_admin" });

  it("explains the role refusal on revoke instead of showing a raw 403", async () => {
    revokeInboundAddress.mockRejectedValue(forbidden());
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole("button", { name: /revoke this address/i }));

    expect(
      await screen.findByText(/only an administrator of your organisation can do this/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/403/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires_org_admin/)).not.toBeInTheDocument();
  });

  it("explains the role refusal on rotate", async () => {
    rotateInboundAddress.mockRejectedValue(forbidden());
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /create a new address/i }));

    expect(
      await screen.findByText(/ask an administrator to make the change for you/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/requires_org_admin/)).not.toBeInTheDocument();
  });

  // A refusal for lack of a ROLE must never be reported as a transient failure worth retrying —
  // that is the "try again" copy the generic branch uses, and it would be a lie here.
  it("does not tell a refused member to try again", async () => {
    rotateInboundAddress.mockRejectedValue(forbidden());
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /create a new address/i }));
    await screen.findByText(/only an administrator of your organisation can do this/i);

    expect(screen.queryByText(/try again in a moment/i)).not.toBeInTheDocument();
  });
});
