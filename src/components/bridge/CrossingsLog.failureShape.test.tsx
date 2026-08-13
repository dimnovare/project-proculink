import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";
import { auditActionFact } from "@/lib/auditActionManifest";
import { auditActionRemedy, REACH_SENTENCE } from "@/lib/auditActionRemedy";

// ─────────────────────────────────────────────────────────────────────────────
// The four real failure shapes must not look the same when expanded.
//
// A stopped order fails in four ways an operator has to tell apart, because each
// one wants a different person to do a different thing:
//
//   1. the supplier's system refused it, in their own words   (MarkedRejected)
//   2. we could not get a usable answer from the channel      (DeliveryDeadLettered)
//   3. our own rules refused it and it never left the building (AcceptanceBlocked)
//   4. nothing is wrong with it — sending is on hold          (DeliveryHeldForBilling)
//
// Before this change all four rendered one grey card with the same three buttons
// and, at best, a sentence of backend prose. Whether the supplier had ever seen
// the order — the first thing you need, because it decides whether to phone them —
// was not stated anywhere.
//
// These assertions are about the RENDERED DOM, not about the remedy table: a
// correct table the component never reads is the exact shape of the defect that
// FE 144 was written to fix (there WAS a `delivery_failed` map entry; nothing
// reached it). The table's own consistency is covered by auditActionRemedy.test.ts.
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

/** The four shapes, by the action that produces each. */
const SHAPES = [
  { action: "MarkedRejected", reach: "at_supplier" },
  { action: "DeliveryDeadLettered", reach: "unknown_send" },
  { action: "AcceptanceBlocked", reach: "before_send" },
  { action: "DeliveryHeldForBilling", reach: "paused" },
] as const;

function entryFor(action: string, i: number): AuditLogEntry {
  const key = auditActionFact(action)?.reasonKeys[0];
  return {
    id: `e-${i}`,
    ts: "2026-08-06T09:15:00.000Z",
    orderId: `ord-${i}`,
    poNumber: `PO-${1000 + i}`,
    buyerName: "Heinrich Industries",
    supplierName: "Nordmark",
    format: "PDF",
    action,
    actorType: "system",
    actorName: "System",
    message: "Event",
    payload: key ? { [key]: "Something the backend said." } : null,
  } as AuditLogEntry;
}

function renderLog(rows: AuditLogEntry[]) {
  getAuditLog.mockResolvedValue({ events: rows, total: rows.length, page: 1, pageSize: 50 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

/** Expands the row for `po` and returns its remedy block, or null. */
async function expandAndReadRemedy(po: string): Promise<HTMLElement | null> {
  const cells = await screen.findAllByText(po);
  const button = cells.map((n) => n.closest("button")).find((b): b is HTMLButtonElement => b !== null);
  if (!button) throw new Error(`no expandable row for ${po}`);
  fireEvent.click(button);
  const blocks = screen.queryAllByTestId("audit-remedy");
  return blocks[0] ?? null;
}

beforeEach(() => {
  getAuditLog.mockReset();
  searchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("expanded failure row — the four shapes are distinguishable", () => {
  it("floor: all four actions are known, and their reaches are four DIFFERENT values", () => {
    // Without this the per-shape assertions could all be comparing the same
    // string to itself, or running over actions the manifest no longer knows.
    const reaches = new Set<string>();
    for (const { action, reach } of SHAPES) {
      expect(auditActionFact(action), `${action} is not in the manifest`).not.toBeNull();
      const remedy = auditActionRemedy(action);
      expect(remedy, `${action} has no remedy`).not.toBeNull();
      expect(remedy!.reach).toBe(reach);
      reaches.add(remedy!.reach);
    }
    expect(reaches.size).toBe(4);
  });

  it.each(SHAPES.map((s) => [s.action, s.reach] as const))(
    "%s states how far the order got and what to do now",
    async (action, reach) => {
      renderLog([entryFor(action, 0)]);
      const block = await expandAndReadRemedy("PO-1000");

      expect(block, `${action} rendered no remedy block`).not.toBeNull();
      expect(block!.getAttribute("data-failure-reach")).toBe(reach);
      expect(block!).toHaveTextContent(REACH_SENTENCE[reach]);
      expect(block!).toHaveTextContent(auditActionRemedy(action)!.next);
    },
  );

  it("no two shapes render the same text", async () => {
    const seen = new Map<string, string>();
    for (const { action } of SHAPES) {
      renderLog([entryFor(action, 0)]);
      const block = await expandAndReadRemedy("PO-1000");
      const text = (block?.textContent ?? "").trim();
      expect(text.length).toBeGreaterThan(40);
      for (const [otherAction, otherText] of seen) {
        expect(text, `${action} reads identically to ${otherAction}`).not.toBe(otherText);
      }
      seen.set(action, text);
      cleanup();
    }
    expect(seen.size).toBe(SHAPES.length);
  });

  it("says the supplier never saw an order our own rules refused", async () => {
    // The single most consequential distinction on this screen: it decides
    // whether the operator picks up the phone to the supplier.
    renderLog([entryFor("AcceptanceBlocked", 0)]);
    const block = await expandAndReadRemedy("PO-1000");
    expect(block).toHaveTextContent(/never reached the supplier/i);
  });

  it("does not claim a supplier refusal when we never got an answer", async () => {
    renderLog([entryFor("DeliveryDeadLettered", 0)]);
    const block = await expandAndReadRemedy("PO-1000");
    expect(block).toHaveTextContent(/couldn't confirm/i);
    expect(block!.textContent ?? "").not.toMatch(/their system refused/i);
  });
});

describe("expanded row — a success gains no remedy", () => {
  it("renders no remedy block for a delivered event", async () => {
    renderLog([entryFor("Transformed", 0)]);
    const cells = await screen.findAllByText("PO-1000");
    const button = cells.map((n) => n.closest("button")).find((b): b is HTMLButtonElement => b !== null);
    fireEvent.click(button!);
    // Floor: the row really did expand — something from the panel is on screen.
    expect(screen.queryAllByRole("button", { name: /view order/i }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("audit-remedy")).toBeNull();
  });

  it("renders no remedy block for an action this build cannot name", async () => {
    renderLog([entryFor("DeliveryVaporised", 0)]);
    const cells = await screen.findAllByText("PO-1000");
    const button = cells.map((n) => n.closest("button")).find((b): b is HTMLButtonElement => b !== null);
    fireEvent.click(button!);
    expect(screen.queryAllByRole("button", { name: /view order/i }).length).toBeGreaterThan(0);
    // An unrecognised action must not acquire an invented next step — the same
    // rule the unknown-event tone path holds for colour.
    expect(screen.queryByTestId("audit-remedy")).toBeNull();
  });
});
