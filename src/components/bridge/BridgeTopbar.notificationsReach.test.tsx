import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderSummary, OrdersPage, OrdersSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// The notifications panel contradicted its own header.
//
// THE DEFECT, VERBATIM:
//
//     {unread > 0 && <span …>{unread} need action</span>}
//     …
//     {top.length === 0 ? (
//       <div …>No new activity.</div>
//
// Four lines apart, and derived from two DIFFERENT populations. `top` is built
// from `GET /api/orders?pageSize=100` — the newest hundred, capped at seven rows.
// `unread` is summed from `GET /api/orders/summary`, which counts the WHOLE
// account. So an order that is failed, held or unrouted but older than the newest
// hundred raised the badge and the header and had no row to render, and the panel
// answered that with "No new activity."
//
// What the operator saw, in one 320px popover, at the same instant:
//
//     Notifications                    12 need action
//     ─────────────────────────────────────────────
//                  No new activity.
//
// …with the bell reading "9+". The header is right, the badge is right, and the
// body denies both. Whichever one the operator believed, the panel had already
// told them the opposite, so the only safe reading was to distrust the surface —
// which is the surface whose entire job is to be trusted about what needs doing.
//
// DIRECTION. The gap between the two numbers is structural and stays: paging the
// whole account into a popover is not the fix. What must go is the CLAIM. When
// `unread > 0` and there is no row to show, the panel has to say that the orders
// exist and are older than the window it lists, and point at the inbox.
// ─────────────────────────────────────────────────────────────────────────────

const getOrders = vi.fn();
const getOrdersSummary = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrders: (...a: unknown[]) => getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => getOrdersSummary(...a),
  },
  getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth" }),
  checkAdminAccess: vi.fn().mockResolvedValue(false),
  getBuyers: vi.fn().mockResolvedValue([]),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { id: "org_1", name: "Acme" }, membership: { role: "org:admin" } }),
  useOrganizationList: () => ({ isLoaded: true, setActive: vi.fn(), userMemberships: { data: [], isLoading: false, isFetching: false, hasNextPage: false, fetchNext: vi.fn() } }),
  useClerk: () => ({ openCreateOrganization: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn() }),
  useUser: () => ({ user: null, isLoaded: true }),
}));

import { NotificationsBell } from "./BridgeTopbar";

/**
 * A status `notifKindFor()` maps to null — nothing is wrong with the order and
 * nobody is needed. A page full of these is what "the newest hundred are all
 * fine" looks like, and it is the only way to reach `top.length === 0` with a
 * NON-EMPTY orders page. An empty page would satisfy the empty state either way
 * and would prove nothing.
 */
const BENIGN_STATUS = "parsing" as OrderSummary["status"];

function order(n: number): OrderSummary {
  return {
    id: `ord-${n}`,
    poNumber: `PO-${5000 + n}`,
    supplierName: "Nordmark",
    buyerName: "Heinrich Industries",
    orderDate: "2026-08-14",
    status: BENIGN_STATUS,
    lineCount: 3,
    unresolvedCount: 0,
    createdAt: "2026-08-14T09:00:00.000Z",
  };
}

/** The newest hundred, every one of them healthy. */
const RECENT_ALL_FINE: OrderSummary[] = Array.from({ length: 100 }, (_, i) => order(i));

function page(items: OrderSummary[]): OrdersPage {
  return { items, totalCount: items.length, page: 1, pageSize: 100 };
}

/** 12 orders need action somewhere in the account — none of them in the window above. */
const SUMMARY_WITH_OLD_FAILURES: OrdersSummary = {
  byStatus: { failed: 7, delivery_failed: 4, unrouted: 1 },
  total: 4_000,
};

const SUMMARY_ALL_CLEAR: OrdersSummary = { byStatus: {}, total: 4_000 };

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationsBell />
    </QueryClientProvider>,
  );
}

/** Open the popover. The trigger's accessible name carries the count once loaded. */
async function openPanel(): Promise<void> {
  const bell = await screen.findByRole("button", { name: /notifications/i });
  fireEvent.click(bell);
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  getOrders.mockReset();
  getOrdersSummary.mockReset();
  getOrders.mockResolvedValue(page(RECENT_ALL_FINE));
  getOrdersSummary.mockResolvedValue(SUMMARY_WITH_OLD_FAILURES);
});

afterEach(cleanup);

describe("notifications panel — anti-vacuity floors", () => {
  it("the fixture really does produce a non-empty page with zero listable rows", () => {
    // Without this, an empty-account fixture would satisfy every assertion below
    // while reproducing none of the defect. The page has a hundred orders; not
    // one of them is something a human has to act on.
    expect(RECENT_ALL_FINE).toHaveLength(100);
    expect(RECENT_ALL_FINE.every((o) => o.status === BENIGN_STATUS)).toBe(true);
    expect(RECENT_ALL_FINE.every((o) => o.unresolvedCount === 0)).toBe(true);
  });

  it("the summary really does count orders outside that page", () => {
    const counted = Object.values(SUMMARY_WITH_OLD_FAILURES.byStatus).reduce((a, b) => a + (b ?? 0), 0);
    expect(counted).toBe(12);
    // The two populations genuinely disagree — that disagreement IS the defect's
    // precondition, so it is asserted rather than assumed.
    expect(counted).toBeGreaterThan(0);
  });
});

describe("notifications panel — never claims emptiness while the header claims work", () => {
  it("does not say 'No new activity.' when orders need action", async () => {
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("12 need action"));

    // The exact contradiction: the header's count and the body's denial, together.
    expect(bodyText()).not.toContain("No new activity.");
  });

  it("says the orders exist and are older than the listed window", async () => {
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("12 orders need action"));

    const text = bodyText();
    expect(text).toContain("older than the recent activity shown here");
    // Points somewhere. The panel's own footer button goes to the inbox.
    expect(text).toMatch(/inbox/i);
  });

  it("uses the singular when exactly one order needs action", async () => {
    getOrdersSummary.mockResolvedValue({ byStatus: { delivery_held: 1 }, total: 4_000 } as OrdersSummary);
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("1 order needs action"));
    expect(bodyText()).not.toContain("1 orders need action");
    expect(bodyText()).not.toContain("No new activity.");
  });
});

describe("notifications panel — still says nothing when there is nothing", () => {
  it("keeps 'No new activity.' for an account with no outstanding work", async () => {
    // The fix must not be "delete the empty state". When the summary agrees with
    // the list, the original sentence is the correct one and it survives.
    getOrdersSummary.mockResolvedValue(SUMMARY_ALL_CLEAR);
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("No new activity."));
    expect(bodyText()).not.toContain("need action");
  });
});

describe("notifications panel — does not answer before it has asked", () => {
  it("says it is still checking while both queries are in flight", async () => {
    getOrders.mockReturnValue(new Promise<OrdersPage>(() => {}));
    getOrdersSummary.mockReturnValue(new Promise<OrdersSummary>(() => {}));

    renderBell();
    await openPanel();

    // Nothing has answered yet. "No new activity." here is a statement about
    // data that has not arrived — the same unearned certainty in a different
    // dress, and the state a real account spends its first second in.
    await waitFor(() => expect(bodyText()).toContain("Checking for new activity"));
    expect(bodyText()).not.toContain("No new activity.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME SENTENCE, LYING A SECOND WAY — the failure case, which the reach fix
// above did not cover.
//
// The guard written for reach asserts what the panel says when the summary
// ANSWERS. It never once made the summary fail. So this survived it, verbatim:
//
//     const { data: ordersSummary, isLoading: summaryLoading } = useQuery({
//       queryKey: ["orders-summary"], …                      // no isError
//     const unread = (ordersSummary?.byStatus?.["pending_review"] ?? 0) + …
//
// `?? 0`, nine times. A failed GET /api/orders/summary is therefore
// indistinguishable, in every pixel, from a workspace with nothing wrong: the
// bell badge disappears, the panel header drops "N need action", and the body
// prints "No new activity." — while failed, held, unconfirmed and unrouted
// orders sit in the account. This is the app's ONLY always-visible "is anything
// wrong?" affordance, and it is the one that fails open.
//
// The divergence was visible on one screen: BridgeDashboard branches on its own
// summaryError and prints "—", so the dashboard showed dashes while the chrome
// directly above it showed all-clear.
//
// A check that did not run is not a check that passed.
// ─────────────────────────────────────────────────────────────────────────────

describe("notifications panel — a failed summary is not an all-clear", () => {
  it("does not say 'No new activity.' when the summary query failed", async () => {
    getOrdersSummary.mockRejectedValue(new Error("500 Internal Server Error"));
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("We couldn't check for new activity."));
    // The whole defect, in one assertion: the sentence that means "we looked at
    // the whole account and it is clean" must not appear over a lookup that 500'd.
    expect(bodyText()).not.toContain("No new activity.");
  });

  it("keeps a visible bell badge when the count is unknown", async () => {
    getOrdersSummary.mockRejectedValue(new Error("500 Internal Server Error"));
    renderBell();

    // The accessible name is the assertion, because the visual badge is the thing
    // that used to vanish. "Notifications" alone — the healthy, nothing-to-do name
    // — is what a failed summary rendered.
    const bell = await screen.findByRole("button", { name: /activity status unavailable/i });
    expect(bell).toBeTruthy();
  });

  it("says so in the panel header too, where '12 need action' would go", async () => {
    getOrdersSummary.mockRejectedValue(new Error("500 Internal Server Error"));
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("Status unavailable"));
    expect(bodyText()).not.toMatch(/\d+ need action/);
  });

  it("also refuses the all-clear when the ORDERS page is what failed", async () => {
    // The other half of the pair. `top` comes from GET /api/orders; if that call
    // dies the panel has no rows for a reason that has nothing to do with there
    // being no work — and with the summary healthy and empty it would print the
    // clean sentence.
    getOrders.mockRejectedValue(new Error("503 Service Unavailable"));
    getOrdersSummary.mockResolvedValue(SUMMARY_ALL_CLEAR);
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("We couldn't check for new activity."));
    expect(bodyText()).not.toContain("No new activity.");
  });
});

describe("notifications panel — failure copy is NOT the empty copy (anti-vacuity control)", () => {
  it("a healthy, genuinely empty account still gets the clean sentence and the plain bell", async () => {
    // The control that makes the four tests above mean something. Identical
    // component, identical orders fixture, ONE difference: the summary resolves
    // instead of rejecting. If this test and the failure tests both passed
    // against a component that always printed the failure sentence, neither would
    // be evidence of anything.
    getOrdersSummary.mockResolvedValue(SUMMARY_ALL_CLEAR);
    renderBell();
    await openPanel();

    await waitFor(() => expect(bodyText()).toContain("No new activity."));
    expect(bodyText()).not.toContain("We couldn't check for new activity.");
    expect(bodyText()).not.toContain("Status unavailable");
    // The plain name — no "activity status unavailable" suffix.
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });
});
