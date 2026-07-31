import { describe, it, expect } from "vitest";
import { sendBarLabel } from "./sendBarLabel";
import { partyLabels } from "@/hooks/useOrderDirection";

/**
 * WP-28 / DB-4 — "the send bar: what it says when the order is clean, when it is
 * blocked, and when the user has an override available."
 *
 * Pure so the copy is pinned without mounting the whole workshop, and so BOTH
 * surfaces that render a send control (the desktop header bar and MobileTriage)
 * read from ONE table. Two send bars with two hand-written label ladders is how
 * "Send · 2 blockers" and "Fix 2 to send" ended up meaning the same thing in
 * different words.
 *
 * Party nouns come from partyLabels(direction) — never hardcoded. Hardcoding
 * "supplier" silently deletes the inbound mode (founder decision 2026-07-30).
 */

const OUT = partyLabels("outbound");
const IN = partyLabels("inbound");

describe("sendBarLabel", () => {
  it("clean order → the plain primary CTA", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier");
    expect(r.ariaLabel).toBe("Send to supplier");
    expect(r.enabled).toBe(true);
  });

  it("blocked → the CTA carries the count and the button is disabled", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 2, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier · 2 to fix");
    expect(r.ariaLabel).toBe("Send to supplier — 2 issues to fix first");
    expect(r.enabled).toBe(false);
  });

  it("blocked by ONE issue uses singular grammar", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 1, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier · 1 to fix");
    expect(r.ariaLabel).toBe("Send to supplier — 1 issue to fix first");
  });

  it("server-truth exceptions block even when the client issue list is empty", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 3, warningIssues: 0, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier · 3 to fix");
    expect(r.enabled).toBe(false);
  });

  it("override available (warnings only) → sendable, and says so", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 1, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier · 1 optional");
    expect(r.ariaLabel).toBe("Send to supplier — 1 optional issue you can send past");
    expect(r.enabled).toBe(true);
  });

  it("a blocking issue outranks a warning — never offers the override while blocked", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 2, exceptionCount: 0, warningIssues: 4, crossed: false, sendState: "idle" });
    expect(r.label).toBe("Send to supplier · 2 to fix");
    expect(r.enabled).toBe(false);
  });

  it("in-flight states are their own labels and never enabled", () => {
    expect(sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "transforming" }).label)
      .toBe("Preparing the file…");
    expect(sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "delivering" }).label)
      .toBe("Sending…");
    expect(sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "delivering" }).enabled)
      .toBe(false);
  });

  it("delivered → the done label, disabled", () => {
    const r = sendBarLabel({ labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: true, sendState: "idle" });
    expect(r.label).toBe("Sent to supplier");
    expect(r.enabled).toBe(false);
  });

  it("a live problem status disables the control and renames it to what the order needs", () => {
    const r = sendBarLabel({
      labels: OUT, blockingIssues: 0, exceptionCount: 0, warningIssues: 0,
      crossed: false, sendState: "idle", problemAction: "Choose the supplier",
    });
    expect(r.enabled).toBe(false);
    expect(r.ariaLabel).toBe("Choose the supplier");
  });

  it("INBOUND: every label routes through partyLabels — no hardcoded supplier noun", () => {
    expect(sendBarLabel({ labels: IN, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "idle" }).label)
      .toBe("Confirm order");
    expect(sendBarLabel({ labels: IN, blockingIssues: 2, exceptionCount: 0, warningIssues: 0, crossed: false, sendState: "idle" }).label)
      .toBe("Confirm order · 2 to fix");
    expect(sendBarLabel({ labels: IN, blockingIssues: 0, exceptionCount: 0, warningIssues: 1, crossed: false, sendState: "idle" }).label)
      .toBe("Confirm order · 1 optional");
    expect(sendBarLabel({ labels: IN, blockingIssues: 0, exceptionCount: 0, warningIssues: 0, crossed: true, sendState: "idle" }).label)
      .toBe("Order confirmed");
    // The one that matters: no outbound noun leaks into an inbound workspace.
    for (const args of [
      { blockingIssues: 0, warningIssues: 0 },
      { blockingIssues: 2, warningIssues: 0 },
      { blockingIssues: 0, warningIssues: 1 },
    ]) {
      const r = sendBarLabel({ labels: IN, exceptionCount: 0, crossed: false, sendState: "idle", ...args });
      expect(r.label.toLowerCase()).not.toContain("supplier");
      expect(r.ariaLabel.toLowerCase()).not.toContain("supplier");
    }
  });
});
