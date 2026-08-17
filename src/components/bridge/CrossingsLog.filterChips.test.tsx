import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";
import { AUDIT_ACTION_FACTS } from "@/lib/auditActionManifest";

// ─────────────────────────────────────────────────────────────────────────────
// Two defects on the filter bar of a page titled "Deliveries".
//
// 1. THE CHIP THAT COULD NEVER MATCH. `FILTERS` offered `{ key: "delivered",
//    label: "Delivered" }`, and the manifest states plainly, on the `delivered`
//    entry, that "an automatic successful send currently leaves no audit row of its
//    own" — `DeliveryConfirmedManually` is the ONLY reachable action in that kind.
//    So a workspace that had delivered hundreds of POs clicked Delivered and read
//    "Nothing in this workspace's log matches." The chip promised the page's whole
//    subject and delivered the one hand-typed exception to it.
//
//    The fix renames the chip to what it really filters, and DERIVES the choice from
//    the manifest so it self-corrects the day an automatic-delivery writer appears.
//    (The alternative — keep "Delivered" and explain the recording gap in the empty
//    state — only reaches the operator who has already been misled, and leaves the
//    false promise sitting in the filter bar for everyone who never clicks it.)
//
// 2. NO aria-pressed. Which chip was active was carried by a CSS class and a tinted
//    background, nothing else. A screen-reader user could press every chip in the row
//    and never be told which one they had landed on, while the list below silently
//    changed under them.
//
// jsdom applies no Tailwind, so both breakpoint trees mount — every chip assertion
// is scoped to the filter group, and the control at the end proves it bites.
// ─────────────────────────────────────────────────────────────────────────────

const getAuditLog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CrossingsLog, deliveredFilterLabel } from "./CrossingsLog";

const BASE: Omit<AuditLogEntry, "id" | "action" | "message"> = {
  ts: "2026-08-06T09:15:00.000Z",
  orderId: "ord-aaa",
  poNumber: "PO-4711",
  buyerName: "Heinrich Industries",
  supplierName: "Nordmark",
  format: "PDF",
  actorType: "user",
  actorName: "Maria",
  actorInitials: "MA",
  payload: null,
};

function renderLog(events: AuditLogEntry[] = []) {
  getAuditLog.mockResolvedValue({ events, total: events.length, page: 1, pageSize: 50 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

/** The chip row, and nothing else on the page. */
const chips = () => within(screen.getByRole("group", { name: "Filter events by kind" }));

beforeEach(() => getAuditLog.mockReset());
afterEach(cleanup);

describe("deliveredFilterLabel — derived from what the log can actually contain", () => {
  it("one reachable delivered action means the chip is about that one action", () => {
    expect(deliveredFilterLabel(1)).toBe("Confirmed by hand");
  });

  it("a second reachable delivered action restores the general claim", () => {
    // The self-correcting half. When the backend starts recording automatic sends,
    // "Delivered" becomes true again with no edit to this component.
    expect(deliveredFilterLabel(2)).toBe("Delivered");
  });

  it("no reachable delivered action means no chip at all, not a dead one", () => {
    expect(deliveredFilterLabel(0)).toBeNull();
  });

  it("CONTROL — the manifest really does have exactly one reachable delivered action", () => {
    // Anti-vacuity for the whole rename: if this ever stops being 1, the rendered
    // chip below changes with it and the assertion about the rendered label must be
    // re-derived rather than left asserting a stale string.
    const reachable = AUDIT_ACTION_FACTS.filter((f) => f.kind === "delivered" && f.reachable);
    expect(reachable.map((f) => f.action)).toEqual(["DeliveryConfirmedManually"]);
  });
});

describe("the delivery log's filter chips", () => {
  it("does not offer a 'Delivered' chip that nothing can match", async () => {
    renderLog();
    expect(await screen.findByRole("group", { name: "Filter events by kind" })).toBeTruthy();

    expect(chips().queryByRole("button", { name: "Delivered" })).toBeNull();
    expect(chips().getByRole("button", { name: "Confirmed by hand" })).toBeTruthy();
  });

  it("the renamed chip really does select the delivered kind", async () => {
    // The rename must not have quietly detached the chip from its filter — a chip
    // with honest words and no effect is a different defect, not a fix.
    const events: AuditLogEntry[] = [
      { ...BASE, id: "e1", action: "DeliveryConfirmedManually", message: "Marked delivered · PO-4711" },
      { ...BASE, id: "e2", action: "Parsed", message: "Parsed · PO-9000", poNumber: "PO-9000" },
    ];
    renderLog(events);

    expect(await screen.findByText("PO-4711")).toBeTruthy();
    expect(screen.getByText("PO-9000")).toBeTruthy();

    fireEvent.click(chips().getByRole("button", { name: "Confirmed by hand" }));

    expect(screen.getByText("PO-4711")).toBeTruthy();
    expect(screen.queryByText("PO-9000")).toBeNull();
  });

  it("announces which chip is active with aria-pressed", async () => {
    renderLog();
    expect(await screen.findByRole("group", { name: "Filter events by kind" })).toBeTruthy();

    const all = chips().getByRole("button", { name: "All events" });
    const failed = chips().getByRole("button", { name: "Failed" });

    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(failed.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(failed);

    expect(failed.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
  });

  it("CONTROL — every chip carries the attribute, and exactly one is pressed", async () => {
    // Guards the shape rather than two sampled chips: a partial rollout that set
    // aria-pressed on the active chip only would pass the test above and still leave
    // every other chip unannounced.
    renderLog();
    expect(await screen.findByRole("group", { name: "Filter events by kind" })).toBeTruthy();

    const buttons = chips().getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") !== null)).toBe(true);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    // And the scope is real: the Export button is a button on this page, outside the
    // group, and it must NOT be in this list.
    expect(screen.getByRole("button", { name: /Export log/ })).toBeTruthy();
    expect(chips().queryByRole("button", { name: /Export log/ })).toBeNull();
  });
});

describe("the desktop column band claims no table it cannot show", () => {
  it("renders no table role, because the rows are not inside it", async () => {
    // It shipped as role="table" > role="row" > role="columnheader" with
    // aria-sort="descending", while every row rendered BELOW it in a separate Card.
    // Assistive tech was handed a fully described table with zero rows.
    const events: AuditLogEntry[] = [
      { ...BASE, id: "e1", action: "Parsed", message: "Parsed · PO-4711" },
    ];
    renderLog(events);
    expect(await screen.findByText("PO-4711")).toBeTruthy();

    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelectorAll('[role="columnheader"]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="row"]')).toHaveLength(0);
    expect(document.querySelectorAll("[aria-sort]")).toHaveLength(0);
  });

  it("CONTROL — the band is still on screen, just silent", async () => {
    // The band must not have been deleted to satisfy the assertions above: it is
    // real, visible column furniture. It is hidden from the accessibility tree only.
    const events: AuditLogEntry[] = [
      { ...BASE, id: "e1", action: "Parsed", message: "Parsed · PO-4711" },
    ];
    renderLog(events);
    expect(await screen.findByText("PO-4711")).toBeTruthy();

    const band = screen.getByTestId("delivery-log-col-header");
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(within(band).getByText("Route")).toBeTruthy();
    expect(within(band).getByText("Actor")).toBeTruthy();
  });
});
