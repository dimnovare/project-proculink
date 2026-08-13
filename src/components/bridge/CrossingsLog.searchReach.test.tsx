import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";
import { auditActionFact } from "@/lib/auditActionManifest";

// ─────────────────────────────────────────────────────────────────────────────
// The delivery log's search could not find a failure by what the failure SAID.
//
// THE DEFECT, VERBATIM:
//
//     const ms = !q || e.po.toLowerCase().includes(q)
//                   || e.buyer.toLowerCase().includes(q)
//                   || e.supplier.toLowerCase().includes(q);
//
// Three fields, none of which is what a row is about. The event word an operator
// had just read on the row ("Out of retries", "Couldn't build output") and the
// supplier's own refusal sentence in the expanded panel were both unsearchable —
// on the one screen whose job is explaining a failure. Typing either produced
// "No matching events on this page", which is indistinguishable from a log that
// genuinely holds no such failure. The placeholder compounded it: it read "Filter
// by PO…" while the predicate silently also matched buyer and supplier, so the
// control named less than it did and the operator could not predict the result
// either way.
//
// DIRECTION. The fix must not become "match everything": a search that also swept
// internal ids and raw ISO timestamps would return rows for a query the operator
// cannot see the cause of, which is the same unpredictability wearing the other
// hat. The negative half below pins the two fields deliberately left out, and each
// negative is preceded by a floor proving the field really was present in the row
// and really was absent from the match.
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

/** The action whose label and reason this file searches for. */
const DEAD_LETTER = "DeliveryDeadLettered";

/** What the row will display as its event word — read from the manifest, never typed. */
const DEAD_LETTER_LABEL = auditActionFact(DEAD_LETTER)?.label ?? "";

/** The payload key that carries this action's reason, likewise read, never typed. */
const DEAD_LETTER_REASON_KEY = auditActionFact(DEAD_LETTER)?.reasonKeys[0] ?? "";

const SUPPLIER_SENTENCE = "Purchase order rejected: item code ABC-123 is not in our catalogue.";

function entry(over: Partial<AuditLogEntry> & Pick<AuditLogEntry, "id" | "action">): AuditLogEntry {
  return {
    ts: "2026-08-06T09:15:00.000Z",
    orderId: "ord-needle-9f2c",
    poNumber: "PO-4711",
    buyerName: "Heinrich Industries",
    supplierName: "Nordmark",
    format: "PDF",
    actorType: "system",
    actorName: "Automatic delivery",
    message: "Delivery gave up",
    payload: null,
    ...over,
  } as AuditLogEntry;
}

const ROWS: AuditLogEntry[] = [
  entry({
    id: "e-dead",
    action: DEAD_LETTER,
    payload: { [DEAD_LETTER_REASON_KEY]: SUPPLIER_SENTENCE, attemptCount: 5 },
  }),
  // A second, unrelated row so "the list filtered to one" is a real narrowing
  // rather than the list having held one row all along.
  entry({
    id: "e-parsed",
    action: "Parsed",
    poNumber: "PO-9999",
    supplierName: "Baltica",
    message: "Parsed",
    payload: null,
  }),
];

function renderLog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

async function searchFor(term: string): Promise<void> {
  const box = await screen.findByLabelText(/search the delivery log/i);
  fireEvent.change(box, { target: { value: term } });
}

/** True when the dead-letter row survived the current filter. */
function deadLetterRowVisible(): boolean {
  return screen.queryAllByText("PO-4711").length > 0;
}

/** True when the unrelated control row survived. */
function otherRowVisible(): boolean {
  return screen.queryAllByText("PO-9999").length > 0;
}

beforeEach(() => {
  getAuditLog.mockReset();
  searchParams = new URLSearchParams();
  getAuditLog.mockResolvedValue({ events: ROWS, total: ROWS.length, page: 1, pageSize: 50 });
});

afterEach(cleanup);

describe("delivery log search — anti-vacuity floors", () => {
  it("reads a real label and a real reason key from the manifest", () => {
    // Every assertion below searches for one of these two strings. If the manifest
    // stopped supplying them the searches would be for "" — which `includes("")`
    // answers true for on every row, passing every positive test vacuously.
    expect(DEAD_LETTER_LABEL.length).toBeGreaterThan(3);
    expect(DEAD_LETTER_REASON_KEY.length).toBeGreaterThan(0);
    expect(SUPPLIER_SENTENCE).not.toContain(DEAD_LETTER_LABEL);
  });

  it("renders both rows before any search is typed", async () => {
    renderLog();
    expect(await screen.findByText("PO-4711")).toBeInTheDocument();
    expect(deadLetterRowVisible()).toBe(true);
    expect(otherRowVisible()).toBe(true);
  });
});

describe("delivery log search — finds a failure by what it says", () => {
  it("matches the event word shown on the row", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    await searchFor(DEAD_LETTER_LABEL);

    expect(deadLetterRowVisible()).toBe(true);
    // Real narrowing: the unrelated row is gone.
    expect(otherRowVisible()).toBe(false);
  });

  it("matches the supplier's own refusal sentence from the expanded panel", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    await searchFor("not in our catalogue");

    expect(deadLetterRowVisible()).toBe(true);
    expect(otherRowVisible()).toBe(false);
  });

  it("matches the row message", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    await searchFor("gave up");

    expect(deadLetterRowVisible()).toBe(true);
    expect(otherRowVisible()).toBe(false);
  });

  it("matches the actor shown in the row", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    await searchFor("Automatic delivery");

    expect(deadLetterRowVisible()).toBe(true);
  });

  it("still matches PO, buyer and supplier — the three it always did", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    for (const term of ["PO-4711", "Heinrich", "Nordmark"]) {
      await searchFor(term);
      expect(deadLetterRowVisible()).toBe(true);
    }
  });
});

describe("delivery log search — does not match what the operator cannot see", () => {
  it("does not match the internal order id", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    // Floor: the id really is on the row's data, so this negative is about the
    // search predicate and not about a field that was never there.
    expect(ROWS[0].orderId).toBe("ord-needle-9f2c");

    await searchFor("needle-9f2c");

    // The order FILTER owns exact-id lookup. A fuzzy substring match here would
    // answer the same question differently depending on which control was used.
    expect(deadLetterRowVisible()).toBe(false);
  });

  it("does not match the raw ISO timestamp", async () => {
    renderLog();
    await screen.findByText("PO-4711");

    expect(ROWS[0].ts).toContain("2026-08-06T09:15");

    await searchFor("2026-08-06T09:15");

    // The operator sees a wall-clock time, not an ISO string. Matching text
    // nobody can read makes "why did that row match?" unanswerable.
    expect(deadLetterRowVisible()).toBe(false);
  });
});

describe("delivery log search — the control names its own reach", () => {
  it("the placeholder names more than PO", async () => {
    renderLog();
    const box = await screen.findByLabelText(/search the delivery log/i);
    const placeholder = box.getAttribute("placeholder") ?? "";
    // It said "Filter by PO…" while also matching buyer and supplier.
    expect(placeholder).not.toBe("Filter by PO…");
    expect(placeholder).toMatch(/supplier/i);
    expect(placeholder).toMatch(/event|message/i);
  });
});
