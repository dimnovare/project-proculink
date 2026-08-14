import { describe, expect, it } from "vitest";
import {
  REDELIVERABLE_STATUSES,
  bulkSendConfirmCopy,
  bulkSendNeedsDuplicateConfirm,
  formatBulkSendResult,
  isRedeliverable,
  shouldShowBulkBar,
} from "./inboxSend";

describe("isRedeliverable — mirrors backend OrderStatusMachine.RedeliverableFrom", () => {
  it("accepts exactly the three redeliverable raw statuses", () => {
    expect(isRedeliverable("ready_to_deliver")).toBe(true);
    expect(isRedeliverable("delivery_failed")).toBe(true);
    // A parked order IS redeliverable — unlike delivery_held, which stays excluded.
    expect(isRedeliverable("delivery_unconfirmed")).toBe(true);
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

  it("exposes the canonical set with exactly three members", () => {
    // Mirrors backend OrderStatusMachine.RedeliverableFrom. A parked order IS redeliverable —
    // the park exists so a HUMAN can choose to re-send, accepting a duplicate risk the automatic
    // retry must never take for them. (delivery_held stays excluded: see inboxSend.ts.)
    expect([...REDELIVERABLE_STATUSES].sort()).toEqual(
      ["delivery_failed", "delivery_unconfirmed", "ready_to_deliver"],
    );
  });
});

describe("bulkSendNeedsDuplicateConfirm — which bulk sends must warn first", () => {
  const rawById = new Map<string, string>([
    ["a", "ready_to_deliver"],
    ["b", "delivery_failed"],
    ["c", "delivery_unconfirmed"],
  ]);

  it("warns when the selection contains a parked order", () => {
    expect(bulkSendNeedsDuplicateConfirm(["c"], rawById)).toBe(true);
    expect(bulkSendNeedsDuplicateConfirm(["a", "b", "c"], rawById)).toBe(true);
  });

  it("does NOT warn for a selection of only non-parked rows (flow unchanged)", () => {
    expect(bulkSendNeedsDuplicateConfirm(["a"], rawById)).toBe(false);
    expect(bulkSendNeedsDuplicateConfirm(["a", "b"], rawById)).toBe(false);
    expect(bulkSendNeedsDuplicateConfirm([], rawById)).toBe(false);
  });

  it("warns when a selected row's status is unknown — it cannot be ruled out", () => {
    // Paging does NOT clear the selection, so a row selected on page 1 is still
    // selected on page 2 while its status is no longer loaded. We cannot prove such
    // a row isn't parked, so it gets the warning: an unnecessary dialog costs a
    // click, a missed one costs the supplier a duplicate PO.
    expect(bulkSendNeedsDuplicateConfirm(["gone"], rawById)).toBe(true);
    expect(bulkSendNeedsDuplicateConfirm(["a", "gone"], rawById)).toBe(true);
  });
});

describe("bulkSendConfirmCopy — states the risk and the count", () => {
  it("mirrors the workshop panel's pinned wording for a single order", () => {
    const copy = bulkSendConfirmCopy(1);
    expect(copy.title).toBe("Send this order again?");
    expect(copy.description).toBe(
      "If the supplier already received this order, sending again may give them a duplicate.",
    );
    expect(copy.confirmLabel).toBe("Send again");
  });

  it("carries the count and the duplicate risk for a multi-order send", () => {
    const copy = bulkSendConfirmCopy(3);
    expect(copy.title).toBe("Send 3 orders again?");
    expect(copy.description).toBe(
      "If the supplier already received them, sending again may give them duplicates.",
    );
  });

  it("never claims the supplier HAS received the order — only that it may have", () => {
    for (const n of [1, 2, 9]) {
      const { description } = bulkSendConfirmCopy(n);
      expect(description).toMatch(/^If the supplier already received/);
      expect(description).toMatch(/may give them/);
      expect(description).not.toMatch(/will give them/);
    }
  });
});

describe("formatBulkSendResult — failure summary names POs and reasons", () => {
  it("formats an all-success result (singular and plural)", () => {
    // "queued", not "sent": /redeliver answers 202 and nothing has reached a
    // supplier yet. See inboxBulkSendClaim.test.tsx for the rendered proof.
    expect(formatBulkSendResult(1, [])).toEqual({
      ok: true,
      text: "1 order queued to send — its status updates as it goes",
    });
    expect(formatBulkSendResult(3, [])).toEqual({
      ok: true,
      text: "3 orders queued to send — each row's status updates as it goes",
    });
  });

  it("lists the failing PO number and reason on a partial failure", () => {
    const r = formatBulkSendResult(2, [
      { po: "PO-2026-008412", reason: "Order is not in a deliverable state" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.text).toBe(
      "2 queued · 1 failed: PO-2026-008412 — Order is not in a deliverable state",
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
      "1 queued · 5 failed: PO-1 — rejected; PO-2 — rejected; PO-3 — rejected and 2 more",
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
    // its "N orders queued to send" line, so the send read as a silent no-op.
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
