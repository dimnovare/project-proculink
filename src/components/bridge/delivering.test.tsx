import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// `delivering` (the in-flight dispatch) — truthfulness guard.
//
// The Worker's atomic delivery claim PERSISTS `delivering` on the order row and
// settles it to delivered/delivery_failed seconds later; a claim whose process dies
// leaves the row in `delivering` until the 2-minute reclaim window. So the inbox
// really does render this status.
//
// Every assertion here exists because the inbox previously said something FALSE about
// it: mapStatus had no `delivering` arm, so it fell through to `return "new"` and an
// order actively being dispatched rendered as "New" at stage 0 — the opposite of the
// truth, and the one status where a reader would wrongly conclude nothing had started.
//
// The negative assertions are the point: this status must read as in-flight — never
// as untouched (`new`), never as done (`sent`), never as a failure.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { mapStatus, STATUS_PRESENTATION } from "./InboxView";
import { StatusCell } from "./StatusJourney";
import { UnifiedStatusBadge, statusLabel, statusTone } from "./UnifiedStatusBadge";
import { isRedeliverable } from "./inboxSend";

afterEach(cleanup);

describe("delivering — the raw status maps to a real display slot", () => {
  it("maps to `sending`, not the `new` fall-through", () => {
    expect(mapStatus("delivering")).toBe("sending");
    // The bug. If this ever comes back, mapStatus lost its `delivering` arm.
    expect(mapStatus("delivering")).not.toBe("new");
  });

  it("does not steal the `delivering` slot, which `ready_to_deliver` already owns", () => {
    // `delivering` (the CrossingStatus) is the display bucket for the post-transform
    // `ready_to_deliver` backend status, labelled "Ready to send". An in-flight
    // dispatch needs its own slot or one of the two rows must lie.
    expect(mapStatus("ready_to_deliver")).toBe("delivering");
    expect(mapStatus("delivering")).not.toBe(mapStatus("ready_to_deliver"));
  });
});

describe("delivering — the pill tells the truth", () => {
  it("is labelled 'Sending' — the same word the canonical badge uses", () => {
    expect(STATUS_PRESENTATION.sending.label).toBe("Sending");
    // UnifiedStatusBadge STATUS_META is the canonical label vocabulary; the inbox
    // must not invent a second word for the same state.
    expect(STATUS_PRESENTATION.sending.label).toBe(statusLabel("delivering"));
  });

  it("sits at stage 4 (Deliver) — it got all the way there", () => {
    expect(STATUS_PRESENTATION.sending.stage).toBe(4);
    expect(STATUS_PRESENTATION.sending.stage).not.toBe(0);
  });

  it("is the in-flight info tone, never a failure", () => {
    expect(statusTone("delivering")).toBe("info");
    expect(statusTone("delivering")).not.toBe("danger");
  });

  // NB: StatusCell has no production call sites — the inbox renders via StatusDotPill
  // (mobile) and UnifiedStatusBadge (desktop). So this covers the StatusJourney pill
  // wiring only; it does NOT prove the inbox renders. The STATUS_PRESENTATION and
  // statusLabel assertions above are what pin the inbox's real paths.
  it("renders 'Sending' via StatusJourney's own pill", () => {
    render(<StatusCell status="sending" />);
    expect(screen.getByText("Sending")).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByText("Delivered")).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it("renders 'Sending' in the canonical badge", () => {
    render(<UnifiedStatusBadge status="delivering" />);
    expect(screen.getByText("Sending")).toBeInTheDocument();
  });
});

describe("delivering — the row offers no send action", () => {
  it("is not redeliverable — OrderStatusMachine.RedeliverableFrom excludes it", () => {
    // A bulk-send checkbox on a delivering row could only ever 400: the backend
    // accepts redelivery from delivery_failed / ready_to_deliver alone. The row is
    // already in flight; there is nothing to re-fire.
    expect(isRedeliverable("delivering")).toBe(false);
    // The two the backend DOES accept, so this assertion can't pass vacuously.
    expect(isRedeliverable("ready_to_deliver")).toBe(true);
    expect(isRedeliverable("delivery_failed")).toBe(true);
  });
});
