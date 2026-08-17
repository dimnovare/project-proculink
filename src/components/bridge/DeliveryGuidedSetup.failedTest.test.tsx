// A failed test on the explicitly non-technical path was a dead end.
//
// Step 4 of the guided wizard rendered its verdict as:
//
//     {testResult.success ? "The endpoint answered" : "Test failed"}
//
// The wizard imports `deliveryTestDisclosure` — the module that says what a test DOES per channel —
// but not `describeDeliveryTestOutcome`, the module written precisely because a rejected sign-in,
// an unresolvable host and a missing path are three different jobs. So the one screen built for
// people who cannot read an HTTP status was the one screen that showed them nothing but "Test
// failed".
//
// Two things compounded it:
//   * the footnote "your setup is already saved… click Done" rendered UNDER the failure, which
//     reads as an ending, and
//   * there was no Back button on step 4 at all (`step > 1 && step < 4`), so the address and the
//     sign-in that had just failed were unreachable. Done was the only control on the screen.
//
// PAIRED ASSERTIONS. Every "the wizard no longer says X" is paired with the specific replacement
// it must say instead, so the tests cannot be satisfied by rendering less.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryTestResult } from "@/lib/api/types";
import { describeDeliveryTestOutcome } from "./deliveryTestOutcome";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();
const testFireDelivery = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  testFireDelivery: (...a: unknown[]) => testFireDelivery(...a),
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

import { DeliveryGuidedSetup } from "./DeliveryGuidedSetup";

/** The three failures the old copy collapsed into one sentence. */
const REFUSED: DeliveryTestResult = { success: false, errorMessage: "invalid api key", responseCode: 401 };
const UNREACHABLE: DeliveryTestResult = { success: false, errorMessage: "No such host is known", responseCode: null };
const WRONG_PATH: DeliveryTestResult = { success: false, errorMessage: "Not Found", responseCode: 404 };

function openWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeliveryGuidedSetup supplierId="sup-1" nounLower="supplier" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /set up step by step/i }));
}

/** Step 1 → HTTP → URL → step 3 → save → step 4 → send the test. */
async function walkToFailedTest(result: DeliveryTestResult) {
  testFireDelivery.mockResolvedValue(result);
  openWizard();
  fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
  fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
    target: { value: "https://supplier.example/orders" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));
  await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole("button", { name: /Send a test/i }));
  await waitFor(() => expect(testFireDelivery).toHaveBeenCalledTimes(1));
}

/**
 * Anti-vacuity floor. The three fixtures really are three DIFFERENT outcomes according to the
 * shared module, and none of them is a pass — without this, a component that printed one identical
 * failure sentence for all three could still satisfy a per-fixture assertion that happened to be
 * written loosely.
 */
function floorTheThreeFailuresAreDistinct() {
  const titles = [REFUSED, UNREACHABLE, WRONG_PATH].map(
    (r) => describeDeliveryTestOutcome(r).title,
  );
  expect(new Set(titles).size).toBe(3);
  for (const r of [REFUSED, UNREACHABLE, WRONG_PATH]) {
    const outcome = describeDeliveryTestOutcome(r);
    expect(outcome.tone).not.toBe("pass");
    expect(outcome.guidance).not.toBe("");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getDeliveryConfig.mockResolvedValue(null);
  upsertDeliveryConfig.mockResolvedValue({});
});

afterEach(cleanup);

describe("DeliveryGuidedSetup — a failed test says which failure it was", () => {
  it("names a refused sign-in and points at the credential, not at 'Test failed'", async () => {
    floorTheThreeFailuresAreDistinct();
    await walkToFailedTest(REFUSED);

    expect(await screen.findByText(describeDeliveryTestOutcome(REFUSED).title)).toBeInTheDocument();
    expect(screen.getByText(describeDeliveryTestOutcome(REFUSED).guidance)).toBeInTheDocument();
    // The supplier's own words, kept.
    expect(screen.getByText(/invalid api key/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Test failed$/)).toBeNull();
  });

  it("distinguishes an address nothing answered at from a sign-in that was refused", async () => {
    floorTheThreeFailuresAreDistinct();
    await walkToFailedTest(UNREACHABLE);

    const outcome = describeDeliveryTestOutcome(UNREACHABLE);
    expect(await screen.findByText(outcome.title)).toBeInTheDocument();
    // The distinguishing claim: this is NOT a credential problem, and the wizard says so.
    expect(screen.getByText(outcome.guidance).textContent).toMatch(/not a sign-in problem/i);
    expect(screen.queryByText(describeDeliveryTestOutcome(REFUSED).title)).toBeNull();
  });

  it("distinguishes a wrong path from both of the above", async () => {
    floorTheThreeFailuresAreDistinct();
    await walkToFailedTest(WRONG_PATH);

    expect(await screen.findByText(describeDeliveryTestOutcome(WRONG_PATH).title)).toBeInTheDocument();
    expect(screen.queryByText(describeDeliveryTestOutcome(UNREACHABLE).title)).toBeNull();
    expect(screen.queryByText(describeDeliveryTestOutcome(REFUSED).title)).toBeNull();
  });
});

describe("DeliveryGuidedSetup — a failed test is not an ending", () => {
  it("does not tell the user they are finished under a failure", async () => {
    await walkToFailedTest(REFUSED);

    // The save DID happen and the copy still says so — what changes is what to do next.
    expect(screen.getByText(/your settings are saved/i)).toBeInTheDocument();
    expect(screen.getByText(/did not get through/i)).toBeInTheDocument();
    expect(screen.queryByText(/You can skip the test and run it later/i)).toBeNull();
  });

  it("keeps the finish-and-move-on footnote when the test passed", async () => {
    // Control for the assertion above: the footnote is not simply deleted.
    await walkToFailedTest({ success: true, errorMessage: null, responseCode: 200 });

    expect(await screen.findByText(/You can skip the test and run it later/i)).toBeInTheDocument();
    expect(screen.queryByText(/did not get through/i)).toBeNull();
  });

  it("offers a way back to the details that failed", async () => {
    await walkToFailedTest(REFUSED);

    // Step 4 had no Back button at all. This is the whole difference between a wizard and a
    // cul-de-sac for the user this path exists for.
    const back = screen.getByRole("button", { name: /Back/i });
    fireEvent.click(back);

    // Back lands on step 3 (format), and from there the destination is one more step back.
    expect(await screen.findByText(/Step 3 of 4/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    expect(await screen.findByText(/Step 2 of 4/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://supplier.example/orders")).toBeInTheDocument();
  });

  it("does not carry the old verdict forward when the user goes back to change something", async () => {
    await walkToFailedTest(REFUSED);
    const failedTitle = describeDeliveryTestOutcome(REFUSED).title;
    expect(screen.getByText(failedTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    await screen.findByText(/Step 3 of 4/i);
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(2));

    // A verdict about the previous save must not be sitting on step 4 after a new one.
    await screen.findByText(/Step 4 of 4/i);
    expect(screen.queryByText(failedTitle)).toBeNull();
  });
});
