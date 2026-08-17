// "The supplier's system answered" — printed under values the supplier's system never saw.
//
// `testFire()` posts the supplier id and nothing else:
//
//     const result = await testFireDelivery(supplierId);
//
// The backend runs that test against the STORED config. The form is never sent. So every verdict
// this screen renders is a verdict about the last SAVED configuration — and the button was gated
// only on `!savedConfig || testing`, which is satisfied the moment ANY config exists. Type a new
// endpoint, click Test connection, and a green "The supplier's system answered" landed directly
// beneath an address that had not been contacted, above a Save button that had not been pressed.
//
// The file already reasons correctly this way elsewhere: the pre-test disclosure sentence is keyed
// on `savedConfig.protocol` rather than the picker, precisely so a half-edited channel switch
// cannot change what the test claims it will do. The button and the result panel never got that
// pass.
//
// DIRECTION MATTERS, AND THE OTHER ONE WAS ALREADY PINNED. `DeliveryConfigEditor.authShape.test.tsx`
// pins that a pass must not OUTLIVE an edit (markEdited clears `testResult`). Nothing pinned that a
// pass must not PRECEDE a save. These tests are that half.
//
// PAIRED ASSERTIONS. Every "the test did not run" claim is preceded in the same test by one that
// the test CAN run — an editor that renders no button at all would satisfy the refusal for the
// wrong reason.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();
const deleteDeliveryConfig = vi.fn();
const testFireDelivery = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  deleteDeliveryConfig: (...a: unknown[]) => deleteDeliveryConfig(...a),
  testFireDelivery: (...a: unknown[]) => testFireDelivery(...a),
}));

vi.mock("@/components/bridge/ConnectorRequirementsPanel", () => ({
  ConnectorRequirementsPanel: () => <div data-testid="mock-connector-panel" />,
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn(),
}));

import { DeliveryConfigEditor } from "./DeliveryConfigEditor";

const SAVED_URL = "https://supplier.example/orders";
const TYPED_URL = "https://somewhere-else.example/inbox";

const SAVED_HTTP: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: false,
  configJson: JSON.stringify({ url: SAVED_URL, method: "POST", timeoutSeconds: 30 }),
  outputFormat: "xml",
  hasCredentials: false,
  credentialsDisplay: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  cxmlCredentials: null,
};

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

const testButton = () => screen.getByRole("button", { name: /Test connection/i });
const saveButton = () => screen.getByRole("button", { name: /Save delivery/i });
const urlInput = () => screen.getByLabelText(/Endpoint URL/i);

/**
 * Anti-vacuity floor. Runs before every refusal assertion below and throws first if the fixture
 * has gone dead: the saved endpoint really is on screen, the test-fire button really is there and
 * really is usable on a freshly loaded config, and pressing it really reaches the API and really
 * paints a pass. Without this, "the test did not run" passes against an editor stuck on its
 * loading state.
 */
async function floorTestFireWorksOnAnUneditedForm() {
  expect(await screen.findByDisplayValue(SAVED_URL)).toBeInTheDocument();
  expect(testButton()).not.toBeDisabled();

  fireEvent.click(testButton());
  await waitFor(() => expect(testFireDelivery).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/The supplier's system answered/i)).toBeInTheDocument();
}

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_HTTP);
  upsertDeliveryConfig
    .mockReset()
    .mockImplementation((_id: string, body: { configJson: string }) =>
      Promise.resolve({ ...SAVED_HTTP, configJson: body.configJson }),
    );
  deleteDeliveryConfig.mockReset();
  testFireDelivery
    .mockReset()
    .mockResolvedValue({ success: true, errorMessage: null, responseCode: 200 });
});

afterEach(cleanup);

describe("DeliveryConfigEditor — a connection test may not precede the save it is a test of", () => {
  it("refuses to run the test while the endpoint on screen is not the endpoint stored", async () => {
    renderEditor();
    await floorTestFireWorksOnAnUneditedForm();

    // The defect verbatim: retype the endpoint, then ask for a verdict. The request the backend
    // would run still points at SAVED_URL.
    fireEvent.change(urlInput(), { target: { value: TYPED_URL } });

    await waitFor(() => expect(testButton()).toBeDisabled());
    expect(testButton()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(testButton());
    // Still one — the call from the floor above, none from this click.
    expect(testFireDelivery).toHaveBeenCalledTimes(1);
  });

  it("says why the test is unavailable rather than greying the button in silence", async () => {
    renderEditor();
    await screen.findByDisplayValue(SAVED_URL);
    // Control: no such notice while the form matches what is stored.
    expect(screen.queryByTestId("delivery-test-blocked-unsaved")).toBeNull();

    fireEvent.change(urlInput(), { target: { value: TYPED_URL } });

    const notice = await screen.findByTestId("delivery-test-blocked-unsaved");
    expect(notice.textContent).toMatch(/Save before testing/i);
    // The reason has to be the real one: the test runs against what is saved.
    expect(notice.textContent).toMatch(/already saved/i);
  });

  it("does not leave a pass standing over the values that replaced it", async () => {
    renderEditor();
    await floorTestFireWorksOnAnUneditedForm();

    fireEvent.change(urlInput(), { target: { value: TYPED_URL } });

    // Both halves of the rule now hold on this screen: the old verdict is gone (authShape.test
    // pins that direction) and no new one can be taken until the edit is saved (this file's).
    await waitFor(() =>
      expect(screen.queryByText(/The supplier's system answered/i)).toBeNull(),
    );
    expect(testButton()).toBeDisabled();
  });

  it("makes the test available again once the edit has actually been saved", async () => {
    renderEditor();
    await screen.findByDisplayValue(SAVED_URL);

    fireEvent.change(urlInput(), { target: { value: TYPED_URL } });
    await waitFor(() => expect(testButton()).toBeDisabled());

    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));

    // The gate is a rule about agreement between screen and store, not a one-way lock: saving
    // restores it, and the verdict that follows is about the endpoint now on screen.
    await waitFor(() => expect(testButton()).not.toBeDisabled());
    expect(screen.queryByTestId("delivery-test-blocked-unsaved")).toBeNull();

    fireEvent.click(testButton());
    await waitFor(() => expect(testFireDelivery).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/The supplier's system answered/i)).toBeInTheDocument();

    const [, body] = upsertDeliveryConfig.mock.calls[0] as [string, { configJson: string }];
    expect((JSON.parse(body.configJson) as { url: string }).url).toBe(TYPED_URL);
  });

  it("blocks the test on an edit that changes no text at all — the auto-deliver toggle", async () => {
    // The gate cannot be a URL check. Any managed setting on this screen is part of what a test
    // exercises, and a checkbox leaves no display value behind to notice.
    renderEditor();
    await floorTestFireWorksOnAnUneditedForm();

    fireEvent.click(screen.getByLabelText(/Auto-deliver/i));

    await waitFor(() => expect(testButton()).toBeDisabled());
    fireEvent.click(testButton());
    expect(testFireDelivery).toHaveBeenCalledTimes(1);
  });
});
