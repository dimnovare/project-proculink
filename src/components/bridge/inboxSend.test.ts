import { describe, expect, it } from "vitest";
import {
  REDELIVERABLE_STATUSES,
  formatBulkSendResult,
  isRedeliverable,
  shouldShowBulkBar,
} from "./inboxSend";

describe("isRedeliverable — mirrors backend OrderStatusMachine.RedeliverableFrom", () => {
  it("accepts exactly the two redeliverable raw statuses", () => {
    expect(isRedeliverable("ready_to_deliver")).toBe(true);
    expect(isRedeliverable("delivery_failed")).toBe(true);
  });

  it("rejects every other raw backend status", () => {
    const notRedeliverable = [
      "pending_parse",
      "parsing",
      "pending_review",
      "ready",
      "transforming",
      "delivered",
      "failed", // parse failure — NOT redeliverable
      "transform_failed",
      "delivery_dead_letter", // rescued by ops requeue, not redeliver
      "delivery_held", // billing hold — released by settling billing, not by /redeliver (400)
      "rejected_by_supplier",
      "",
    ];
    for (const s of notRedeliverable) {
      expect(isRedeliverable(s), `expected '${s}' to be non-redeliverable`).toBe(false);
    }
  });

  it("exposes the canonical set with exactly two members", () => {
    expect([...REDELIVERABLE_STATUSES].sort()).toEqual([
      "delivery_failed",
      "ready_to_deliver",
    ]);
  });
});

describe("formatBulkSendResult — failure summary names POs and reasons", () => {
  it("formats an all-success result (singular and plural)", () => {
    expect(formatBulkSendResult(1, [])).toEqual({ ok: true, text: "1 order sent" });
    expect(formatBulkSendResult(3, [])).toEqual({ ok: true, text: "3 orders sent" });
  });

  it("lists the failing PO number and reason on a partial failure", () => {
    const r = formatBulkSendResult(2, [
      { po: "PO-2026-008412", reason: "Order is not in a deliverable state" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.text).toBe(
      "2 sent · 1 failed: PO-2026-008412 — Order is not in a deliverable state",
    );
  });

  it("uses 'Couldn't send' phrasing when nothing was sent", () => {
    const r = formatBulkSendResult(0, [
      { po: "PO-1", reason: "status pending_review" },
      { po: "PO-2", reason: "status parsing" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.text).toBe(
      "Couldn't send 2 orders: PO-1 — status pending_review; PO-2 — status parsing",
    );
  });

  it("caps the list at three failures and counts the rest", () => {
    const failures = ["PO-1", "PO-2", "PO-3", "PO-4", "PO-5"].map((po) => ({
      po,
      reason: "rejected",
    }));
    const r = formatBulkSendResult(1, failures);
    expect(r.text).toBe(
      "1 sent · 5 failed: PO-1 — rejected; PO-2 — rejected; PO-3 — rejected and 2 more",
    );
  });

  it("clips an overlong reason and falls back when the reason is blank", () => {
    const long = "x".repeat(200);
    const clipped = formatBulkSendResult(0, [{ po: "PO-9", reason: long }]);
    expect(clipped.text.length).toBeLessThan(140);
    expect(clipped.text).toContain("…");

    const blank = formatBulkSendResult(0, [{ po: "PO-9", reason: "   " }]);
    expect(blank.text).toBe("Couldn't send 1 order: PO-9 — no reason given");
  });
});

describe("shouldShowBulkBar — keeps the success confirmation reachable", () => {
  it("shows while rows are selected (no result yet)", () => {
    expect(shouldShowBulkBar(2, null)).toBe(true);
  });

  it("stays mounted on FULL success after selection is cleared", () => {
    // The actual bug: a full success clears rowSelection (selectedCount → 0)
    // AND sets a result. Gating on selectedCount alone unmounted the bar with
    // its "N orders sent" line, so the send read as a silent no-op.
    const result = formatBulkSendResult(3, []);
    expect(shouldShowBulkBar(0, result)).toBe(true);
  });

  it("stays mounted on partial failure (failed rows stay selected, result shown)", () => {
    const result = formatBulkSendResult(1, [{ po: "PO-1", reason: "rejected" }]);
    expect(shouldShowBulkBar(1, result)).toBe(true);
  });

  it("hides only when there is no selection AND no result to dismiss", () => {
    expect(shouldShowBulkBar(0, null)).toBe(false);
  });
});
