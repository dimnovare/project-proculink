import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { OnboardingStatus } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// "setup guide" pointed at an element that was not in the document.
//
// OnboardingWizard's closing line links to /bridge#onboarding-step-list. That id
// lived on the step <ol>, which the COMPACT density renders only once the
// disclosure is open — and the disclosure is closed by default. So the fragment
// resolved to nothing: the page did not scroll, nothing expanded, and the link
// read as a dead control.
//
// The fix has two halves, and both are pinned here:
//   • the id now sits on the checklist CARD, which every density renders, so the
//     fragment always resolves to something visible;
//   • the fragment is read on render and on hashchange, so arriving with it opens
//     the step list and scrolls the card into view.
//
// The control that keeps this from degenerating into "always expanded": with no
// fragment the compact card still renders the disclosure CLOSED, and a
// deliberate "Hide steps" while the fragment is still in the URL stays hidden.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: () => "/bridge",
}));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ labels: { counterpartyNoun: "Supplier" } }),
}));

vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));

let statusValue: OnboardingStatus | undefined;
vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({ data: statusValue, isError: false }),
  invalidateOnboardingStatus: vi.fn(),
}));

import { OnboardingChecklist } from "./OnboardingChecklist";

/** One step done → compact density, where the step list sits behind a disclosure. */
const SUPPLIER_ONLY: OnboardingStatus = {
  hasSupplier: true,
  hasUpload: false,
  hasResolvedMapping: false,
  hasDelivery: false,
  hasCatalog: false,
  hasItemMappings: false,
  hasDeliveryConfig: false,
  hasTestFired: false,
  firstSupplierId: "sup-1",
} as OnboardingStatus;

/** The fragment OnboardingWizard's "setup guide" link navigates to. */
const ANCHOR_ID = "onboarding-step-list";

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  statusValue = SUPPLIER_ONLY;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
  scrollIntoView = vi.fn();
  // jsdom does not implement scrollIntoView at all.
  Element.prototype.scrollIntoView = scrollIntoView as unknown as () => void;
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** The step list, or null when the disclosure is closed. */
function stepList(): HTMLElement | null {
  return screen.queryByRole("list", { name: "First delivery setup steps" });
}

describe("the wizard's setup-guide fragment", () => {
  it("resolves to a rendered element even with the step list collapsed", () => {
    render(<OnboardingChecklist />);

    // The disclosure is closed — this is the state the broken link landed in.
    expect(stepList()).toBeNull();
    // ...and the fragment still has somewhere to go.
    expect(document.getElementById(ANCHOR_ID)).not.toBeNull();
  });

  it("opens the step list and scrolls to the card when the fragment names it", () => {
    window.location.hash = `#${ANCHOR_ID}`;

    render(<OnboardingChecklist />);

    expect(stepList()).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("opens the step list when the fragment arrives after mount", () => {
    render(<OnboardingChecklist />);
    expect(stepList()).toBeNull();

    act(() => {
      window.location.hash = `#${ANCHOR_ID}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(stepList()).not.toBeNull();
  });

  it("leaves the step list closed when the fragment names something else", () => {
    window.location.hash = "#needs-you";

    render(<OnboardingChecklist />);

    expect(stepList()).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the step list hidden after the user closes it, fragment still in the URL", () => {
    window.location.hash = `#${ANCHOR_ID}`;
    render(<OnboardingChecklist />);
    expect(stepList()).not.toBeNull();

    act(() => {
      screen.getByRole("button", { name: "Hide steps" }).click();
    });

    expect(stepList()).toBeNull();
  });

  it("wires the disclosure button's aria-controls to the list it actually toggles", () => {
    window.location.hash = `#${ANCHOR_ID}`;
    render(<OnboardingChecklist />);

    const controls = screen.getByRole("button", { name: "Hide steps" }).getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toBe(stepList());
  });
});
