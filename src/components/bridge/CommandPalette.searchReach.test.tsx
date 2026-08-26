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

// The palette's ["orders"] query is gated on useTenantQueriesEnabled, like every other
// tenant-scoped query in the shell. This suite is about SEARCH REACH, not about the
// organisation-activation window, so the gate is mocked open — which is what a real
// signed-in workspace with an active organisation returns.
vi.mock("@/hooks/useQueriesEnabled", () => ({
  useQueriesEnabled: () => true,
  useTenantQueriesEnabled: () => true,
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

// ─────────────────────────────────────────────────────────────────────────────
// "Searching all orders…" WAS A TERMINAL STATE, NOT A TRANSIENT ONE.
//
// The reach fix above wrote three careful sentences for three states of a query
// that ANSWERS. It never made the query fail. So this survived it, verbatim:
//
//     const { data: searchPage, isFetching: searchFetching } = useQuery({…});   // no isError
//     const serverResultsCurrent =
//       serverSearchActive && debouncedQ === normalizedQ && !searchFetching && searchPage !== undefined;
//     const searchPending = serverSearchActive && !serverResultsCurrent;
//
// Follow it through on a 500. `searchPage` stays `undefined` forever, so
// `serverResultsCurrent` is permanently false, so `searchPending` is permanently
// TRUE, so the palette prints "Searching all orders…" for as long as it is open.
// No error, no retry, no way to distinguish a dead endpoint from a slow one —
// and the honest-looking progress sentence is what makes it worse than a blank:
// it actively tells the operator to keep waiting for something that will never
// arrive.
//
// This is the same one-directional-guard shape as the notifications panel: the
// guard was written for REACH and is blind to FAILURE.
// ─────────────────────────────────────────────────────────────────────────────

/** Reject only the server SEARCH; the recent-orders page keeps working. */
function failSearchOnly(): void {
  getOrders.mockImplementation(async (params: GetOrdersParams = {}) => {
    if (params.search !== undefined) throw new Error("500 Internal Server Error");
    return pageOf(RECENT, params.pageSize ?? 25);
  });
}

describe("command palette search — a failed search is not a pending one", () => {
  it("stops claiming it is still searching once the request has failed", async () => {
    failSearchOnly();
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("z");

    await waitFor(() => expect(bodyText()).toContain("We couldn't search your orders"));
    // The exact defect: the progress sentence outliving the request that justified it.
    expect(bodyText()).not.toContain("Searching all orders");
  });

  it("does not report the search as a no-match verdict either", async () => {
    failSearchOnly();
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("z");

    await waitFor(() => expect(bodyText()).toContain("We couldn't search your orders"));
    // The other wrong answer. A 500 is not evidence about whether PO-6012Z exists.
    expect(bodyText()).not.toContain("No results for");
  });

  it("offers a way out", async () => {
    failSearchOnly();
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("z");

    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(retry).toBeTruthy();
  });

  it("says so even when actions matched, so a partial list can't read as the whole answer", async () => {
    // "u" matches the "Upload document" action client-side, so `hasResults` is
    // true and the empty-state slot never renders. Without a notice outside that
    // slot the palette would show a short, confident, ORDER-FREE list over a
    // failed order search — the most misleading shape of all, because nothing on
    // screen is obviously missing.
    failSearchOnly();
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("u");

    await waitFor(() => expect(bodyText()).toContain("We couldn't search your orders"));
    expect(bodyText()).toContain("Upload document");
  });
});

describe("command palette search — failure copy is NOT the no-match copy (anti-vacuity control)", () => {
  it("a search that genuinely returns nothing still gets the no-results verdict", async () => {
    // Same component, same keystroke, one difference: the request RESOLVES with
    // an empty page instead of throwing. If the failure sentence appeared here
    // too, the four tests above would be testing nothing.
    getOrders.mockImplementation(async (params: GetOrdersParams = {}) => {
      const pageSize = params.pageSize ?? 25;
      return params.search !== undefined ? pageOf([], pageSize) : pageOf(RECENT, pageSize);
    });
    renderPalette();
    await waitFor(() => expect(bodyText()).toContain("PO-6000"));

    type("qqqq");

    await waitFor(() => expect(bodyText()).toContain("No results for"));
    expect(bodyText()).not.toContain("We couldn't search your orders");
    expect(bodyText()).not.toContain("Searching all orders");
  });
});
