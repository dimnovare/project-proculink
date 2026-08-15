// WP-27 — the delivery step must offer a connection a user can finish alone.
//
// First run used to dead-end here. Four options were listed, HTTP first, none
// preselected, and the Email blurb pointed at the supplier ("Your supplier just wants
// the order emailed to one or more addresses") — so a brand-new user read all four as
// "I need to go ask them for something" and stopped.
//
// Email is the one option that needs nothing from the other company: mail leaves from
// ProcuLink's provider-verified sender, so the far end supplies an address and nothing
// else (DeliveryProtocolConstants.Email). On day one that address can be the user's
// own. These tests pin it as the first, visibly-recommended option, and pin the helper
// line that tells the user why.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeliveryGuidedSetup } from "./DeliveryGuidedSetup";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

vi.mock("@/lib/api/delivery", () => ({
  // `null` = the API's 204, i.e. nothing configured — the state this wizard is offered in.
  getDeliveryConfig: vi.fn().mockResolvedValue(null),
  upsertDeliveryConfig: vi.fn().mockResolvedValue(undefined),
  testFireDelivery: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn(),
}));

function renderSetup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryGuidedSetup supplierId="sup-1" nounLower="supplier" />
    </QueryClientProvider>,
  );
}

function openPicker() {
  renderSetup();
  fireEvent.click(screen.getByRole("button", { name: /set up step by step/i }));
}

describe("guided delivery setup — the default connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers Email FIRST, ahead of every option that needs the other company", () => {
    openPicker();

    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => /email|http webhook|sftp|ftps/i.test(t));

    expect(labels[0]).toMatch(/email/i);
    // …and the options that DO need someone else are still offered, just after it.
    expect(labels.join(" | ")).toMatch(/http webhook/i);
    expect(labels.join(" | ")).toMatch(/sftp/i);
  });

  it("marks Email as the recommended option", () => {
    openPicker();

    const emailOption = screen
      .getAllByRole("button")
      .find((b) => /^email/i.test((b.textContent ?? "").trim()));

    expect(emailOption).toBeDefined();
    expect(emailOption!.textContent).toMatch(/recommended/i);
  });

  it("explains that Email is the one option needing nothing from them", () => {
    openPicker();

    // The load-bearing sentence: without it the picker is just a reordered list and a
    // first-run user still believes every option is blocked on somebody else.
    expect(
      screen.getByText(/every option below except email needs something from them first/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/put your own address in/i),
    ).toBeInTheDocument();
  });

  it("does not describe Email as something the supplier has to want", () => {
    openPicker();
    expect(
      screen.queryByText(/your supplier just wants the order emailed/i),
    ).toBeNull();
  });
});
