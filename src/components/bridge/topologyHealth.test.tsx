import { render } from "@testing-library/react";
import { describe, it, test, expect } from "vitest";
import {
  deriveTopology,
  supplierHealthPct,
  FAILED_STATUSES,
  EXCEPTION_STATUSES,
} from "./BridgeDashboard";
import {
  WireTopology,
  supplierHealthText,
  supplierHealthTextColor,
  supplierPillTone,
} from "./WireTopology";
import { FAILED_BUCKET } from "./orderCountContract";
import { FAILURE_STATUSES, PARKED_STATUSES, statusFact } from "@/lib/orderStatusManifest";
import type { OrderStatus, OrderSummary, Supplier } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// Supplier health on the Wire Topology — the dashboard's signature screen.
//
// THE DEFECT THESE PIN. `FAILED_STATUSES` in BridgeDashboard.tsx was a hand-typed
// deny-list of four statuses and it omitted `rejected_by_supplier`. So a supplier
// that had REFUSED every order it was ever sent scored (total - 0) / total = 100,
// and the canvas paints health >= 90 forest green: a green "100% del" pill for a
// flow where nothing had ever been accepted. The same file's EXCEPTION_STATUSES
// DID contain `rejected_by_supplier`, so the wire between the two ports went amber
// at the same moment — one canvas contradicting itself.
//
// THE SHAPE OF THE FIX, AND THEREFORE OF THESE TESTS. Adding one string to one set
// would have made the symptom go away and left the mechanism intact: a list written
// out by hand fails OPEN, so the next failure status the backend adds is in neither
// set, the wire's ternary falls through to `: "ok"`, and the screen reports perfect
// health for a state it has never heard of. Both sets now derive from
// src/lib/orderStatusManifest.ts. These tests therefore WALK the manifest rather
// than naming statuses — a status added there must be covered without anyone
// editing this file — and every walk carries an anti-vacuity floor, because a walk
// over a set that has silently become empty passes loudest of all.
// ─────────────────────────────────────────────────────────────────────────────

let seq = 0;
function order(status: OrderStatus, over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-${seq}`,
    supplierName: "Acme Components",
    buyerName: "Heinrich Industries",
    orderDate: "2026-08-01",
    status,
    lineCount: 3,
    unresolvedCount: 0,
    createdAt: "2026-08-01T09:00:00Z",
    ...over,
  };
}

const SUPPLIERS: Supplier[] = [{ id: "sup-1", name: "Acme Components" }];

/** The forest green the canvas uses for a supplier it considers healthy (>= 90). */
const GREEN_TEXT = "#1E6D29";

function healthOf(orders: OrderSummary[]): number | null {
  const { suppliers } = deriveTopology(orders, SUPPLIERS);
  expect(suppliers, "fixture built no supplier port").toHaveLength(1);
  return suppliers[0].health;
}

// ─── The reported defect, verbatim ───────────────────────────────────────────

describe("a supplier that refused every order is not 100% healthy", () => {
  it("scores 0, not 100, when every order is rejected_by_supplier", () => {
    // The exact production shape: the supplier read the orders and refused them.
    expect(healthOf([order("rejected_by_supplier"), order("rejected_by_supplier")])).toBe(0);
  });

  it("does not paint the green pill for it", () => {
    const health = healthOf([order("rejected_by_supplier")]);
    expect(supplierHealthTextColor(health)).not.toBe(GREEN_TEXT);
    expect(supplierPillTone(health).border).not.toBe("#2E8E3A");
  });

  it("drops below the >= 90 green threshold on a single rejection in ten", () => {
    const orders = [...Array(9)].map(() => order("delivered"));
    orders.push(order("rejected_by_supplier"));
    const health = healthOf(orders);
    expect(health).toBe(90);
    // 9/10 is exactly the boundary and IS still green — the point of this case is
    // the one below it, which must not be.
    expect(supplierHealthTextColor(health)).toBe(GREEN_TEXT);

    const worse = healthOf([...orders, order("rejected_by_supplier")]);
    expect(worse).toBeLessThan(90);
    expect(supplierHealthTextColor(worse)).not.toBe(GREEN_TEXT);
  });

  it("marks the wire down, agreeing with the port pill instead of contradicting it", () => {
    // The second half of the live defect: the wire degraded to amber "risk" via
    // EXCEPTION_STATUSES while the port pill next to it read 100% green.
    const { wires } = deriveTopology([order("rejected_by_supplier")], SUPPLIERS);
    expect(wires).toHaveLength(1);
    expect(wires[0].health).toBe("down");
  });
});

// ─── The rendered pill ───────────────────────────────────────────────────────

describe("WireTopology renders the refusal, on both breakpoints", () => {
  // The responsive wrapper puts the canvas and the lane list in the DOM together
  // and hides one with a CSS class, so jsdom sees both. That is deliberate here:
  // the defect was visible on the canvas pill, and the mobile lane card was a
  // second, separately-written copy of the same thresholds.
  function renderFor(orders: OrderSummary[]) {
    const topo = deriveTopology(orders, SUPPLIERS);
    return render(
      <WireTopology buyers={topo.buyers} suppliers={topo.suppliers} wires={topo.wires} />,
    );
  }

  it("never prints 100% for a supplier that has accepted nothing", () => {
    const { container } = renderFor([order("rejected_by_supplier"), order("rejected_by_supplier")]);
    expect(container.textContent).not.toContain("100% del");
    expect(container.textContent).toContain("0% del");
  });

  it("paints no green health text anywhere on the canvas for it", () => {
    const { container } = renderFor([order("rejected_by_supplier")]);
    const greens = [...container.querySelectorAll<SVGElement>("tspan, [style]")].filter((el) => {
      const fill = el.getAttribute("fill");
      const style = el.getAttribute("style") ?? "";
      return fill === GREEN_TEXT || style.includes("rgb(30, 109, 41)") || style.includes(GREEN_TEXT);
    });
    expect(
      greens,
      "a refused-every-order supplier still has green health text on the topology",
    ).toHaveLength(0);
  });

  it("still paints green when the orders really were delivered", () => {
    // Anti-vacuity for the two assertions above: if the fixture stopped producing a
    // supplier port at all, or the pill stopped rendering health, they would pass
    // for the wrong reason.
    const { container } = renderFor([order("delivered"), order("delivered")]);
    expect(container.textContent).toContain("100% del");
    expect(container.innerHTML).toContain(GREEN_TEXT);
  });
});

// ─── The walk: every failure status the manifest knows ───────────────────────

describe("every manifest failure status drags supplier health down", () => {
  it("has statuses to walk, and still has the one that was missing", () => {
    // Anti-vacuity floor. A derived set that silently became empty would make every
    // test.each below vanish, and vitest reports zero cases as zero failures.
    expect(FAILURE_STATUSES.length).toBeGreaterThanOrEqual(5);
    expect(FAILURE_STATUSES).toContain("rejected_by_supplier");
    expect(FAILED_STATUSES.size).toBe(FAILURE_STATUSES.length);
    expect(FAILED_STATUSES.has("rejected_by_supplier")).toBe(true);
  });

  test.each([...FAILURE_STATUSES])("%s counts as failed, not as a clean delivery", (status) => {
    expect(healthOf([order(status as OrderStatus)])).toBe(0);
  });

  test.each([...FAILURE_STATUSES])("%s takes the wire down", (status) => {
    const { wires } = deriveTopology([order(status as OrderStatus)], SUPPLIERS);
    expect(wires[0].health).toBe("down");
  });

  test.each([...FAILURE_STATUSES])("%s never reads as green health text", (status) => {
    expect(supplierHealthTextColor(healthOf([order(status as OrderStatus)]))).not.toBe(GREEN_TEXT);
  });
});

describe("every manifest parked status raises the wire off 'ok'", () => {
  it("has parked statuses to walk", () => {
    expect(PARKED_STATUSES.length).toBeGreaterThanOrEqual(3);
    expect(PARKED_STATUSES).toContain("delivery_held");
  });

  test.each([...PARKED_STATUSES])("%s is an exception, not silence", (status) => {
    const { wires } = deriveTopology([order(status as OrderStatus)], SUPPLIERS);
    // Parked is NOT a failure — the output is intact and nothing broke — so health
    // stays at 100 and the wire is amber rather than red. What it must never be is
    // "ok": somebody has to act before the order moves again.
    expect(wires[0].health).toBe("risk");
    expect(wires[0].alert).toBe(1);
    expect(healthOf([order(status as OrderStatus)])).toBe(100);
  });
});

// ─── The derivation itself ───────────────────────────────────────────────────

describe("the sets are derived, not re-typed", () => {
  it("FAILED_STATUSES is exactly the manifest's failure bucket", () => {
    expect([...FAILED_STATUSES].sort()).toEqual([...FAILURE_STATUSES].sort());
  });

  it("FAILED_BUCKET — the inbox/dashboard 'Failed' count — is the same list", () => {
    // Third hand-typed copy of one backend constant, now the same value as the
    // other two. The count under the red chip and the health of the supplier port
    // cannot disagree about what failed.
    expect([...FAILED_BUCKET].sort()).toEqual([...FAILURE_STATUSES].sort());
  });

  it("EXCEPTION_STATUSES covers every non-healthy status the manifest knows", () => {
    for (const status of [...FAILURE_STATUSES, ...PARKED_STATUSES]) {
      expect(
        EXCEPTION_STATUSES.has(status),
        `${status} is bucketed as a problem by the manifest but the dashboard treats it as fine`,
      ).toBe(true);
    }
    // pending_review is the one addition: the manifest buckets it `healthy` (a review
    // is the product working, not a fault) but it still wants a person today.
    expect(EXCEPTION_STATUSES.has("pending_review")).toBe(true);
    expect(statusFact("pending_review")?.bucket).toBe("healthy");
  });

  it("picks up `unrouted`, which the hand-typed set missed", () => {
    // Not a new rule — `unrouted` has been parked-and-actionable in the manifest and
    // in problemCopy all along. It was absent from the dashboard's exception set only
    // because that list was written before the app modelled the status.
    expect(EXCEPTION_STATUSES.has("unrouted")).toBe(true);
  });

  it("does not treat a parked order as a hard failure", () => {
    // The distinction the derivation has to preserve: delivery_held and
    // delivery_unconfirmed need a human, but nothing broke, so counting them as
    // failures would drag health down for an order whose output is intact.
    for (const status of PARKED_STATUSES) {
      expect(FAILED_STATUSES.has(status), `${status} must not count as a hard failure`).toBe(false);
    }
  });

  it("leaves a healthy status alone", () => {
    expect(healthOf([order("delivered"), order("delivering")])).toBe(100);
    const { wires } = deriveTopology([order("delivered")], SUPPLIERS);
    expect(wires[0].health).toBe("ok");
  });
});

// ─── No evidence is not perfect health ───────────────────────────────────────

describe("supplierHealthPct never invents a verdict", () => {
  it("returns null for zero orders rather than 100", () => {
    // This was `total === 0 ? 100 : …`, which rendered the same confident forest
    // green as a supplier with a thousand clean deliveries.
    expect(supplierHealthPct(0, 0)).toBeNull();
  });

  it("renders as 'no orders' in neutral grey, not as a percentage", () => {
    expect(supplierHealthText(null)).toBe("no orders");
    expect(supplierHealthTextColor(null)).not.toBe(GREEN_TEXT);
    expect(supplierPillTone(null).border).not.toBe("#2E8E3A");
  });

  it("still computes a real percentage when there is evidence", () => {
    expect(supplierHealthPct(4, 1)).toBe(75);
    expect(supplierHealthPct(3, 3)).toBe(0);
    expect(supplierHealthPct(2, 0)).toBe(100);
    expect(supplierHealthText(75)).toBe("75% del");
  });
});
