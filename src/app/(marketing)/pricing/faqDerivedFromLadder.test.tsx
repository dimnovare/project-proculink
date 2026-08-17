import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Plan } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT.
//
// Two numbers appeared TWICE on this one page — once derived, once typed:
//
//   • the per-order overage. The price cards render
//     `€{OVERAGE_PER_ORDER_EUR.toFixed(2)}/order, never blocked` (page.tsx:453-454).
//     The FAQ 300 lines above said `billed automatically at €0.50 per order`.
//   • the Pilot trial size. The Pilot card renders PLAN_BY_ID.pilot.orderLimit.
//     The FAQ said `past the 20-order trial`.
//
// Both halves agree today, which is the whole problem: a repricing moves the derived
// half and leaves the typed half quoting the old number to a buyer, on the page where
// the buyer decides. §11.5 of CLAUDE.md states the rule this breaks — "a tier name or
// an allowance typed into a banner IS the defect".
//
// So the ladder is MOVED here, and the assertions follow it. A literal-matching test
// would pass against the typed copy; only a moved constant can tell them apart.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  /** Neither is a plausible real value — nothing may match by coincidence. */
  overage: 0.77,
  pilotOrders: 43,
}));

vi.mock("@/lib/plans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans")>("@/lib/plans");
  const ladder: Record<string, Plan> = {};
  for (const [id, plan] of Object.entries(actual.PLAN_BY_ID)) {
    ladder[id] = { ...plan };
  }
  ladder.pilot.orderLimit = h.pilotOrders;
  return {
    ...actual,
    PLAN_BY_ID: ladder,
    PLANS: actual.PLANS.map((p) => ladder[p.id]),
    OVERAGE_PER_ORDER_EUR: h.overage,
  };
});

import PricingPage from "./page";
import { OVERAGE_PER_ORDER_EUR, PLAN_BY_ID } from "@/lib/plans";

function pageText(): string {
  const { container } = render(<PricingPage />);
  return container.textContent ?? "";
}

afterEach(cleanup);

describe("/pricing FAQ reads its numbers off the plan ladder", () => {
  it("quotes the ladder's overage fee, not a typed €0.50", () => {
    const body = pageText();

    expect(body).toContain(`billed automatically at €${h.overage.toFixed(2)} per order`);
    expect(body, "the hardcoded fee must be gone from the FAQ, not merely joined").not.toContain(
      "at €0.50 per order",
    );
  });

  it("quotes the ladder's Pilot allowance, not a typed 20", () => {
    const body = pageText();

    expect(body).toContain(`past the ${h.pilotOrders}-order trial`);
    expect(body).not.toContain("past the 20-order trial");
  });

  it("ANTI-VACUITY: the mock really is what the page is reading", () => {
    // Without this, a page that had simply stopped rendering the FAQ — or a mock that
    // never took — would leave both `not.toContain` assertions above trivially true.
    expect(OVERAGE_PER_ORDER_EUR).toBe(h.overage);
    expect(PLAN_BY_ID.pilot.orderLimit).toBe(h.pilotOrders);

    const body = pageText();
    // The card footnote is the copy that was ALREADY derived. It must move with the
    // ladder too — proving the moved constant reaches this page at all, so a failure
    // above is about the FAQ and not about the mock.
    expect(body).toContain(`€${h.overage.toFixed(2)}/order, never blocked`);
    // And the FAQ questions themselves are still on the page, so the answers were read.
    expect(body).toContain("What if I go over my monthly orders?");
    expect(body).toContain("What happens after the Pilot?");
  });
});
