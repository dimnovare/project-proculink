import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { OnboardingStatus } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// The checklist never offered delivery until delivery was next.
//
// `StepList` rendered a link for exactly two kinds of row: the ACTIVE step (via
// the primary CTA in the intro column) and the INTERMEDIATE delivery step. Every
// other not-done row — including a step that is genuinely UNLOCKED and doable
// right now — fell through to the same inert rendering as a LOCKED one.
//
// `buildChecklistSteps` unlocks delivery as soon as the first supplier exists
// (`locked: !supplierDone`), but `activeStep` is the FIRST not-done, not-locked
// step, so delivery is never the active step until catalog + upload + resolve are
// all done. A user who added a supplier and uploaded an order — and then left the
// dashboard — was never shown a route to delivery setup at all. That is precisely
// the step whose absence makes the first real send fail.
//
// The fix makes "unlocked but not active" a real state with its own subordinate
// affordance. The control that proves it is not just "link everything": a
// genuinely LOCKED step still exposes NO link.
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
import { buildChecklistSteps } from "./buildChecklistSteps";

/**
 * Supplier added; delivery therefore UNLOCKED. Catalog, upload, resolve and send
 * are all still outstanding, so the active step is CATALOG and the SEND step is
 * genuinely locked (no upload, no resolved mapping, no delivery config).
 */
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

beforeEach(() => {
  statusValue = SUPPLIER_ONLY;
  window.localStorage.clear();
  window.sessionStorage.clear();
  // One step done → compact density, where the full list sits behind the
  // disclosure. Pre-open it so the step list is the thing under test.
  window.localStorage.setItem("plk-checklist-expanded", "1");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** The row `<li>` whose visible label matches, scoped so links can't leak in. */
function stepRow(label: string): HTMLElement {
  const list = screen.getByRole("list", { name: "First delivery setup steps" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(label));
  if (!row) throw new Error(`No checklist row for ${label}. Rows: ${list.textContent}`);
  return row;
}

describe("buildChecklistSteps — the state the UI has to render", () => {
  it("leaves delivery unlocked and not active while earlier steps are outstanding", () => {
    const model = buildChecklistSteps(SUPPLIER_ONLY, "supplier");
    const delivery = model.steps.find((s) => s.id === "delivery")!;
    const send = model.steps.find((s) => s.id === "send")!;

    expect(delivery.locked).toBe(false);
    expect(delivery.done).toBe(false);
    expect(delivery.intermediate).toBe(false);
    // Not the active step — that is the whole gap.
    expect(model.activeStep?.id).toBe("catalog");
    // The control: send really is locked here.
    expect(send.locked).toBe(true);
  });
});

describe("OnboardingChecklist — unlocked steps are reachable", () => {
  it("gives the unlocked delivery step a working link even though it is not next", () => {
    render(<OnboardingChecklist />);

    const row = stepRow("Set up delivery and send a test");
    const link = within(row).getByRole("link");
    expect(link).toHaveAttribute("href", "/library/suppliers/sup-1?tab=delivery");
  });

  it("also offers the other unlocked-but-not-active step (upload)", () => {
    render(<OnboardingChecklist />);

    const row = stepRow("Upload an order");
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/upload");
  });

  it("keeps the active step visually primary — its CTA is the one green button", () => {
    render(<OnboardingChecklist />);

    // The primary CTA for the active step (catalog) lives outside the step list.
    const primary = screen.getByRole("link", { name: /Add item codes/ });
    const list = screen.getByRole("list", { name: "First delivery setup steps" });
    expect(list.contains(primary)).toBe(false);

    // And the active row itself does not sprout a competing secondary link.
    const activeRow = stepRow("Add the supplier's item codes");
    expect(within(activeRow).queryByRole("link")).toBeNull();
  });

  it("CONTROL: a genuinely locked step still exposes no link", () => {
    render(<OnboardingChecklist />);

    const locked = stepRow("Send your first order");
    expect(within(locked).queryByRole("link")).toBeNull();

    const lockedResolve = stepRow("Match item codes on an order");
    expect(within(lockedResolve).queryByRole("link")).toBeNull();
  });
});
