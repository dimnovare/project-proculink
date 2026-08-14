import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GetOrdersParams, OrderSummary, OrdersPage } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// cmd-K searched six orders and then reported, without qualification, that the
// thing was not there.
//
// THE DEFECT, VERBATIM:
//
//     if (q.length < 2) { setDebouncedQ(""); return; }              // debounce
//     enabled: !isApiMockMode && debouncedQ.length >= 2,            // server query
//     const orderResults = debouncedQ.length >= 2 && !isApiMockMode
//       ? (searchPage?.items ?? [])
//       : (ordersPage?.items ?? []).slice(0, 6);                    // ← the reach
//     …
//     No results for “{q}”
//
// A ONE-character query never reaches the server: `debouncedQ` is forced to ""
// below two characters, so the order rows fall back to the six most recent and
// the palette matches a substring against those six. Six. Then it prints "No
// results for “z”" — the same sentence it prints after searching the entire
// account, in the same place, in the same words. The operator cannot tell the
// two apart, and the second keystroke's 200ms debounce window takes the same
// six-order path, so the message is briefly wrong for longer queries too.
//
// THE FIX, AND WHY THIS ONE. The threshold drops to one character rather than
// only rewording the empty state, because the reach is the actual defect and the
// cost argument for keeping it at two does not survive contact with the debounce
// already in the file: every keystroke clears the pending timer, so typing
// "PO-4711" fires ONE request either way. Dropping to one adds a request in
// exactly the case that was broken — a single character, then a pause.
//
// A SECOND, WORSE SHAPE, fixed here too. The eight rows the server returned were
// re-filtered client-side against `label`/`sub`. The backend matches PoNumber,
// Supplier.Name and BuyerName with Postgres `ILIKE '%term%'` over a TRIMMED term
// (OrderQueryService.ListWindowAsync). JS `.includes()` over an untrimmed term
// is not that function: `_` and `%` are wildcards to one and literals to the
// other, and a pasted PO number with a trailing space matches server-side and
// fails client-side. Each disagreement printed "No results" on top of a
// NON-EMPTY server response — the account holds the order, the API returned it,
// and the screen denies both.
// ─────────────────────────────────────────────────────────────────────────────

const getOrders = vi.fn();
const getSuppliers = vi.fn();
const getBuyers = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrders: (...a: unknown[]) => getOrders(...a),
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
  },
  getBuyers: (...a: unknown[]) => getBuyers(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The mapper power commands are irrelevant here and their labels would add noise
// to the "nothing matched" assertions. Emptied so the index is orders + actions.
vi.mock("./mapper/mapperCommands", () => ({
  buildMapperCommands: () => [],
  dispatchMapper: vi.fn(),
}));

import { CommandPalette } from "./CommandPalette";

/** How many recent orders the palette previews when it is not searching the server. */
const PREVIEW = 6;

function order(n: number, over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: `ord-${n}`,
    poNumber: `PO-${6000 + n}`,
    supplierName: "Nordmark",
    buyerName: "Heinrich Industries",
    orderDate: "2026-08-14",
    status: "pending_review",
    lineCount: 4,
    unresolvedCount: 0,
    createdAt: new Date(Date.UTC(2026, 7, 14, 12, 0, 0) - n * 3_600_000).toISOString(),
    ...over,
  };
}

/**
 * The order the operator is looking for. Deliberately the 13th-newest, and the
 * only row in the set whose text contains a "z" — which is what makes the
 * one-character query below a real question rather than a lucky one.
 *
 * The "z" rides on the PO NUMBER rather than on an invented supplier: party
 * names in this repo are policed by src/test/counterpartyDeIdentification.test.ts
 * (both repos are private now but their CI logs were public for weeks), and a
 * made-up company added here would have to be added to that guard's approved
 * vocabulary as well. The PO number carries the distinguishing character for
 * free, and it is also the first field the backend's search matches.
 */
const NEEDLE_PO = "PO-6012Z";
const NEEDLE_INDEX = 12;

/**
 * Newest-first, matching `GET /api/orders` (`OrderByDescending(o => o.CreatedAt)`).
 * Exactly one row carries a "z", and it sits outside the six-row preview.
 */
const RECENT: OrderSummary[] = Array.from({ length: 20 }, (_, i) =>
  i === NEEDLE_INDEX ? order(i, { poNumber: NEEDLE_PO }) : order(i),
);

/**
 * Postgres `ILIKE '%term%'` over the three fields the backend really matches,
 * with the server's `Trim()`. Written as a simulation rather than a canned
 * response so the client/server disagreements below are the REAL ones — `_` and
 * `%` behave here exactly as they behave in the database.
 */
function serverSearch(term: string): OrderSummary[] {
  const t = term.trim();
  if (!t) return RECENT;
  const pattern = t
    .split("")
    .map((c) => (c === "_" ? "." : c === "%" ? ".*" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  const rx = new RegExp(pattern, "i");
  return RECENT.filter((o) => rx.test(o.poNumber) || rx.test(o.supplierName) || rx.test(o.buyerName ?? ""));
}

function pageOf(items: OrderSummary[], pageSize: number): OrdersPage {
  return { items: items.slice(0, pageSize), totalCount: items.length, page: 1, pageSize };
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommandPalette onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function type(term: string): void {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: term } });
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  getOrders.mockReset();
  getSuppliers.mockReset();
  getBuyers.mockReset();
  getSuppliers.mockResolvedValue([]);
  getBuyers.mockResolvedValue([]);
  getOrders.mockImplementation(async (params: GetOrdersParams = {}) => {
    const pageSize = params.pageSize ?? 25;
    return params.search !== undefined
      ? pageOf(serverSearch(params.search), pageSize)
      : pageOf(RECENT, pageSize);
  });
});

afterEach(cleanup);

describe("command palette search — anti-vacuity floors", () => {
  it("the needle is real, and it is outside the six-row preview", () => {
    // If the needle were inside the preview the fallback path would find it and
    // every positive assertion below would pass without the fix.
    expect(RECENT[NEEDLE_INDEX].poNumber).toBe(NEEDLE_PO);
    expect(NEEDLE_INDEX).toBeGreaterThanOrEqual(PREVIEW);
    expect(RECENT.length).toBeGreaterThan(PREVIEW);
  });

  it("the one-character query matches nothing in the preview and nothing in the actions", () => {
    const preview = RECENT.slice(0, PREVIEW);
    const hay = preview.map((o) => `${o.poNumber} ${o.supplierName} ${o.buyerName}`).join(" ");
    expect(hay.toLowerCase()).not.toContain("z");
    // And the server genuinely returns it, so a "no results" after the fix would
    // be the component's doing and not the fixture's.
    expect(serverSearch("z").map((o) => o.poNumber)).toEqual([NEEDLE_PO]);
  });
});

describe("command palette search — a one-character query reaches every order", () => {
  it("does not show the needle before anything is typed", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));
    // Floor for the test below: the preview really is six rows deep.
    expect(bodyText()).not.toContain(NEEDLE_PO);
  });

  it("finds an order outside the six most recent from ONE character", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("z");

    await waitFor(() => expect(bodyText()).toContain(NEEDLE_PO));
    expect(bodyText()).not.toContain("No results");
  });

  it("sends the one-character term to the server", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("z");

    await waitFor(() =>
      expect(getOrders.mock.calls.some(([p]: [GetOrdersParams]) => p?.search === "z")).toBe(true),
    );
  });
});

describe("command palette search — never denies what the server returned", () => {
  it("keeps a row whose term matched only as a SQL wildcard", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    // `_` is a single-character wildcard to Postgres and a literal to
    // `String.includes`. The server returns PO-6012; the old client filter threw
    // it away and printed "No results" over a non-empty response.
    expect(serverSearch("PO_6012").map((o) => o.poNumber)).toEqual([NEEDLE_PO]);

    type("PO_6012");

    await waitFor(() => expect(bodyText()).toContain(NEEDLE_PO));
    expect(bodyText()).not.toContain("No results");
  });

  it("keeps a row when the pasted term carries surrounding whitespace", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("  PO-6012  ");

    await waitFor(() => expect(bodyText()).toContain(NEEDLE_PO));
    expect(bodyText()).not.toContain("No results");
  });
});

describe("command palette search — does not answer before it has searched", () => {
  it("says it is searching while the debounce and request are still outstanding", () => {
    renderPalette();

    type("z");

    // Synchronously after the keystroke: the debounce has not fired, no request
    // has been made, and nothing is known about "z". "No results" here is a
    // verdict on a search that has not happened.
    expect(bodyText()).toContain("Searching all orders");
    expect(bodyText()).not.toContain("No results");
  });
});

describe("command palette search — still says no when the answer is no", () => {
  it("reports no results once the whole account has actually been searched", async () => {
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    expect(serverSearch("qqqq")).toHaveLength(0);

    type("qqqq");

    await waitFor(() => expect(bodyText()).toContain("No results for"));
    expect(bodyText()).toContain("qqqq");
  });
});
