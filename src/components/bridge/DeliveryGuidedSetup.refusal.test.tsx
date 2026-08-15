// A-F5b and A-F5c — the guided delivery wizard.
//
// ── A-F5b: a plan-gate 403 was rendered as its machine token ─────────────────────────────
//
// `src/lib/api/delivery.ts` deliberately keeps `<capability>_requires_<plan>` in the thrown
// message ("the string may not move: PlanGateNotice reads the code back out of it"). The full
// editor has a reader for it. This wizard — which writes through the SAME `upsertDeliveryConfig`
// — had none, and rendered `err.message` into a red box, so a refused save read
//
//     API error 403: delivery_config_requires_growth
//
// ── A-F5c: the wizard's credential write had no keep/block guard at all ──────────────────
//
// `buildCredentialsJson()` emitted `'{"type":"none"}'` for HTTP unconditionally, on the stated
// assumption that "this is a fresh config from the wizard, so there is never a saved credential
// to preserve". That was a claim about the CALLER: `FirstTimeDeliveryOffer` only renders on a
// definite `data === null`, read from a cache with a 30s staleTime that another tab's save never
// invalidates. Nothing in the save path enforced it. Open the wizard against a supplier that
// already has a Bearer token, leave the auth select alone, and the save replaced that token with
// "unauthenticated" — silently, and with a green "Delivery is saved" panel.
//
// The fix reuses `deliveryCredentialAction.ts`, the pure keep/replace/block decisions the full
// editor already runs, rather than writing a second set of rules.
//
// PAIRED ASSERTIONS. Every "the token is absent" / "nothing was overwritten" claim is preceded
// by a positive one in the same test — the humane sentence is on screen, or the save really
// happened. An absence assertion on a component that failed to render passes for the wrong
// reason, and a "credentialsJson was null" assertion passes just as well when the save was
// never called at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  testFireDelivery: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

import { DeliveryGuidedSetup } from "./DeliveryGuidedSetup";

/** A supplier that already has an HTTP config WITH a stored credential of unknown shape. */
const SAVED_HTTP_WITH_CREDENTIAL: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: false,
  configJson: JSON.stringify({ url: "https://supplier.example/orders", method: "POST" }),
  outputFormat: "csv",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function openWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeliveryGuidedSetup supplierId="sup-1" nounLower="supplier" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /set up step by step/i }));
}

/** Step 1 → HTTP, fill the URL, step 2 → step 3, then save. */
async function walkHttpToSave() {
  fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
  fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
    target: { value: "https://supplier.example/orders" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getDeliveryConfig.mockResolvedValue(null);
  upsertDeliveryConfig.mockResolvedValue({});
});

// ── A-F5b ────────────────────────────────────────────────────────────────────────────────

describe("A-F5b — a refused save says what it means", () => {
  it("a_plan_gate_becomes_a_sentence_naming_the_plan_the_server_named", async () => {
    upsertDeliveryConfig.mockRejectedValue(
      new Error("API error 403: delivery_config_requires_growth"),
    );
    openWizard();
    await walkHttpToSave();

    const gate = await screen.findByRole("status");
    // Positive first: the plan segment is derived from the code, not typed here.
    expect(gate.textContent).toContain("This delivery setup is not included in your plan");
    expect(gate.textContent).toContain("Growth");

    // Only now the defect, verbatim.
    expect(document.body.textContent).not.toContain("delivery_config_requires_growth");
    expect(document.body.textContent).not.toContain("API error 403");
  });

  it("a_malfunction_is_still_shown_and_is_not_dressed_as_an_upsell", async () => {
    // The negative control for the arm above. If everything routed to PlanGateNotice, the
    // first test would pass and the product would tell a customer with a broken server that
    // they need to buy something.
    upsertDeliveryConfig.mockRejectedValue(new Error("The supplier endpoint refused the file."));
    openWizard();
    await walkHttpToSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The supplier endpoint refused the file.");
    expect(document.body.textContent).not.toContain("not included in your plan");
  });
});

// ── A-F5c ────────────────────────────────────────────────────────────────────────────────

describe("A-F5c — the wizard never overwrites a credential it cannot read", () => {
  it("an_untouched_auth_select_keeps_the_stored_credential", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    openWizard();
    await walkHttpToSave();

    // Positive first: the save really ran. Without this, the null assertion below passes
    // just as happily when nothing was ever sent.
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0];

    // null = "leave whatever is stored alone". `'{"type":"none"}'` is the defect: it REPLACES
    // a stored Bearer token or API key with "unauthenticated".
    expect(payload.credentialsJson).toBeNull();
    expect(payload.credentialsJson).not.toBe('{"type":"none"}');
  });

  it("the_select_does_not_claim_None_for_a_credential_whose_shape_is_unknown", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    openWizard();
    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));

    const select = (await screen.findByLabelText(/How does it check who you are/i)) as HTMLSelectElement;
    // The API returns `hasCredentials` and a constant mask and nothing else, so the honest
    // answer is "we can't show which kind", never "None".
    expect(select.value).toBe("__unknown__");
    expect(within(select).getByText(/Keep the saved sign-in \(type not shown\)/)).toBeTruthy();
    expect(select.value).not.toBe("none");
  });

  it("choosing_a_type_makes_the_write_a_deliberate_replacement", async () => {
    // The negative control for the keep arm. If `keep` were returned unconditionally, an
    // operator could never rotate a credential from this wizard at all.
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    openWizard();
    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
      target: { value: "https://supplier.example/orders" },
    });
    fireEvent.change(await screen.findByLabelText(/How does it check who you are/i), {
      target: { value: "bearer" },
    });
    fireEvent.change(await screen.findByPlaceholderText(/paste the token/i), {
      target: { value: "tok_live_123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0];
    expect(payload.credentialsJson).toBe(JSON.stringify({ type: "bearer", token: "tok_live_123" }));
  });

  it("a_chosen_type_with_a_blank_required_field_is_refused_rather_than_written", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    openWizard();
    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
      target: { value: "https://supplier.example/orders" },
    });
    fireEvent.change(await screen.findByLabelText(/How does it check who you are/i), {
      target: { value: "bearer" },
    });
    // Token deliberately left blank.
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Saving replaces this supplier's whole stored credential");
    expect(upsertDeliveryConfig).not.toHaveBeenCalled();
  });

  it("a_supplier_with_an_existing_config_is_told_that_finishing_replaces_it", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    openWizard();

    const notice = await screen.findByTestId("guided-existing-config");
    expect(notice.textContent).toContain("already has delivery set up");
    expect(notice.textContent).toContain("The saved sign-in is kept unless you choose a new one.");
  });

  it("a_genuinely_new_supplier_is_not_warned_and_writes_its_own_credentials", async () => {
    // The negative control for the whole file: with nothing saved, the wizard behaves exactly
    // as it always did. Otherwise every assertion above could be satisfied by a component that
    // refuses to write anything, ever.
    getDeliveryConfig.mockResolvedValue(null);
    openWizard();
    await walkHttpToSave();

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0];
    expect(payload.credentialsJson).toBe('{"type":"none"}');
    expect(screen.queryByTestId("guided-existing-config")).toBeNull();
  });
});
