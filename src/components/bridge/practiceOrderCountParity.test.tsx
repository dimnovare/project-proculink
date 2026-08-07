import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { GetOrdersParams, OrderStatus, OrderSummary, OrdersPage, OrdersSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// v2 audit P0-5 — a count and the rows beside it must describe one population.
//
//   "A first-run org that takes the promoted sample path sees 'Received 0' next to a
//    card reading '1 orders received' and a table listing that order."
//
// Practice orders are excluded from every metered number — billing, the overage actually
// invoiced, every plan gate — and the orders LIST was the one metered-facing query that
// counted them anyway (dimnovare/ProcuLink#173). The API now exposes the split rather than
// hiding the row: `sampleCount` on the list envelope, `sampleTotal` on the summary,
// `isSample` per row. This file is the frontend half's guard.
//
// ── WHY IT IS NOT orderCountParity.test.tsx ──────────────────────────────────
//
// That file was GREEN with this defect live on both screens, and not by accident. It is
// one of this repo's one-directional guards: it was written for "Ready to send" summing
// two statuses, it is NAMED for that, and its corpus is counts printed against a KNOWN SET
// OF WORDS. Both numbers in the audit sentence are outside that corpus — "1 orders
// received" and "1 order" name no contract label at all — so it swept right past them.
//
// The property here is different in kind: not "does this label print the right number",
// but "does this number describe the same set as the rows printed beside it". So the
// corpus is different too — `collectCountedNouns` reads the OTHER grammar a screen uses
// for a count (a figure followed by the noun), which needs no label and no attribute.
//
// ── THE DIRECTION THE NEXT INSTANCE COMES FROM ───────────────────────────────
//
// Not this defect again — a THIRD screen printing a FOURTH count, in a file that does not
// exist yet, which no rendering test can reach. That is covered statically by
// `src/test/orderPopulationIsDeclared.test.ts`: no production module may read
// `.totalCount` / `.sampleCount` / `.sampleTotal` for itself, so a new surface has to go
// through `pagePopulation` / `summaryPopulation` or fail the build.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  getSuppliers: vi.fn(),
  getDashboardTopology: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getDashboardTopology: (...a: unknown[]) => api.getDashboardTopology(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  practiceDeliveryKnown: () => null,
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  ONBOARDING_STATUS_QUERY_KEY: ["onboarding-status"],
  useOnboardingStatus: () => ({
    data: { hasSupplier: true, hasUpload: true, hasResolvedMapping: true, hasDelivery: true },
  }),
  invalidateOnboardingStatus: vi.fn(),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent to supplier",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));

import { InboxView } from "./InboxView";
import { BridgeDashboard } from "./BridgeDashboard";
import { ORDER_COUNT_CONTRACT, statusesForLabel } from "./orderCountContract";
import { collectPrintedCounts, collectCountedNouns, readableText } from "@/test/printedCounts";

const CONTRACT_LABELS = ORDER_COUNT_CONTRACT.map((r) => r.label);

// ── The corpora ──────────────────────────────────────────────────────────────
//
// Composition VARIES between them on purpose. A guard whose fixture is always "0 real,
// 1 practice" can be satisfied by a screen that prints 0 unconditionally, and a test that
// hard-codes 1 and 1 passes the day someone changes both to 0. Every expectation below is
// derived from what was seeded, so no literal can hold the property up on its own.

interface Seed {
  po: string;
  status: OrderStatus;
  practice: boolean;
}

/** The audit sentence, verbatim: the org's only order is the promoted practice one. */
const FIRST_RUN: Seed[] = [{ po: "PO-PRACTICE-1", status: "pending_review", practice: true }];

/** Real work alongside a practice order, so the assertions are not all comparisons to 0. */
const MIXED: Seed[] = [
  { po: "PO-REAL-1", status: "pending_review", practice: false },
  { po: "PO-REAL-2", status: "delivered", practice: false },
  { po: "PO-PRACTICE-2", status: "delivered", practice: true },
];

const CORPORA: Array<{ name: string; seeds: Seed[] }> = [
  { name: "only a practice order", seeds: FIRST_RUN },
  { name: "two real orders and a practice one", seeds: MIXED },
];

let seq = 0;
function toSummaryRow(seed: Seed): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: seed.po,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: seed.status,
    lineCount: 4,
    unresolvedCount: seed.status === "pending_review" ? 2 : 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    isSample: seed.practice,
  };
}

const meteredSeeds = (seeds: Seed[]) => seeds.filter((s) => !s.practice);
const practiceSeeds = (seeds: Seed[]) => seeds.filter((s) => s.practice);

/** What the API returns for a corpus — the same split #173 put on the wire. */
function apiShape(seeds: Seed[]): { page: OrdersPage; delivered: OrdersPage; summary: OrdersSummary } {
  const items = seeds.map(toSummaryRow);
  const page: OrdersPage = {
    items,
    totalCount: seeds.length,
    sampleCount: practiceSeeds(seeds).length,
    page: 1,
    pageSize: 100,
  };
  const deliveredSeeds = seeds.filter((s) => s.status === "delivered");
  const delivered: OrdersPage = {
    items: deliveredSeeds.map(toSummaryRow),
    totalCount: deliveredSeeds.length,
    sampleCount: practiceSeeds(deliveredSeeds).length,
    page: 1,
    pageSize: 1,
  };
  const byStatus: Partial<Record<OrderStatus, number>> = {};
  for (const s of meteredSeeds(seeds)) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const summary: OrdersSummary = {
    byStatus,
    total: meteredSeeds(seeds).length,
    sampleTotal: practiceSeeds(seeds).length,
  };
  return { page, delivered, summary };
}

function mockApi(seeds: Seed[]) {
  const { page, delivered, summary } = apiShape(seeds);
  api.getOrders.mockImplementation((params?: GetOrdersParams) =>
    Promise.resolve(params?.status === "delivered" ? delivered : page),
  );
  api.getOrdersSummary.mockResolvedValue(summary);
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderInbox(seeds: Seed[]) {
  mockApi(seeds);
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() => expect(readableText(container)).toContain(seeds[0].po));
  return container;
}

async function renderDashboard(seeds: Seed[]) {
  mockApi(seeds);
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelectorAll("[data-count-label]").length).toBeGreaterThan(0),
  );
  await waitFor(() => expect(readableText(container)).toContain("orders received"));
  return container;
}

const SURFACES = [
  { name: "inbox", render: renderInbox },
  { name: "dashboard", render: renderDashboard },
];

/**
 * The text of the row that prints `po`, widened to the tightest block that still mentions
 * no OTHER order. Four levels is the cap: a row badge sits one or two elements from the PO
 * on every surface here, and an unbounded walk would reach the whole table and report one
 * row's badge as every row's.
 */
function rowTextsFor(container: HTMLElement, po: string, otherPos: readonly string[]): string[] {
  const hits = Array.from(container.querySelectorAll("*")).filter((el) => readableText(el).includes(po));
  const minimal = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
  return minimal.map((el) => {
    let best: Element = el;
    let widened = 0;
    for (let a = el.parentElement; a && widened < 4; a = a.parentElement, widened += 1) {
      if (otherPos.some((p) => readableText(a!).includes(p))) break;
      best = a;
    }
    return readableText(best);
  });
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  seq = 0;
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("a count and the rows beside it describe one population", () => {
  for (const { name: corpus, seeds } of CORPORA) {
    for (const { name: surface, render: renderSurface } of SURFACES) {
      it(`${surface}, ${corpus}: every contract count equals the real orders it claims to count`, async () => {
        const container = await renderSurface(seeds);
        const printed = collectPrintedCounts(container, CONTRACT_LABELS);

        // ANTI-VACUITY. A sweep over nothing satisfies every assertion below for free,
        // and that has happened in this repo. Floors are well under what the screens
        // really print, so a broken render fails HERE rather than passing silently.
        expect(printed.length, `${surface} printed no contract counts at all`).toBeGreaterThanOrEqual(
          surface === "inbox" ? 7 : 12,
        );

        for (const occurrence of printed) {
          const statuses = statusesForLabel(occurrence.label);
          const expected = meteredSeeds(seeds).filter(
            (s) => statuses === null || (statuses ?? []).includes(s.status),
          ).length;
          expect(
            occurrence.value,
            `${surface} printed "${occurrence.label}" as ${occurrence.value}, but ${expected} ` +
              `real order(s) in this corpus carry that label. Practice orders are excluded ` +
              `from every metered number — see orderCountContract.ts.\n  ${occurrence.where}`,
          ).toBe(expected);
        }
      });

      it(`${surface}, ${corpus}: every "<n> orders" it prints is either the real total or a named practice count`, async () => {
        const container = await renderSurface(seeds);
        const nouns = collectCountedNouns(container);

        // ANTI-VACUITY, and the reason this test exists at all: the two numbers in the
        // audit sentence carry no contract label, so if this corpus is empty the guard is
        // reading a different screen from the one that was wrong.
        expect(
          nouns.length,
          `${surface} printed no "<n> order(s)" phrase — this sweep is dead and the ` +
            `audit's own two numbers ("1 orders received", "1 order") would be invisible`,
        ).toBeGreaterThanOrEqual(2);
        expect(
          nouns.some((n) => !n.practice),
          `${surface} printed no plain order count`,
        ).toBe(true);
        expect(
          nouns.some((n) => n.practice),
          `${surface} never NAMES its practice orders — a metered count that silently ` +
            `excludes a visible row is the defect, not the fix`,
        ).toBe(true);

        const real = meteredSeeds(seeds).length;
        const practice = practiceSeeds(seeds).length;
        for (const noun of nouns) {
          const context =
            `${surface} printed "${noun.phrase}", but this corpus holds ${real} real and ` +
            `${practice} practice order(s).\n  ${noun.where}`;
          if (noun.practice) {
            expect(noun.value, context).toBe(practice);
          } else if (noun.total) {
            // The strict half: a claim about everything must be the metered population,
            // because that is the population the counts beside it describe.
            expect(noun.value, `${context}\n  A total claim must equal the real orders.`).toBe(real);
          } else {
            // A subset claim ("1 order needs your attention") counts its own rows and is
            // checked only for not claiming more orders than exist.
            expect(noun.value, `${context}\n  A subset cannot exceed the whole.`).toBeLessThanOrEqual(real + practice);
          }
        }
      });

      it(`${surface}, ${corpus}: any row it does render says whether it is practice`, async () => {
        // Every row the surface lists must be identifiable, both ways: a practice row says
        // so, and a real row is not mislabelled. The dashboard is not a full list — its
        // sections are filtered ("Needs you") and capped ("In transit") — so this asserts
        // over the rows each surface CHOOSES to render. The inbox, which IS the list, has
        // the stronger anti-hiding assertion of its own below.
        const container = await renderSurface(seeds);
        const allPos = seeds.map((s) => s.po);
        let rowsSeen = 0;

        for (const seed of seeds) {
          const rows = rowTextsFor(container, seed.po, allPos.filter((p) => p !== seed.po));
          rowsSeen += rows.length;
          for (const row of rows) {
            if (seed.practice) {
              expect(row, `${surface}: the row for practice order ${seed.po} does not say so`).toContain("Practice");
            } else {
              expect(row, `${surface}: real order ${seed.po} is badged as practice`).not.toContain("Practice");
            }
          }
        }
        // ANTI-VACUITY: a surface that rendered no rows at all would satisfy every
        // assertion in this loop without executing one of them.
        expect(rowsSeen, `${surface} rendered no order rows for this corpus`).toBeGreaterThanOrEqual(1);
      });
    }
  }
});

describe("the fix is a label, not a filter", () => {
  for (const { name: corpus, seeds } of CORPORA) {
    it(`${corpus}: the inbox still lists every practice order`, async () => {
      // Making the numbers agree by HIDING the row would pass every count assertion above
      // and break the product: a first-run user is routed to a practice order to rehearse
      // review, and `OnboardingStatus.sampleOrderId` exists to route them back to it.
      const text = readableText(await renderInbox(seeds));
      for (const seed of seeds) {
        expect(text, `the inbox stopped listing ${seed.po}`).toContain(seed.po);
      }
      expect(practiceSeeds(seeds).length, "this corpus holds no practice order to hide").toBeGreaterThanOrEqual(1);
    });
  }
});

describe("the two screens agree with each other, not just with themselves", () => {
  for (const { name: corpus, seeds } of CORPORA) {
    it(`${corpus}: the inbox and the dashboard print the same real and practice totals`, async () => {
      // The audit sentence is a CROSS-SCREEN contradiction — "Received 0" on one screen,
      // "1 orders received" on the other. Each screen being internally consistent is not
      // the property; the two agreeing is.
      const inboxNouns = collectCountedNouns(await renderInbox(seeds));
      cleanup();
      const dashboardNouns = collectCountedNouns(await renderDashboard(seeds));

      const distinct = (ns: ReturnType<typeof collectCountedNouns>, practice: boolean) =>
        [...new Set(ns.filter((n) => n.practice === practice && n.total).map((n) => n.value))];

      for (const practice of [false, true]) {
        const inbox = distinct(inboxNouns, practice);
        const dashboard = distinct(dashboardNouns, practice);
        const kind = practice ? "practice" : "real";
        expect(inbox.length, `the inbox printed no ${kind} order count`).toBe(1);
        expect(dashboard.length, `the dashboard printed no ${kind} order count`).toBe(1);
        expect(
          dashboard,
          `the inbox says ${inbox} ${kind} order(s) and the dashboard says ${dashboard}`,
        ).toEqual(inbox);
      }
    });
  }
});

describe("the phrase sweep reads what a person reads", () => {
  const fixture = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  it("tells a total claim from a subset claim", () => {
    // The dashboard prints BOTH: "2 orders received" is the window's whole intake, and
    // "1 order needs your attention" is the "Needs you" list's own row count. Reading the
    // second as a total made this guard fail on correct copy the first time it ran.
    const totals = collectCountedNouns(fixture(`<span>3 orders</span>`));
    expect(totals.map((n) => n.total)).toEqual([true]);
    expect(collectCountedNouns(fixture(`<span>3 orders received · last 30 days</span>`)).map((n) => n.total)).toEqual([true]);
    expect(collectCountedNouns(fixture(`<span>3 orders · 1 selected</span>`)).map((n) => n.total)).toEqual([true]);
    expect(collectCountedNouns(fixture(`<span>1 order needs your attention</span>`)).map((n) => n.total)).toEqual([false]);
    // The export note describes the FILE's rows, not a metered total, and says so.
    expect(
      collectCountedNouns(fixture(`<span>Export contains the most recent 100 of 250 orders in this window</span>`))
        .map((n) => [n.value, n.total]),
    ).toEqual([[250, false]]);
  });

  it("joins text across element boundaries, which textContent does not", () => {
    // THE EXACT MARKUP OF THE AUDIT'S SECOND NUMBER: a figure in one span, the noun in
    // the next. `textContent` concatenates them to "1orders received · last 30 days" —
    // JSX strips the whitespace-only line between the tags — so a regex over textContent
    // matches nothing and the whole sweep is dead code that passes.
    const card = fixture(`<div><span>1</span><span>orders received · last 30 days</span></div>`);
    expect(card.textContent).toBe("1orders received · last 30 days");
    expect(readableText(card)).toBe("1 orders received · last 30 days");
    expect(collectCountedNouns(card).map((n) => [n.value, n.practice])).toEqual([[1, false]]);
  });

  it("reads the inbox footer, which carries no contract label at all", () => {
    const footer = fixture(`<span>0 orders · 1 practice order, not counted toward your plan</span>`);
    expect(collectCountedNouns(footer).map((n) => [n.value, n.practice])).toEqual([
      [0, false],
      [1, true],
    ]);
    // …and the label sweep — the corpus that was green while this defect shipped — sees
    // nothing here. That equality is the blind spot, stated as an assertion.
    expect(collectPrintedCounts(footer, CONTRACT_LABELS)).toEqual([]);
  });

  it("credits the tightest line, not every wrapper around it", () => {
    const nested = fixture(`<section><div><span>3</span><span>orders</span></div><p>PO-1 · 4 lines</p></section>`);
    expect(collectCountedNouns(nested).map((n) => n.value)).toEqual([3]);
  });

  it("does not read '3+ completed orders' as a count of three", () => {
    // The dashboard's real copy when there is too little data to compute a rate.
    const hint = fixture(`<span>Auto-processed rate needs 3+ completed orders</span>`);
    expect(collectCountedNouns(hint)).toEqual([]);
  });

  it("separates the practice claim from the metered one", () => {
    expect(collectCountedNouns(fixture(`<span>2 practice orders</span>`))).toEqual([
      expect.objectContaining({ value: 2, practice: true }),
    ]);
    expect(collectCountedNouns(fixture(`<span>2 orders</span>`))).toEqual([
      expect.objectContaining({ value: 2, practice: false }),
    ]);
  });

  it("reads thousands separators, and ignores figures that are not counts", () => {
    expect(collectCountedNouns(fixture(`<span>1,204 orders</span>`)).map((n) => n.value)).toEqual([1204]);
    expect(collectCountedNouns(fixture(`<span>€1,200 · 4 lines · 62%</span>`))).toEqual([]);
  });
});
