import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeadLetterOrder, OpsHealth } from "@/lib/api/operations";

// ─────────────────────────────────────────────────────────────────────────────
// A TRANSIENT 5xx DELETED THE ONLY ESCALATION PATH IN THE PRODUCT.
//
// THE DEFECT, VERBATIM:
//
//     if (healthQ.isError || healthQ.data === undefined) {
//       return ( … "We couldn't load system status" … ) }      // the WHOLE page
//     …
//     {deadLetterQ.isError ? ( … "We couldn't load this list" … )
//
// `healthQ` polls every 45 seconds. One failed poll set `isError`, and the early
// return replaced the entire dashboard — every count, the Worker banner, and the
// dead-letter table with its "Start sending again" buttons, which is the only
// way an operator can push a stuck order back into delivery — with a card whose
// own words were false: "we just can't show you the current picture", said while
// a forty-five-second-old picture sat in the query cache, fully intact.
//
// TanStack keeps `data` across a failed refetch precisely so this does not have
// to happen. `isError ||` threw it away.
//
// THE RULE. A failed refresh downgrades CONFIDENCE; it does not erase KNOWLEDGE.
// `data === undefined` → blocking card. Error WITH data → a banner that says how
// old what you are reading is, over data that stays on screen and stays
// actionable.
//
// HOW THE STATE IS PRODUCED HERE. The cache is seeded with a real answer stamped
// two minutes ago, which is past the 30s staleTime, so mounting triggers a
// refetch; the refetch rejects. That is the live sequence, not a simulation of
// it — and it fixes `dataUpdatedAt`, so the age sentence is assertable.
// ─────────────────────────────────────────────────────────────────────────────

const getOpsHealth = vi.fn();
const getDeadLetterOrders = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/operations/health",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", () => ({
  getOpsHealth: (...a: unknown[]) => getOpsHealth(...a),
  getDeadLetterOrders: (...a: unknown[]) => getDeadLetterOrders(...a),
  requeueDelivery: vi.fn(),
}));

import OperationsHealthPage from "./page";

const HEALTH: OpsHealth = {
  parsingStuck: 0,
  deliveringStuck: 0,
  transformFailed: 0,
  deliveryFailed: 2,
  deliveryDeadLetter: 1,
  rejectedBySupplier: 0,
  failed: 0,
  slaBreached: 0,
  openExceptions: 3,
  pendingRouting: 0,
  deliveryUnconfirmed: 0,
  deliveryHeld: 0,
  pendingReview: 0,
  stuckThresholdMinutes: 15,
  totalProblemOrders: 6,
  workerHealthy: true,
  activeWorkers: 1,
  lastWorkerHeartbeatUtc: "2026-08-15T09:00:00Z",
  secondsSinceWorkerHeartbeat: 12,
} as OpsHealth;

const DEAD_LETTER: DeadLetterOrder[] = [
  {
    orderId: "ord-dl-1",
    poNumber: "PO-7788",
    supplierId: "sup-1",
    supplierName: "Nordmark",
    status: "delivery_dead_letter",
    deliveryAttempts: 5,
    lastError: "Connection reset by peer",
    lastResponseCode: null,
    lastAttemptAt: "2026-08-15T08:55:00Z",
    createdAt: "2026-08-15T08:00:00Z",
    updatedAt: "2026-08-15T08:55:00Z",
  },
];

/** Two minutes: past the 30s staleTime, and a round number for the age sentence. */
const TWO_MINUTES_MS = 120_000;

/**
 * Both queries set `retry: 1`, which overrides the test client's `retry: false`,
 * so a rejection is not terminal until the retry and its ~1s backoff are done.
 * Testing Library's default 1000ms wait expires first and would report the fix as
 * broken. `--testTimeout=60000` bounds the TEST, not the wait.
 */
const RETRY_WAIT = { timeout: 15_000 } as const;

function renderPage(seed: { health?: OpsHealth; deadLetter?: DeadLetterOrder[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stampedAt = Date.now() - TWO_MINUTES_MS;
  if (seed.health) client.setQueryData(["ops-health"], seed.health, { updatedAt: stampedAt });
  // `includeFailed` starts true, so this is the key the page actually reads.
  if (seed.deadLetter) client.setQueryData(["ops-dead-letter", true], seed.deadLetter, { updatedAt: stampedAt });
  render(
    <QueryClientProvider client={client}>
      <OperationsHealthPage />
    </QueryClientProvider>,
  );
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  getOpsHealth.mockReset();
  getDeadLetterOrders.mockReset();
  getOpsHealth.mockResolvedValue(HEALTH);
  getDeadLetterOrders.mockResolvedValue(DEAD_LETTER);
});

afterEach(cleanup);

describe("ops health — the seeding really does reproduce error-with-data (anti-vacuity floor)", () => {
  it("the seeded cache is stale enough to trigger the refetch that then fails", async () => {
    // If the seed were fresh, no refetch would fire, `isError` would stay false,
    // and every "banner appears" assertion below would be testing the happy path
    // with extra steps.
    getOpsHealth.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    await waitFor(() => expect(getOpsHealth).toHaveBeenCalled());
    expect(TWO_MINUTES_MS).toBeGreaterThan(30_000);
  });
});

describe("ops health — a failed poll does not delete the dashboard", () => {
  it("keeps the numbers and the Worker banner on screen", async () => {
    getOpsHealth.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    await waitFor(() => expect(bodyText()).toContain("We couldn't refresh system status"), RETRY_WAIT);
    // The blocking card is the thing that must NOT be here.
    expect(bodyText()).not.toContain("We couldn't load system status");
    expect(bodyText()).toContain("Order processing is running");
  });

  it("keeps the dead-letter rows and their requeue control", async () => {
    // The escalation path. This is what the early return was really costing.
    getOpsHealth.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    await waitFor(() => expect(bodyText()).toContain("We couldn't refresh system status"), RETRY_WAIT);
    expect(bodyText()).toContain("PO-7788");
    expect(screen.getAllByRole("button", { name: /start sending again/i }).length).toBeGreaterThan(0);
  });

  it("says how old the picture is instead of implying it is current", async () => {
    getOpsHealth.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    const banner = await screen.findByRole("alert", {}, RETRY_WAIT);
    expect(within(banner).getByText(/from 2 minutes ago/i)).toBeTruthy();
  });

  it("still shows the blocking card when there is genuinely nothing cached", async () => {
    // The other half of the split. Demoting the error must not delete the state
    // where the page really does know nothing — otherwise the fix would trade one
    // dishonest screen for another.
    getOpsHealth.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({});

    await waitFor(() => expect(bodyText()).toContain("We couldn't load system status"), RETRY_WAIT);
    expect(bodyText()).not.toContain("We couldn't refresh system status");
  });
});

describe("ops health — dead-letter list, same split", () => {
  it("keeps cached rows under a staleness banner when only the refresh failed", async () => {
    getDeadLetterOrders.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    await waitFor(() => expect(bodyText()).toContain("We couldn't refresh this list"), RETRY_WAIT);
    expect(bodyText()).not.toContain("We couldn't load this list");
    expect(bodyText()).toContain("PO-7788");
  });

  it("still blocks when the list failed with nothing cached", async () => {
    getDeadLetterOrders.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage({ health: HEALTH });

    await waitFor(() => expect(bodyText()).toContain("We couldn't load this list"), RETRY_WAIT);
    // And never the sentence that means "we checked and there are none".
    expect(bodyText()).not.toContain("No orders awaiting operator review.");
  });
});

describe("ops health — a healthy poll shows no banner at all (anti-vacuity control)", () => {
  it("renders the dashboard with neither the banner nor the blocking card", async () => {
    // Same seeded cache, same mount, one difference: the refetch resolves. If the
    // banner appeared here too it would be page furniture rather than a signal.
    renderPage({ health: HEALTH, deadLetter: DEAD_LETTER });

    await waitFor(() => expect(getOpsHealth).toHaveBeenCalled());
    await waitFor(() => expect(bodyText()).toContain("PO-7788"));
    expect(bodyText()).not.toContain("We couldn't refresh system status");
    expect(bodyText()).not.toContain("We couldn't refresh this list");
    expect(bodyText()).not.toContain("We couldn't load system status");
  });
});
