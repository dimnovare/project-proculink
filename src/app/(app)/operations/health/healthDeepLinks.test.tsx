import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// Link integrity over /operations/health.
//
// Every tile on this page is a promise: "N orders are in this state — click to
// see them". Two ways that promise broke:
//   D3  the inbox never read ?status=, so EVERY tile landed on an unfiltered
//       inbox. Nine links, none of them a filter.
//   §7  four separate tiles pointed at ?status=failed, a filter three times
//       wider than their own label.
//
// These tests are deliberately a table-vs-table comparison against the inbox's
// own accepted-filter set, so a tile can never again link somewhere the inbox
// cannot honour.
// ─────────────────────────────────────────────────────────────────────────────

const health = vi.hoisted(() => ({
  parsingStuck: 1,
  deliveringStuck: 2,
  transformFailed: 3,
  deliveryFailed: 4,
  deliveryDeadLetter: 5,
  rejectedBySupplier: 6,
  failed: 7,
  slaBreached: 8,
  openExceptions: 9,
  pendingRouting: 10,
  deliveryUnconfirmed: 11,
  deliveryHeld: 0,
  pendingReview: 0,
  stuckThresholdMinutes: 15,
  totalProblemOrders: 40,
  workerHealthy: true,
  activeWorkers: 1,
  lastWorkerHeartbeatUtc: "2026-07-30T09:00:00Z",
  secondsSinceWorkerHeartbeat: 12,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/operations/health",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", () => ({
  getOpsHealth: vi.fn().mockResolvedValue(health),
  getDeadLetterOrders: vi.fn().mockResolvedValue([]),
  requeueDelivery: vi.fn(),
}));

import OperationsHealthPage from "./page";
import { TILES } from "./healthTiles";
import { isAllClear } from "./opsHealthState";
import { INBOX_FILTERABLE_STATUSES, resolveInboxStatusParam } from "@/components/bridge/inboxUrlFilter";

afterEach(cleanup);
beforeEach(() => {
  health.workerHealthy = true;
});

function statusParamOf(href: string): string | null {
  const q = href.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get("status");
}

/**
 * The two tiles that legitimately carry no `?status=`, declared by key.
 *
 * `slaBreached` has no server-side age filter — it sorts oldest-first and says so in its
 * helper line. `openExceptions` does not go to the inbox at all.
 *
 * Declaring them is the point: the loop below used to say `if (status === null) continue`,
 * so a tile that LOST its `?status=` — landing the operator on an unfiltered inbox, which
 * is defect D3 exactly — exited the guard instead of failing it.
 */
const TILES_WITHOUT_STATUS_FILTER = ["slaBreached", "openExceptions"];

describe("every tile links somewhere the inbox can actually filter (D3)", () => {
  test("each ?status= value is one the inbox accepts", () => {
    let checked = 0;
    for (const tile of TILES) {
      const status = statusParamOf(tile.href);

      if (TILES_WITHOUT_STATUS_FILTER.includes(tile.key)) {
        expect(
          status,
          `tile "${tile.label}" is declared filter-less but now carries ?status=${status} — ` +
            "drop it from TILES_WITHOUT_STATUS_FILTER",
        ).toBeNull();
        continue;
      }

      expect(
        status,
        `tile "${tile.label}" links ${tile.href} — it lost its ?status=, so it lands on an ` +
          "unfiltered inbox (D3)",
      ).not.toBeNull();
      expect(
        INBOX_FILTERABLE_STATUSES.has(status!),
        `tile "${tile.label}" links ?status=${status}, which the inbox does not filter`,
      ).toBe(true);
      expect(resolveInboxStatusParam(status!).known).toBe(true);
      checked++;
    }
    // A green run here must mean the assertions above actually ran.
    expect(checked, "no tile was checked at all").toBe(
      TILES.length - TILES_WITHOUT_STATUS_FILTER.length,
    );
    expect(checked).toBeGreaterThan(0);
  });

  test("a tile that cannot be filtered says so with a real target, not a bare /inbox", () => {
    for (const tile of TILES) {
      // "/inbox" with no query is the D3 signature: a filter link that filters nothing.
      expect(tile.href, `tile "${tile.label}"`).not.toBe("/inbox");
    }
  });

  test("no two problem tiles share a href — a label must match its filter's width", () => {
    const seen = new Map<string, string>();
    for (const tile of TILES) {
      const prev = seen.get(tile.href);
      expect(prev, `"${tile.label}" and "${prev}" both link ${tile.href}`).toBeUndefined();
      seen.set(tile.href, tile.label);
    }
  });

  test("the five collapsed failure statuses each get their own exact link", () => {
    const byKey = new Map(TILES.map((t) => [t.key, t.href]));
    expect(byKey.get("transformFailed")).toBe("/inbox?status=transform_failed");
    expect(byKey.get("deliveryFailed")).toBe("/inbox?status=delivery_failed");
    expect(byKey.get("deliveryDeadLetter")).toBe("/inbox?status=delivery_dead_letter");
    expect(byKey.get("rejectedBySupplier")).toBe("/inbox?status=rejected_by_supplier");
    expect(byKey.get("deliveringStuck")).toBe("/inbox?status=delivering");
    expect(byKey.get("parsingStuck")).toBe("/inbox?status=parsing");
    expect(byKey.get("deliveryUnconfirmed")).toBe("/inbox?status=delivery_unconfirmed");
  });

  test("the one self-serve problem state has a tile at all (D6)", () => {
    const tile = TILES.find((t) => t.key === "pendingRouting");
    expect(tile, "no 'Needs supplier' tile — the state whose fix is 100% self-serve").toBeTruthy();
    expect(tile!.href).toBe("/inbox?status=unrouted");
  });
});

describe("the rendered page carries those hrefs", () => {
  it("renders one anchor per tile with the deep link", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OperationsHealthPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Out of retries")).toBeTruthy());

    const rendered = new Set(
      Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? ""),
    );
    for (const tile of TILES) {
      expect(rendered.has(tile.href), `tile "${tile.label}" (${tile.href}) not rendered`).toBe(true);
    }
  });
});

describe("a dead Worker cannot read as 'All clear' (D7)", () => {
  test("isAllClear is false while order processing is paused", () => {
    const clear = {
      ...health,
      parsingStuck: 0, deliveringStuck: 0, transformFailed: 0, deliveryFailed: 0,
      deliveryDeadLetter: 0, rejectedBySupplier: 0, failed: 0, slaBreached: 0,
      openExceptions: 0, pendingRouting: 0, deliveryUnconfirmed: 0, deliveryHeld: 0,
      totalProblemOrders: 0,
    };
    expect(isAllClear({ ...clear, workerHealthy: true })).toBe(true);
    expect(isAllClear({ ...clear, workerHealthy: false })).toBe(false);
  });
});
