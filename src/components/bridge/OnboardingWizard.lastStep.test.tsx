import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// The wizard's final step renders a button labelled
// "Skip — I'll upload my own order", wired to `onSkip={onDismiss}`. The label
// promises a route the handler does not take: clicking it only closed the modal
// and left the user standing on /bridge, nowhere near an upload control. And
// the closing notice — "Your setup guide is on the dashboard whenever you want
// it" — was inert prose with no link to the guide it named.
//
// The fix: skip routes to /upload (in addition to dismissing), and "setup
// guide" is a real link to the dashboard checklist anchor
// (/bridge#onboarding-step-list — the id OnboardingChecklist puts on its CARD.
// It used to sit on the step <ol>, which the compact layout does not render
// until the disclosure is open, so the link resolved to nothing; see
// OnboardingChecklist.setupGuideAnchor.test.tsx).
// ─────────────────────────────────────────────────────────────────────────────

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/bridge",
  useRouter: () => ({ push }),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "buyer@example.com" } },
  }),
}));

const api = {
  updateOrgSettings: vi.fn(),
  createSupplier: vi.fn(),
  uploadPurchaseOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  updateOrgSettings: (...a: unknown[]) => api.updateOrgSettings(...a),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    createSupplier: (...a: unknown[]) => api.createSupplier(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/sentry-context", () => ({ captureException: vi.fn() }));
vi.mock("@/hooks/useDialogA11y", () => ({ useDialogA11y: vi.fn() }));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn(),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));

const runSample = vi.fn();
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample, isPending: false, error: null }),
}));

import { OnboardingWizard } from "./OnboardingWizard";

const SUPPLIER: Supplier = {
  id: "sup-001",
  name: "Nordic Fasteners",
} as Supplier;

function renderWizard(onDismiss = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard onDismiss={onDismiss} />
    </QueryClientProvider>,
  );
  return { onDismiss };
}

/** Drive the wizard through steps 0 and 1 onto the closing "done" step. */
async function reachDoneStep() {
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("radio", {
      name: /we send purchase orders to our suppliers/i,
    }),
  );
  const nameInput = await within(dialog).findByLabelText(/name/i);
  fireEvent.change(nameInput, { target: { value: "Nordic Fasteners" } });
  fireEvent.submit(nameInput.closest("form")!);
  await within(dialog).findByLabelText(/upload one of your orders/i);
  return dialog;
}

beforeEach(() => {
  api.updateOrgSettings.mockResolvedValue(undefined);
  api.createSupplier.mockResolvedValue(SUPPLIER);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingWizard upload option", () => {
  it("uploads the chosen file for the new supplier and routes to the order", async () => {
    api.uploadPurchaseOrder.mockResolvedValue({ order: { id: "ord-9" } });
    const { onDismiss } = renderWizard();
    const dialog = await reachDoneStep();
    const file = new File(["a,b"], "po.csv", { type: "text/csv" });

    fireEvent.change(within(dialog).getByLabelText(/upload one of your orders/i), {
      target: { files: [file] },
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/inbox/ord-9"));
    expect(api.uploadPurchaseOrder).toHaveBeenCalledWith(file, "sup-001");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("links the closing notice's 'setup guide' to the dashboard checklist", async () => {
    renderWizard();
    const dialog = await reachDoneStep();

    const link = within(dialog).getByRole("link", { name: /setup guide/i });
    expect(link).toHaveAttribute("href", "/bridge#onboarding-step-list");
  });
});

describe("OnboardingWizard last step", () => {
  it("first-use path ends at download, not delivery", async () => {
    renderWizard();
    const dialog = await reachDoneStep();
    expect(within(dialog).queryByRole("textbox", { name: /send the finished file/i })).toBeNull();
    expect(within(dialog).getByLabelText(/upload one of your orders/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /try a sample order/i }));
    expect(runSample).toHaveBeenCalledWith();
  });
});

describe("OnboardingWizard primary flow (control)", () => {
  it("still creates the supplier on step submit and reaches the practice step", async () => {
    renderWizard();
    const dialog = await reachDoneStep();

    expect(api.createSupplier).toHaveBeenCalledWith({ name: "Nordic Fasteners" });
    // The practice-order form is intact and skip did not fire on its own.
    expect(
      within(dialog).getByRole("button", { name: /try a sample order/i }),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
