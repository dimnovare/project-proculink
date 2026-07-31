import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";

// WP-24 — /operations/log?orderId=.
//
// A failed order's panel offers "See every attempt", linking to
// `/operations/log?orderId={orderId}`. This page never called useSearchParams, so the
// param was dropped on the floor: the operator asked about ONE order and got the whole
// workspace's delivery log, with nothing on screen admitting the question had been
// ignored. `grep -rn 'get("orderId")' src/` returned zero hits.
//
// The second half of the defect is honesty about scope. GET /api/audit takes `page` and
// `pageSize` only — there is no per-order filter to ask the server for — so the match is
// made over a page we already hold, and the page has to say how far that window reached
// instead of implying it has seen the order's whole history.

const getAuditLog = vi.fn();

// Read at call time, not at factory time (vi.mock is hoisted above this `let`).
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

const BASE: Omit<AuditLogEntry, "id" | "orderId" | "poNumber" | "action" | "message"> = {
  ts: "2026-07-30T09:15:00.000Z",
  buyerName: "Heinrich Industries",
  supplierName: "Nordmark",
  format: "PDF",
  actorType: "system",
  actorName: "System",
  actorInitials: "SY",
  payload: null,
};

/** Two orders, three entries — enough that a dropped filter is visible as extra rows. */
const EVENTS: AuditLogEntry[] = [
  { ...BASE, id: "e1", orderId: "ord-aaa", poNumber: "PO-4711", action: "delivery_failed", message: "Delivery failed · PO-4711" },
  { ...BASE, id: "e2", orderId: "ord-aaa", poNumber: "PO-4711", action: "created", message: "Order created · PO-4711" },
  { ...BASE, id: "e3", orderId: "ord-bbb", poNumber: "PO-9002", action: "delivered", message: "Delivered · PO-9002" },
];

function page(events: AuditLogEntry[], total = events.length) {
  return { events, total, page: 1, pageSize: 200 };
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

describe("CrossingsLog — ?orderId= filters the log to that order", () => {
  it("shows only that order's entries, says it is filtered, and offers the way back", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS));
    searchParams = new URLSearchParams("orderId=ord-aaa");

    renderLog();

    // Both of ord-aaa's entries survive…
    expect(await screen.findAllByText("PO-4711")).toHaveLength(2);
    // …and the other order's row is gone. Before this it was on screen.
    expect(screen.queryByText("PO-9002")).toBeNull();

    // The view must SAY it is narrowed — a short list with no explanation reads as a
    // quiet workspace.
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Showing one order/i);
    expect(notice).toHaveTextContent("PO-4711");

    // …and offer a way back to everything.
    expect(screen.getByRole("link", { name: /Show all deliveries/i })).toHaveAttribute(
      "href",
      "/operations/log",
    );
  });

  it("says how far it searched when the log is longer than the page it holds", async () => {
    // 3 entries loaded out of 640 in the workspace: the filter is over ONE page, so the
    // page must not imply it has seen every attempt for this order.
    getAuditLog.mockResolvedValue(page(EVENTS, 640));
    searchParams = new URLSearchParams("orderId=ord-aaa");

    renderLog();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/3 most recent entries/i);
    expect(notice).toHaveTextContent(/older than those is not listed/i);
  });

  it("does not claim a partial window when the whole log is loaded", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS));
    searchParams = new URLSearchParams("orderId=ord-aaa");

    renderLog();

    const notice = await screen.findByRole("status");
    expect(notice.textContent ?? "").not.toMatch(/most recent entries/i);
  });

  it("asks the API for the widest page it will serve when an order filter is active", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS));
    searchParams = new URLSearchParams("orderId=ord-aaa");

    renderLog();

    await screen.findAllByText("PO-4711");
    // AuditController clamps pageSize to 1..200. Filtering over the default 50 would
    // drop a busy workspace's older entries for no reason.
    expect(getAuditLog).toHaveBeenCalledWith(1, 200);
  });
});

describe("CrossingsLog — an orderId that matches nothing", () => {
  it("says nothing is recorded for THIS order, not that the log is empty", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS));
    searchParams = new URLSearchParams("orderId=ord-zzz");

    renderLog();

    expect(await screen.findByText(/Nothing recorded for this order/i)).toBeInTheDocument();
    // The generic filter-empty copy would read as "your workspace is quiet", which is
    // the opposite of what the operator asked.
    expect(screen.queryByText("No matching events")).toBeNull();
    expect(screen.queryByText("PO-4711")).toBeNull();
    // The way out is still on screen — a dead end here strands the operator.
    expect(screen.getByRole("link", { name: /Show all deliveries/i })).toBeInTheDocument();
  });

  it("admits older entries may exist when it only searched one page", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS, 640));
    searchParams = new URLSearchParams("orderId=ord-zzz");

    renderLog();

    expect(await screen.findByText(/Older entries for it may still exist/i)).toBeInTheDocument();
  });
});

describe("CrossingsLog — no ?orderId= renders the unfiltered log unchanged", () => {
  it("keeps every order's entries and shows no filter notice", async () => {
    getAuditLog.mockResolvedValue(page(EVENTS));

    renderLog();

    expect(await screen.findAllByText("PO-4711")).toHaveLength(2);
    expect(screen.getByText("PO-9002")).toBeInTheDocument();

    expect(screen.queryByText(/Showing one order/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /Show all deliveries/i })).toBeNull();
    // …and it still asks for the original 50-entry page.
    expect(getAuditLog).toHaveBeenCalledWith(1, 50);
  });
});
