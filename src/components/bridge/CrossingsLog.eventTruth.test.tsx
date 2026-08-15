import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";
import {
  AUDIT_ACTION_FACTS,
  FAILURE_AUDIT_ACTIONS,
  REACHABLE_AUDIT_ACTIONS,
  auditActionFact,
  auditEventKind,
  isSuccessKind,
} from "@/lib/auditActionManifest";
import { STATUS_LABELS } from "./UnifiedStatusBadge";

// ─────────────────────────────────────────────────────────────────────────────
// The delivery log labelled every failure a successful delivery.
//
// THE DEFECT, VERBATIM. `mapApiEntry` resolved a row's event with:
//
//     const eventKey = e.action.toLowerCase();
//     const event = ACTION_TO_EVENT[eventKey] ?? "crossed";   // ← EVENT_TO_CANONICAL.crossed === "delivered"
//
// against an ACTION_TO_EVENT whose fourteen keys were all snake_case. The backend
// emits the audit action verbatim (AuditController.cs:186) and its vocabulary is
// PascalCase, so of the thirty actions a production writer can emit, exactly three
// matched — Created, Parsed, Resolved. Every DeliveryFailed, TransformFailed,
// DeliveryDeadLettered, AcceptanceBlocked, DeliverySlaBreached and StuckTimeout took
// the fallback and rendered green, labelled "Delivered", with the raw engine
// identifier as its message. The "Failed" chip matched nothing that could exist, and
// "Open to resend" — gated on the failed event — could never render.
//
// These tests assert the RENDERING, not the presence of a map entry: a map can be
// correct while the component ignores it, which is the shape of the original bug
// (there WAS a `delivery_failed: "failed"` entry — nothing ever reached it).
// ─────────────────────────────────────────────────────────────────────────────

const getAuditLog = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

import { CrossingsLog } from "./CrossingsLog";

const BASE: Omit<AuditLogEntry, "id" | "action" | "message"> = {
  ts: "2026-08-06T09:15:00.000Z",
  orderId: "ord-aaa",
  poNumber: "PO-4711",
  buyerName: "Heinrich Industries",
  supplierName: "Nordmark",
  format: "PDF",
  actorType: "system",
  actorName: "System",
  actorInitials: "SY",
  payload: null,
};

/**
 * One event, with the message shape the backend really produces for an action it
 * has no sentence for: `BuildMessage`'s `_ => $"{action}{po}"` fallback.
 */
function evt(action: string, id = "e1"): AuditLogEntry {
  return { ...BASE, id, action, message: `${action} · PO-4711` };
}

function apiPage(events: AuditLogEntry[], total = events.length, page = 1, pageSize = 50) {
  return { events, total, page, pageSize };
}

/**
 * Every event badge currently rendered, with its kind readable off the DOM.
 *
 * `data-event-kind` is what makes "renders as a failure" assertable at all: the
 * only other difference between a `delivered` row and an `unknown` one is a CSS
 * custom property, which jsdom does not resolve.
 */
function badges(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-event-kind]"));
}

function renderLog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getAuditLog.mockReset();
  searchParams = new URLSearchParams();
});

afterEach(cleanup);

// ── The defect, one action at a time ─────────────────────────────────────────

/**
 * The four the brief names, plus the two sweeper failures — every one of them
 * PascalCase, so every one of them used to miss the map and render as a delivery.
 */
const NAMED_FAILURES = [
  "DeliveryFailed",
  "TransformFailed",
  "DeliveryDeadLettered",
  "AcceptanceBlocked",
  "ParseFailed",
  "DeliverySlaBreached",
  "StuckTimeout",
  "StuckDeliveryDeadLettered",
  "MarkedRejected",
] as const;

describe("CrossingsLog — a backend failure action renders as a failure", () => {
  it.each(NAMED_FAILURES)("%s does not render as a delivery", async (action) => {
    getAuditLog.mockResolvedValue(apiPage([evt(action)]));

    renderLog();

    // The row exists…
    expect(await screen.findByText("PO-4711")).toBeInTheDocument();

    // …and it is NOT green-labelled "Delivered". This is the assertion the shipped
    // screen failed: every one of these actions produced the word "Delivered".
    // Queried by TITLE, which only the row's event badge carries — plain text would
    // also match the "Delivered" filter chip, which is always on screen.
    expect(screen.queryByTitle("Delivered")).toBeNull();

    // …and the badge the operator actually looks at is classified `failed`. Asserted
    // on the DOM, not just on the manifest: a correct table that the component
    // ignores is precisely the shape of the original bug.
    for (const badge of badges()) expect(badge.dataset.eventKind).toBe("failed");
    expect(badges().length).toBeGreaterThan(0);

    expect(auditEventKind(action)).toBe("failed");
    expect(isSuccessKind(auditEventKind(action))).toBe(false);
  });

  it("labels the row with the human event name, not the raw engine identifier", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryDeadLettered")]));

    renderLog();

    // The backend's message for this action is literally "DeliveryDeadLettered · PO-4711"
    // (BuildMessage has no arm for it). An operator must not be shown that.
    expect(await screen.findByText("Out of retries")).toBeInTheDocument();
    expect(screen.queryByText(/DeliveryDeadLettered/)).toBeNull();
  });

  it("offers 'Open to resend' on a failure row — the control could never render before", async () => {
    // The button was gated on `c.event === "failed"`, and `event` was only ever set
    // from the map that no real failure action reached. On the live path it was
    // unreachable for exactly the rows that needed it.
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryFailed")]));

    renderLog();

    // Expand the row (the actions live in the expanded panel).
    const row = await screen.findByText("PO-4711");
    ((row.closest('[role="button"]') ?? row.parentElement!) as HTMLElement).click();

    expect(await screen.findByRole("button", { name: /Open to resend/i })).toBeInTheDocument();
  });

  it("does not offer 'Open to resend' on a successful row", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryConfirmedManually")]));

    renderLog();

    const row = await screen.findByText("PO-4711");
    ((row.closest('[role="button"]') ?? row.parentElement!) as HTMLElement).click();

    expect(screen.queryByRole("button", { name: /Open to resend/i })).toBeNull();
  });
});

// ── The chip that could never match ──────────────────────────────────────────

describe("CrossingsLog — the 'Failed' chip matches real failures", () => {
  it("keeps failure rows and drops the others", async () => {
    getAuditLog.mockResolvedValue(
      apiPage([
        { ...evt("DeliveryDeadLettered", "f1"), poNumber: "PO-FAIL-1" },
        { ...evt("TransformFailed", "f2"), poNumber: "PO-FAIL-2" },
        { ...evt("AcceptanceBlocked", "f3"), poNumber: "PO-FAIL-3" },
        { ...evt("DeliveryConfirmedManually", "ok1"), poNumber: "PO-OK-1" },
        { ...evt("Parsed", "ok2"), poNumber: "PO-OK-2" },
      ]),
    );

    renderLog();

    await screen.findByText("PO-FAIL-1");
    screen.getByRole("button", { name: "Failed" }).click();

    // All three failures survive the chip. Before this change the chip returned
    // NOTHING, ever — the only action that mapped to `failed` was the snake_case
    // `delivery_failed`, which no writer emits.
    expect(await screen.findByText("PO-FAIL-1")).toBeInTheDocument();
    expect(screen.getByText("PO-FAIL-2")).toBeInTheDocument();
    expect(screen.getByText("PO-FAIL-3")).toBeInTheDocument();

    // …and the non-failures are gone.
    expect(screen.queryByText("PO-OK-1")).toBeNull();
    expect(screen.queryByText("PO-OK-2")).toBeNull();
  });

  it("the 'Delivered' chip does NOT sweep up failures", async () => {
    getAuditLog.mockResolvedValue(
      apiPage([
        { ...evt("DeliveryDeadLettered", "f1"), poNumber: "PO-FAIL-1" },
        { ...evt("DeliveryConfirmedManually", "ok1"), poNumber: "PO-OK-1" },
      ]),
    );

    renderLog();

    await screen.findByText("PO-FAIL-1");
    screen.getByRole("button", { name: "Delivered" }).click();

    expect(await screen.findByText("PO-OK-1")).toBeInTheDocument();
    // The whole defect, stated as a filter: a dead-lettered delivery is not a delivery.
    expect(screen.queryByText("PO-FAIL-1")).toBeNull();
  });
});

// ── The unmapped case must not silently succeed ──────────────────────────────

describe("CrossingsLog — an action this build does not know", () => {
  it("renders as unrecognised, never as a delivery", async () => {
    // The exact scenario the `?? \"crossed\"` fallback mishandled: the backend adds
    // an action, this build has not been updated, and the operator is shown a green
    // "Delivered" row for something nobody has classified.
    getAuditLog.mockResolvedValue(apiPage([evt("SomeBrandNewBackendAction")]));

    renderLog();

    expect(await screen.findByText("PO-4711")).toBeInTheDocument();
    expect(screen.queryByTitle("Delivered")).toBeNull();

    // The row is painted `unknown`. Checking the LABEL alone is not enough — an
    // unrecognised action has no manifest label, so it shows its raw name either
    // way, and the `?? "delivered"` fallback would still paint it green underneath.
    for (const badge of badges()) expect(badge.dataset.eventKind).toBe("unknown");
    expect(badges().length).toBeGreaterThan(0);

    expect(auditEventKind("SomeBrandNewBackendAction")).toBe("unknown");
    expect(isSuccessKind("unknown")).toBe(false);
    expect(auditActionFact("SomeBrandNewBackendAction")).toBeNull();
  });

  it("still shows the raw action so it can be reported, rather than inventing a label", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("SomeBrandNewBackendAction")]));

    renderLog();

    expect(await screen.findByTitle("SomeBrandNewBackendAction")).toBeInTheDocument();
  });

  it("is excluded from the Delivered chip", async () => {
    getAuditLog.mockResolvedValue(
      apiPage([
        { ...evt("SomeBrandNewBackendAction", "u1"), poNumber: "PO-UNK-1" },
        { ...evt("DeliveryConfirmedManually", "ok1"), poNumber: "PO-OK-1" },
      ]),
    );

    renderLog();

    await screen.findByText("PO-UNK-1");
    screen.getByRole("button", { name: "Delivered" }).click();

    expect(await screen.findByText("PO-OK-1")).toBeInTheDocument();
    expect(screen.queryByText("PO-UNK-1")).toBeNull();
  });
});

// ── Held is not delivered either ─────────────────────────────────────────────

describe("CrossingsLog — a parked delivery is not a delivered one", () => {
  it.each(["DeliveryUnconfirmed", "DeliveryHeldForBilling"])("%s renders as held", async (action) => {
    getAuditLog.mockResolvedValue(apiPage([evt(action)]));

    renderLog();

    expect(await screen.findByText("PO-4711")).toBeInTheDocument();
    expect(screen.queryByTitle("Delivered")).toBeNull();
    for (const badge of badges()) expect(badge.dataset.eventKind).toBe("held");
    expect(badges().length).toBeGreaterThan(0);
    expect(auditEventKind(action)).toBe("held");
    expect(isSuccessKind(auditEventKind(action))).toBe(false);
  });
});

// ── Anti-vacuity: the manifest must actually cover the vocabulary ────────────
//
// Without these, a manifest that silently covered nothing would make every test
// above pass — every action would resolve to `unknown`, which is not a delivery, so
// "does not render as a delivery" would be true for the wrong reason.

describe("auditActionManifest — coverage floors", () => {
  it("covers the whole enumerated backend vocabulary", () => {
    // 49 rows: 44 a production writer can emit + 5 declared-but-unwritten.
    // Read from ProcuLink @ main 5db0b05 — every `AuditEvents.Add` site in
    // production (there are no AddRange sites), plus AuditController.BuildMessage
    // and the OrdersController error-message query.
    //
    // +2 reachable from backend #199 (`inbound_email.attachment_skipped_undecodable`
    // and `…_empty`), which split one silent attachment-skip branch into two audited
    // causes. Bumping these numbers is the point: a backend action with no row here
    // renders as `unknown`, so the count is what makes the manifest's growth deliberate.
    //
    // +2 reachable from backend #214 (`inbound_email.rejected_plan_gate` and
    // `…_rejected_order_limit`), the two gates the Postmark webhook never had. Both
    // are refusals a customer can act on, so a row that reads `unknown` would be the
    // audit trail failing at precisely the moment it is being consulted.
    expect(AUDIT_ACTION_FACTS).toHaveLength(51);
    expect(REACHABLE_AUDIT_ACTIONS).toHaveLength(46);
  });

  it("classifies a substantial number of them as failures", () => {
    // The shipped build classified exactly ONE action as a failure
    // (`delivery_failed`), and no writer emits it — so the count that mattered was
    // zero. A regression that collapses the failure set fails here.
    expect(FAILURE_AUDIT_ACTIONS.length).toBeGreaterThanOrEqual(15);
  });

  it("every named failure is in the failure set", () => {
    for (const action of NAMED_FAILURES) {
      expect(FAILURE_AUDIT_ACTIONS).toContain(action);
    }
  });

  it("reserves the delivered kind — a transform or a queue-retry is not an arrival", () => {
    const delivered = AUDIT_ACTION_FACTS.filter((f) => f.kind === "delivered").map((f) => f.action);
    // `Transformed` builds the file; `DeliveryRequeuedByOperator` puts it back on the
    // queue. CLAUDE.md §14: "Delivery UI must not imply an order is sent just because
    // a transform artifact exists."
    expect(delivered).not.toContain("Transformed");
    expect(delivered).not.toContain("DeliveryRequeuedByOperator");
    expect(delivered).toContain("DeliveryConfirmedManually");
  });

  it("no two rows collide once case is folded", () => {
    // The lookup lowercases (BuildMessage compares OrdinalIgnoreCase), so a table
    // holding both `Delivered` and `delivered` would silently drop one.
    const keys = AUDIT_ACTION_FACTS.map((f) => f.action.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every row cites a backend site and names a kind", () => {
    for (const fact of AUDIT_ACTION_FACTS) {
      expect(fact.backendSite, `${fact.action} has no backendSite`).toMatch(/ProcuLink\.[A-Za-z.]+\/.+:\d+|\.cs:\d+/);
      expect(fact.label.length, `${fact.action} has no label`).toBeGreaterThan(0);
    }
  });

  it("uses the repo's canonical status wording, not a parallel vocabulary", () => {
    // src/test/statusVocabulary.test.ts bans the old phrasings outright ("Delivery
    // failed" → "Couldn't send", "dead-letter" → "Out of retries"). Where an audit
    // action names the same thing as an order status, it must say the same words —
    // otherwise the log and the order screen describe one event two ways, which is
    // how the retired vocabulary got a second life last time.
    const expected: Record<string, string> = {
      ParseFailed: STATUS_LABELS.failed,
      TransformFailed: STATUS_LABELS.transform_failed,
      DeliveryFailed: STATUS_LABELS.delivery_failed,
      delivery_failed: STATUS_LABELS.delivery_failed,
      DeliveryDeadLettered: STATUS_LABELS.delivery_dead_letter,
      MarkedRejected: STATUS_LABELS.rejected_by_supplier,
      DeliveryUnconfirmed: STATUS_LABELS.delivery_unconfirmed,
      DeliveryHeldForBilling: STATUS_LABELS.delivery_held,
    };
    for (const [action, label] of Object.entries(expected)) {
      expect(auditActionFact(action)?.label, `${action} should read "${label}"`).toBe(label);
    }
  });

  it("matches case-insensitively, so a writer's casing cannot break a row", () => {
    expect(auditEventKind("deliverydeadlettered")).toBe("failed");
    expect(auditEventKind("DELIVERYDEADLETTERED")).toBe("failed");
    // The legacy snake spellings the old map was written in still resolve.
    expect(auditEventKind("delivery_failed")).toBe("failed");
    expect(auditEventKind("created")).toBe("created");
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe("CrossingsLog — the org's history past the first page", () => {
  it("shows a pager and the range it is on when there is more than one page", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")], 640));

    renderLog();

    await screen.findByText("PO-4711");
    const pager = screen.getByRole("navigation", { name: /Delivery log pages/i });
    expect(within(pager).getByText(/page 1 of 13/i)).toBeInTheDocument();
    // Nothing older was reachable at all before: page 1 was hard-coded and there was
    // no page control anywhere in the file.
    expect(within(pager).getByRole("button", { name: /Older entries/i })).toBeEnabled();
    expect(within(pager).getByRole("button", { name: /Newer entries/i })).toBeDisabled();
  });

  it("asks the API for the next page when Older is pressed", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")], 640));

    renderLog();

    await screen.findByText("PO-4711");
    expect(getAuditLog).toHaveBeenCalledWith(1, 50);

    screen.getByRole("button", { name: /Older entries/i }).click();

    await vi.waitFor(() => expect(getAuditLog).toHaveBeenCalledWith(2, 50));
  });

  it("shows no pager when the whole log fits on one page", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")]));

    renderLog();

    await screen.findByText("PO-4711");
    expect(screen.queryByRole("navigation", { name: /Delivery log pages/i })).toBeNull();
  });

  it("keeps the pager on screen when the filter empties the page", async () => {
    // Otherwise the operator whose search matched nothing loses the only control
    // that could reach the page where it does match.
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")], 640));

    renderLog();

    await screen.findByText("PO-4711");
    screen.getByRole("button", { name: "Failed" }).click();

    expect(await screen.findByText(/No matching events on this page/i)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /Delivery log pages/i })).toBeInTheDocument();
  });
});

// ── The empty state must admit what it searched ──────────────────────────────

describe("CrossingsLog — the empty state says how far it looked", () => {
  it("admits the search only covered this page", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")], 640));

    renderLog();

    await screen.findByText("PO-4711");
    screen.getByRole("button", { name: "Failed" }).click();

    // The shipped copy was "No matching events / Nothing recorded for this filter
    // yet" — a confident, wrong "nothing" for an operator searching an older PO.
    expect(await screen.findByText(/only cover the 1 entries on this page/i)).toBeInTheDocument();
    expect(screen.getByText(/out of 640 in the workspace/i)).toBeInTheDocument();
    expect(screen.queryByText("Nothing recorded for this filter yet.")).toBeNull();
  });

  it("does not claim a partial window when the whole log is loaded", async () => {
    getAuditLog.mockResolvedValue(apiPage([evt("Parsed")]));

    renderLog();

    await screen.findByText("PO-4711");
    screen.getByRole("button", { name: "Failed" }).click();

    expect(await screen.findByText(/Nothing in this workspace's log matches/i)).toBeInTheDocument();
    expect(screen.queryByText(/on this page, out of/i)).toBeNull();
  });
});
