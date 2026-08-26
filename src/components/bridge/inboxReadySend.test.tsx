import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-29 — the product's economic premise, made visible and actionable.
//
// A recurring PO that auto-resolves every line lands on `ready`: every check
// passed, no output built, nothing sent — the human's turn. At 478b809 it had no
// filter chip and no action. It was the most valuable state and the least
// actionable row.
//
// The action posts to /orders/{id}/transform, NOT /redeliver. That is not an
// implementation detail, it is the WP-24 D2 discipline: a control may only be
// offered where the backend's guard set accepts it. `ready` is in
// OrderStatusMachine.TransformableFrom; it is NOT in RedeliverableFrom, so a bulk
// "Send selected" over `ready` rows could only ever 400.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/inbox",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));

let direction: "outbound" | "inbound" = "outbound";
vi.mock("@/hooks/useOrderDirection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOrderDirection")>(
    "@/hooks/useOrderDirection",
  );
  return {
    ...actual,
    useOrderDirection: () => ({ direction, labels: actual.partyLabels(direction) }),
  };
});

import { InboxView, FILTER_CHIPS } from "./InboxView";
import {
  isBulkSelectable,
  isRedeliverable,
  isRowSendable,
  rowSendStartedCopy,
  ROW_SEND_CTA,
  ROW_SEND_CTA_PROGRESS,
} from "./inboxSend";
import { partyLabels } from "@/hooks/useOrderDirection";

/**
 * The row-send button for ONE viewport.
 *
 * Both row variants mount in jsdom — the desktop table is `hidden lg:block` and the mobile
 * list is `lg:hidden`, and neither media query is evaluated — so a bare
 * `findAllByRole("button", { name })` is satisfied by the mobile card ALONE. A mutation
 * that damaged only the desktop button therefore stayed green, and the four "a ready row
 * carries a primary send action" tests were all really testing one button twice. Every
 * assertion below names its viewport.
 */
function rowSendButton(viewport: "desktop" | "mobile", po: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(
    `button[data-row-send="${viewport}"][aria-label$="${po}"]`,
  );
  if (!el) throw new Error(`no ${viewport} row-send button for ${po}`);
  return el;
}

const VIEWPORTS = ["desktop", "mobile"] as const;

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-8800${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "ready",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({
    byStatus: { ready: 5, ready_to_deliver: 7, pending_review: 9, delivered: 11 },
    total: 32,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrders).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  direction = "outbound";
  searchParams = new URLSearchParams();
  replace.mockReset();
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("`ready` is a first-class filter chip", () => {
  it("the chip exists, and it filters the `ready` status server-side", async () => {
    const chip = FILTER_CHIPS.find((c) => c.label === "Ready to send");
    expect(chip, "FILTER_CHIPS must carry a Ready to send chip").toBeDefined();
    expect(chip!.api).toBe("ready");
    expect(chip!.summaryKeys).toEqual(["ready"]);

    const { container } = await renderInbox([order({ status: "ready" })]);
    // Queried through the count tag, not by accessible name: the mobile card is itself
    // a <button> whose name contains its "Ready to send" status badge.
    const button = await waitFor(() =>
      container.querySelector('[data-count-label="Ready to send"]')!.closest("button")!,
    );
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(String(replace.mock.calls[0][0])).toContain("status=ready");
  });

  it("its count is `ready`, distinct from the Queued to send chip's `ready_to_deliver`", async () => {
    const { container } = await renderInbox([order({ status: "ready" })]);
    await waitFor(() =>
      expect(container.querySelector('[data-count-label="Ready to send"]')).toBeTruthy(),
    );
    const read = (label: string) =>
      Number(
        container.querySelector<HTMLElement>(`[data-count-label="${label}"]`)?.dataset.countValue,
      );
    expect(read("Ready to send")).toBe(5);
    expect(read("Queued to send")).toBe(7);
  });
});

describe("a `ready` row carries a primary send action", () => {
  it("renders the button on BOTH viewports, each naming its own order", async () => {
    await renderInbox([order({ status: "ready", poNumber: "PO-READY-1" })]);
    await screen.findAllByText("PO-READY-1");
    for (const viewport of VIEWPORTS) {
      const btn = rowSendButton(viewport, "PO-READY-1");
      // The PO must be in the ACCESSIBLE NAME of each button independently. Asserting it
      // once across both let a mutation that dropped the PO from only the desktop button
      // pass, because the mobile card's name still satisfied the query.
      expect(btn.getAttribute("aria-label"), viewport).toBe(`${ROW_SEND_CTA} — PO-READY-1`);
    }
  });

  // WHY textContent AND NOT the accessible name. The name comes from `aria-label`, a
  // DIFFERENT expression from the visible child. Hardcoding a party noun in the visible
  // text of both buttons, leaving the aria-labels alone, passed every test in the repo:
  // an inbound org would SEE "Send to supplier" while a screen reader announced something
  // else. Read what is on screen.
  for (const dir of ["outbound", "inbound"] as const) {
    it(`the visible text is the row action's own copy, not a party CTA (${dir})`, async () => {
      direction = dir;
      await renderInbox([order({ status: "ready", poNumber: "PO-READY-2" })]);
      await screen.findAllByText("PO-READY-2");
      for (const viewport of VIEWPORTS) {
        const btn = rowSendButton(viewport, "PO-READY-2");
        expect(btn.textContent, `${dir}/${viewport}`).toBe(ROW_SEND_CTA);
        // The row action posts /transform and stops; partyLabels().primaryCta names the
        // ORDER-DETAIL control, which transforms AND delivers. One label, one action.
        expect(btn.textContent, `${dir}/${viewport}`).not.toBe(partyLabels(dir).primaryCta);
        // No party noun at all — so it cannot silently delete the inbound mode the way a
        // hardcoded "supplier" would.
        expect(btn.textContent).not.toMatch(/supplier|buyer|customer/i);
      }
    });
  }

  it("reads the same in both directions — it names an action, not a party", async () => {
    direction = "outbound";
    await renderInbox([order({ status: "ready", poNumber: "PO-DIR" })]);
    await screen.findAllByText("PO-DIR");
    const outbound = rowSendButton("desktop", "PO-DIR").textContent;
    cleanup();
    direction = "inbound";
    await renderInbox([order({ status: "ready", poNumber: "PO-DIR" })]);
    await screen.findAllByText("PO-DIR");
    expect(rowSendButton("desktop", "PO-DIR").textContent).toBe(outbound);
    // …while partyLabels itself still distinguishes them, so this is not a regression in
    // the direction support — it is a control that does not need it.
    expect(partyLabels("inbound").primaryCta).not.toBe(partyLabels("outbound").primaryCta);
  });

  for (const viewport of VIEWPORTS) {
    it(`clicking the ${viewport} button posts /transform immediately — no dialog, never /redeliver`, async () => {
      api.transformOrder.mockResolvedValue({});
      await renderInbox([order({ id: "ord-ready", status: "ready", poNumber: "PO-READY-3" })]);
      await screen.findAllByText("PO-READY-3");
      await act(async () => { fireEvent.click(rowSendButton(viewport, "PO-READY-3")); });

      await waitFor(() => expect(api.transformOrder).toHaveBeenCalledWith("ord-ready"));
      // Nothing has been built or sent yet, so there is no duplicate risk and no dialog.
      // The confirm WP-24 added is for delivery_unconfirmed; reusing it here would train
      // the operator to click past the one that matters.
      expect(screen.queryByRole("dialog")).toBeNull();
      // /redeliver 400s on `ready` — offering it here is exactly WP-24's D2 defect.
      expect(api.redeliverOrder).not.toHaveBeenCalled();
      // The notice is the packet's most-argued sentence. Assert IT, not the PO number,
      // which also appears in the row and made the old assertion pass for the wrong reason.
      const notice = await screen.findByRole("status");
      expect(notice.textContent).toContain(rowSendStartedCopy("PO-READY-3"));
    });
  }

  it("shows the in-flight copy on the row being sent", async () => {
    let release!: () => void;
    api.transformOrder.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({}); }),
    );
    await renderInbox([order({ id: "ord-slow", status: "ready", poNumber: "PO-SLOW" })]);
    await screen.findAllByText("PO-SLOW");
    await act(async () => { fireEvent.click(rowSendButton("desktop", "PO-SLOW")); });
    await waitFor(() =>
      expect(rowSendButton("desktop", "PO-SLOW").textContent).toBe(ROW_SEND_CTA_PROGRESS),
    );
    await act(async () => { release(); });
  });

  it("a failure names the order and the backend's reason, and leaves the button usable", async () => {
    // The shape the endpoint really answers with: OrdersController conflicts a
    // non-transformable status with 409 + `{ "error": "<sentence>" }`, and api-client
    // unwraps it (see api-client.transformError.test.ts). A clean hand-written sentence
    // here would prove the reason survives without ever exercising that shape.
    api.transformOrder.mockRejectedValue(
      new Error("Order is not ready to transform (status 'delivering'). Wait for the send to finish."),
    );
    await renderInbox([order({ id: "ord-bad", status: "ready", poNumber: "PO-READY-4" })]);
    await screen.findAllByText("PO-READY-4");
    const button = rowSendButton("desktop", "PO-READY-4");
    await act(async () => { fireEvent.click(button); });

    const notice = await screen.findByText(/Couldn.t start PO-READY-4/i);
    expect(notice.textContent).toMatch(/not ready to transform/i);
    // No braces, no quoted key — the operator reads a sentence, not a response body.
    expect(notice.textContent).not.toMatch(/[{}]|"error"/);
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("does not offer the action on a status the transform endpoint would refuse", async () => {
    await renderInbox([
      order({ status: "ready_to_deliver", poNumber: "PO-QUEUED" }),
      order({ status: "pending_review", poNumber: "PO-REVIEW", unresolvedCount: 3 }),
      order({ status: "delivered", poNumber: "PO-DONE" }),
    ]);
    await screen.findAllByText("PO-QUEUED");
    for (const po of ["PO-QUEUED", "PO-REVIEW", "PO-DONE"]) {
      for (const viewport of VIEWPORTS) {
        expect(
          document.querySelector(`button[data-row-send="${viewport}"][aria-label$="${po}"]`),
          `${po} must not offer the row send on ${viewport}`,
        ).toBeNull();
      }
    }
  });

  // Spec §6.2's "defence in depth", which did not ship in the first pass. `ready` should
  // imply zero unresolved lines and the endpoint 422s regardless — but a button whose only
  // possible outcome is a 422 should not be offered, on either viewport.
  it("suppresses the action on a `ready` row the backend still reports issues for", async () => {
    await renderInbox([
      order({ status: "ready", poNumber: "PO-CLEAN", unresolvedCount: 0 }),
      order({ status: "ready", poNumber: "PO-DIRTY", unresolvedCount: 2 }),
    ]);
    await screen.findAllByText("PO-DIRTY");
    for (const viewport of VIEWPORTS) {
      expect(rowSendButton(viewport, "PO-CLEAN")).toBeTruthy();
      expect(
        document.querySelector(`button[data-row-send="${viewport}"][aria-label$="PO-DIRTY"]`),
        `an unresolved ready row must not offer the send on ${viewport}`,
      ).toBeNull();
    }
  });
});

describe("the row send's own copy", () => {
  // The packet's most-argued sentence had no test at all: replacing it with
  // `Sent ${po} to the supplier.` — the exact claim the design refuses to make — stayed
  // green across the whole repo, because the nearest assertion matched the PO number in
  // the ROW rather than in the notice.
  it("names the order and refuses to claim it was sent", () => {
    const line = rowSendStartedCopy("PO-2026-0341");
    expect(line).toContain("PO-2026-0341");
    // POST /transform enqueues TransformOrderJob, which enqueues DeliverOrderJob
    // "respecting the AutoDeliver flag" — and Organisation.AutoDeliver defaults to FALSE.
    // For the ordinary org the order rests in `ready_to_deliver` and waits for a person,
    // so any past-tense claim of delivery is a lie for that org.
    expect(line).not.toMatch(/\bsent\b/i);
    expect(line).not.toMatch(/\bdelivered\b/i);
    // It must still say what DID happen, or it is just vague.
    expect(line).toMatch(/output/i);
  });

  it("the button, the in-flight copy and the notice describe the same action", () => {
    // "Prepare output" → the `transforming` badge "Preparing output" → "building the
    // output". Three surfaces, one verb. A rename that breaks the chain fails here.
    expect(ROW_SEND_CTA).toMatch(/output/i);
    expect(ROW_SEND_CTA_PROGRESS).toMatch(/^Prepar/i);
    expect(rowSendStartedCopy("PO-1")).toMatch(/output/i);
    // And it is nobody's party CTA — see inboxSend.ts ROW_SEND_CTA.
    for (const dir of ["outbound", "inbound"] as const) {
      expect(ROW_SEND_CTA).not.toBe(partyLabels(dir).primaryCta);
    }
  });
});

describe("the two send paths stay disjoint", () => {
  it("`ready` is row-sendable but NOT bulk-selectable — different endpoint, different guard set", () => {
    expect(isRowSendable("ready")).toBe(true);
    // BULK_SELECTABLE_STATUSES mirrors the backend's ClaimableForRetryFrom and drives
    // POST /redeliver, whose RedeliverableFrom does not contain `ready`.
    expect(isBulkSelectable("ready")).toBe(false);
    expect(isRedeliverable("ready")).toBe(false);
  });

  it("nothing is in both sets", () => {
    const all = [
      "pending_parse", "parsing", "unrouted", "pending_review", "ready", "transforming",
      "ready_to_deliver", "delivering", "delivered", "delivery_held",
      "delivery_unconfirmed", "failed", "transform_failed", "delivery_failed",
      "delivery_dead_letter", "rejected_by_supplier",
    ];
    for (const s of all) {
      expect(isRowSendable(s) && isBulkSelectable(s), `${s} is in both send paths`).toBe(false);
    }
  });

  it("isRedeliverable still mirrors the backend byte for byte (WP-24 refused to narrow it)", () => {
    // Pinned here because this packet adds a SECOND send path, and the cheap way to
    // wire it would have been to widen this set. It is documented and tested as an
    // exact mirror of OrderStatusMachine.RedeliverableFrom — leave it alone.
    for (const s of ["ready_to_deliver", "delivery_failed", "delivery_unconfirmed"]) {
      expect(isRedeliverable(s), s).toBe(true);
    }
    for (const s of ["ready", "delivery_held", "transform_failed", "delivery_dead_letter"]) {
      expect(isRedeliverable(s), s).toBe(false);
    }
  });
});
