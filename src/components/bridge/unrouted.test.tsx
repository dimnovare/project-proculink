import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// `unrouted` — the order that needs the operator MOST, rendered as needing nothing.
//
// An order whose supplier could not be determined is parked `unrouted` after extraction:
// its header and lines are persisted so the queue shows what arrived, but it cannot
// reach `ready` — with no supplier there is nothing to resolve item codes against.
// POST /orders/{id}/assign-supplier routes it and re-runs the parse.
//
// It is REACHABLE TODAY on the live parse path, which the first version of this fix got
// wrong. Producers on backend main:
//   OrderIngestionService.cs:857   `if (entity.SupplierId is null) newStatus = Unrouted`
//   SftpIngressService.cs:~280     CreateUnroutedStubAsync — "Phase 1b routing: a missing
//                                  (or stale/soft-deleted) default supplier no longer
//                                  blocks the poll. Files are imported UNROUTED"
//   S3IngressService.cs:344        same
// plus OpsHealthService.cs:90 counts it (PendingRouting) and OrderExceptionService.cs:36
// opens an `unrouted_order` exception for it, with PRECEDENCE over unresolved lines.
//
// Every assertion here exists because the inbox said something false about it. It fell
// through mapStatus to `return "new"` — stage 0 — so the ONE order that requires a human
// to act rendered as brand-new work needing nothing. Worse, the row contradicted itself:
// the desktop column showed "Unrouted" (UnifiedStatusBadge's humanize fallback, neutral
// tone) while the pipeline column and mobile card said "New".
//
// The copy is NOT invented. The backend states it: OrderExceptionService returns
// ("unrouted_order", "Route", "warning", "Order needs a supplier before it can be
// routed.") — warning, not neutral, and not a failure.

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { mapStatus, STATUS_PRESENTATION } from "./InboxView";
import { UnifiedStatusBadge, statusLabel, statusTone } from "./UnifiedStatusBadge";
import { isRedeliverable } from "./inboxSend";

afterEach(cleanup);

describe("unrouted — it maps to a real slot, not the `new` default", () => {
  it("maps to `unrouted`, not the `new` fall-through", () => {
    expect(mapStatus("unrouted")).toBe("unrouted");
    // The bug: stage 0 claims nothing has run. Extraction HAS run — that is why the
    // order has lines to look at and a supplier to assign.
    expect(mapStatus("unrouted")).not.toBe("new");
  });

  it("is not folded into the red Failed pill — it is a backlog, not a failure", () => {
    // OrderStatusConstants: "NOT a failure — a user-action backlog, resolvable by
    // assigning a supplier, which re-enters the parse flow."
    expect(mapStatus("unrouted")).not.toBe("failed");
  });
});

describe("unrouted — the pill says what the operator must do", () => {
  it("is labelled 'Needs supplier'", () => {
    expect(STATUS_PRESENTATION.unrouted.label).toBe("Needs supplier");
  });

  it("uses the same word as the canonical badge, so the two cannot drift", () => {
    expect(STATUS_PRESENTATION.unrouted.label).toBe(statusLabel("unrouted"));
    // The old humanize() fallback — proof STATUS_META gained a real entry.
    expect(statusLabel("unrouted")).not.toBe("Unrouted");
  });

  it("is amber (needs a human), never neutral and never the failure tone", () => {
    // Backend severity for the unrouted_order exception is "warning".
    expect(statusTone("unrouted")).toBe("warning");
    expect(statusTone("unrouted")).not.toBe("danger");
    // Neutral is what the unknown-status fallback gave it — the desktop half of the
    // contradiction, where the badge disagreed with the pipeline column.
    expect(statusTone("unrouted")).not.toBe("neutral");
  });

  it("sits at stage 1 — past Parse, parked before Normalize", () => {
    // Extraction finished; normalisation cannot start without a supplier to resolve
    // item codes against. Stage 0 would deny the parse ran at all.
    expect(STATUS_PRESENTATION.unrouted.stage).toBe(1);
    expect(STATUS_PRESENTATION.unrouted.stage).not.toBe(0);
  });

  it("renders the label on the desktop badge path", () => {
    render(<UnifiedStatusBadge status="unrouted" />);
    expect(screen.getByText("Needs supplier")).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});

describe("unrouted — the row offers no send action", () => {
  it("is not redeliverable — RedeliverableFrom is {delivery_failed, ready_to_deliver}", () => {
    // It has no supplier and no artifact; the action it needs is assign-supplier.
    expect(isRedeliverable("unrouted")).toBe(false);
    // The two the backend DOES accept, so this cannot pass vacuously.
    expect(isRedeliverable("ready_to_deliver")).toBe(true);
    expect(isRedeliverable("delivery_failed")).toBe(true);
  });
});
