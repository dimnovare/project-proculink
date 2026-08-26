import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderException } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// A FAILED REFRESH ERASED THE ISSUE LIST THE OPERATOR WAS ALREADY READING.
//
// THE DEFECT, VERBATIM:
//
//     const { data, isLoading, isError, refetch, isFetching } = useQuery({…});
//     …
//     {!showLoading && isError && ( … "Couldn't load issues" … )}
//     {!showLoading && !isError && exceptions.length === 0 && ( … all clear … )}
//     {!showLoading && !isError && exceptions.length > 0 && ( … the rows … )}
//
// `isError` is true for two different situations that this page treated as one:
// the FIRST load failed and there is nothing to show, and a LATER refresh failed
// over rows that are already fetched and on screen. In the second, hitting Sync —
// or any background refetch — replaced a live list of blocked orders with
// "Couldn't load issues. The issues service didn't respond." The rows were never
// gone. Only the refresh was.
//
// THE SPLIT. `data === undefined` → the blocking panel, unchanged. Error WITH
// data → the rows stay, and a banner says how old they are. A failed refresh
// downgrades confidence; it does not erase knowledge.
//
// The error-with-data state is produced the way it happens live: seed the cache
// with a real answer stamped past the 15s staleTime, mount, let the refetch it
// triggers reject.
// ─────────────────────────────────────────────────────────────────────────────

const getExceptions = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/operations/exceptions",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getExceptions: (...args: unknown[]) => getExceptions(...args),
    resolveException: vi.fn(),
    ignoreException: vi.fn(),
  };
});

import ExceptionsPage from "./page";

const BLOCKER_MESSAGE = "Supplier item code is missing on line 3";

const ROWS: OrderException[] = [
  {
    id: "exc-1",
    orderId: "ord-1",
    lineId: null,
    severity: "error",
    message: BLOCKER_MESSAGE,
    createdAt: "2026-08-15T08:00:00.000Z",
    resolvedAt: null,
    stage: "validate",
    code: "unresolved_mapping",
    state: "open",
  },
];

/** Two minutes: past the 15s staleTime, and a round number for the age sentence. */
const TWO_MINUTES_MS = 120_000;

/**
 * The query sets `retry: 1` with an 800ms `retryDelay`, which beats the test
 * client's `retry: false`, so a rejection is not terminal inside Testing
 * Library's default 1000ms wait. `--testTimeout=60000` bounds the TEST, not the
 * wait, so the wait has to be widened explicitly.
 */
const RETRY_WAIT = { timeout: 15_000 } as const;

/** The tab the page opens on, and therefore the cache key it reads. */
const INITIAL_KEY = ["exceptions", "all"] as const;

function renderPage(seed?: OrderException[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(INITIAL_KEY, seed, { updatedAt: Date.now() - TWO_MINUTES_MS });
  render(
    <QueryClientProvider client={client}>
      <ExceptionsPage />
    </QueryClientProvider>,
  );
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  getExceptions.mockReset();
  getExceptions.mockResolvedValue(ROWS);
});

afterEach(cleanup);

describe("issues list — the staging really produces error-with-data (anti-vacuity floor)", () => {
  it("the seed is older than the staleTime, so mounting really does refetch", async () => {
    // A fresh seed would never refetch, `isError` would never become true, and
    // every assertion below would be exercising the happy path.
    getExceptions.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage(ROWS);

    await waitFor(() => expect(getExceptions).toHaveBeenCalled());
    expect(TWO_MINUTES_MS).toBeGreaterThan(15_000);
  });
});

describe("issues list — a failed refresh keeps the rows", () => {
  it("does not replace an already-loaded list with the blocking panel", async () => {
    getExceptions.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage(ROWS);

    await waitFor(() => expect(bodyText()).toContain("We couldn't refresh this list"), RETRY_WAIT);
    expect(bodyText()).not.toContain("Couldn't load issues");
    // jsdom renders both breakpoint trees (no Tailwind), so the row copy appears
    // in the mobile card AND the desktop table. Presence is the claim here.
    expect(screen.getAllByText(BLOCKER_MESSAGE).length).toBeGreaterThan(0);
  });

  it("says how old the rows are", async () => {
    getExceptions.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage(ROWS);

    const banner = await screen.findByRole("alert", {}, RETRY_WAIT);
    expect(within(banner).getByText(/from 2 minutes ago/i)).toBeTruthy();
  });

  it("never leaves a cached EMPTY list reading as an unqualified all-clear", async () => {
    // The nastiest shape: the cache legitimately holds zero rows, the refresh
    // fails, and the page would otherwise print "No issues — all clear" with
    // nothing saying that the verdict is two minutes old and could not be
    // re-checked. The empty state may stay; the banner must be over it.
    getExceptions.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage([]);

    await waitFor(() => expect(bodyText()).toContain("We couldn't refresh this list"), RETRY_WAIT);
    expect(bodyText()).toContain("No issues — all clear");
    expect(await screen.findByRole("alert", {}, RETRY_WAIT)).toBeTruthy();
  });

  it("still shows the blocking panel when the FIRST load fails", async () => {
    // The half that must survive: with nothing cached the page really does know
    // nothing, and the panel — with its Retry — is the honest answer.
    getExceptions.mockRejectedValue(new Error("503 Service Unavailable"));
    renderPage();

    await waitFor(() => expect(bodyText()).toContain("Couldn't load issues"), RETRY_WAIT);
    expect(bodyText()).not.toContain("We couldn't refresh this list");
    expect(bodyText()).not.toContain("No issues — all clear");
  });
});

describe("issues list — a healthy refresh shows no banner (anti-vacuity control)", () => {
  it("renders the rows with neither the banner nor the blocking panel", async () => {
    // Same seed, same mount, one difference: the refetch resolves.
    renderPage(ROWS);

    await waitFor(() => expect(getExceptions).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(BLOCKER_MESSAGE).length).toBeGreaterThan(0));
    expect(bodyText()).not.toContain("We couldn't refresh this list");
    expect(bodyText()).not.toContain("Couldn't load issues");
  });
});
