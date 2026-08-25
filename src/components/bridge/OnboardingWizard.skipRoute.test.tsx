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
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  updateOrgSettings: (...a: unknown[]) => api.updateOrgSettings(...a),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    createSupplier: (...a: unknown[]) => api.createSupplier(...a),
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
  await within(dialog).findByRole("button", {
    name: /skip — i'll upload my own order/i,
  });
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

describe("OnboardingWizard skip button", () => {
  it("routes to /upload when the user clicks 'Skip — I'll upload my own order'", async () => {
    const { onDismiss } = renderWizard();
    const dialog = await reachDoneStep();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: /skip — i'll upload my own order/i,
      }),
    );

    // The label promises an upload; the handler must actually go there.
    expect(push).toHaveBeenCalledWith("/upload");
    // …and the modal still closes, as before.
    expect(onDismiss).toHaveBeenCalled();
  });

  it("links the closing notice's 'setup guide' to the dashboard checklist", async () => {
    renderWizard();
    const dialog = await reachDoneStep();

    const link = within(dialog).getByRole("link", { name: /setup guide/i });
    expect(link).toHaveAttribute("href", "/bridge#onboarding-step-list");
  });
});

describe("OnboardingWizard primary flow (control)", () => {
  it("still creates the supplier on step submit and reaches the practice step", async () => {
    renderWizard();
    const dialog = await reachDoneStep();

    expect(api.createSupplier).toHaveBeenCalledWith({ name: "Nordic Fasteners" });
    // The practice-order form is intact and skip did not fire on its own.
    expect(
      within(dialog).getByRole("button", { name: /run a practice order/i }),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
