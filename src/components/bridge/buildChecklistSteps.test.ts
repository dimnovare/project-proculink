import { describe, it, expect } from "vitest";
import { buildChecklistSteps } from "./buildChecklistSteps";
import type { OnboardingStatus } from "@/types/procurement";

const NOUN = "supplier";

/** Fully-extended payload with every flag false (e.g. a sample-only org). */
function allFalseExtended(): OnboardingStatus {
  return {
    hasSupplier: false,
    hasUpload: false,
    hasResolvedMapping: false,
    hasDelivery: false,
    hasCatalog: false,
    hasItemMappings: false,
    hasDeliveryConfig: false,
    hasTestFired: false,
    firstSupplierId: null,
    firstActionableOrderId: null,
    supplierCount: 0,
    orderCount: 0,
    deliveredCount: 0,
    hasSampleOrder: true,
    sampleOrderId: "ord-sample-1",
  };
}

describe("buildChecklistSteps", () => {
  // ── Degradation: legacy backend payload (extended fields absent) ──────────
  it("omits catalog + delivery steps when their signals are absent (legacy payload)", () => {
    const model = buildChecklistSteps(
      { hasSupplier: true, hasUpload: false, hasResolvedMapping: false, hasDelivery: false },
      NOUN,
    );
    expect(model.steps.map((s) => s.id)).toEqual(["supplier", "upload", "resolve", "send"]);
    expect(model.totalSteps).toBe(4);
    // Never fabricates "not done" for unknown signals.
    expect(model.steps.find((s) => s.id === "catalog")).toBeUndefined();
    expect(model.steps.find((s) => s.id === "delivery")).toBeUndefined();
  });

  it("treats a legacy all-true payload as complete (4/4)", () => {
    const model = buildChecklistSteps(
      { hasSupplier: true, hasUpload: true, hasResolvedMapping: true, hasDelivery: true },
      NOUN,
    );
    expect(model.complete).toBe(true);
    expect(model.totalDone).toBe(4);
    expect(model.activeStep).toBeNull();
  });

  it("includes only the extended steps whose signals are present (partial deploy)", () => {
    const model = buildChecklistSteps(
      {
        hasSupplier: true,
        hasUpload: false,
        hasResolvedMapping: false,
        hasDelivery: false,
        hasDeliveryConfig: false, // delivery signals present…
        // …catalog signals absent
      },
      NOUN,
    );
    expect(model.steps.map((s) => s.id)).toEqual([
      "supplier",
      "upload",
      "resolve",
      "delivery",
      "send",
    ]);
  });

  // ── Sample-only org: extended payload, everything honestly false ─────────
  it("shows 0/6 with only step 1 unlocked for a sample-only org", () => {
    const model = buildChecklistSteps(allFalseExtended(), NOUN);
    expect(model.totalSteps).toBe(6);
    expect(model.totalDone).toBe(0);
    expect(model.complete).toBe(false);
    expect(model.activeStep?.id).toBe("supplier");
    const lockedIds = model.steps.filter((s) => s.locked).map((s) => s.id);
    expect(lockedIds).toEqual(["catalog", "upload", "resolve", "delivery", "send"]);
  });

  // ── Lock-gating ───────────────────────────────────────────────────────────
  it("unlocks resolve only after upload, and send only after 3+4+5-config", () => {
    const base = {
      ...allFalseExtended(),
      hasSupplier: true,
      hasCatalog: true,
      hasUpload: true,
    };
    let model = buildChecklistSteps(base, NOUN);
    expect(model.steps.find((s) => s.id === "resolve")?.locked).toBe(false);
    expect(model.steps.find((s) => s.id === "send")?.locked).toBe(true); // no resolve, no config

    model = buildChecklistSteps({ ...base, hasResolvedMapping: true }, NOUN);
    expect(model.steps.find((s) => s.id === "send")?.locked).toBe(true); // still no delivery config

    model = buildChecklistSteps(
      { ...base, hasResolvedMapping: true, hasDeliveryConfig: true },
      NOUN,
    );
    expect(model.steps.find((s) => s.id === "send")?.locked).toBe(false);
  });

  // ── Step 5 intermediate state ─────────────────────────────────────────────
  it("marks delivery intermediate when config is saved but not test-fired", () => {
    const model = buildChecklistSteps(
      {
        ...allFalseExtended(),
        hasSupplier: true,
        hasCatalog: true,
        hasUpload: true,
        hasResolvedMapping: true,
        hasDeliveryConfig: true,
        hasTestFired: false,
      },
      NOUN,
    );
    const delivery = model.steps.find((s) => s.id === "delivery")!;
    expect(delivery.done).toBe(false);
    expect(delivery.intermediate).toBe(true);
    expect(delivery.cta).toBe("Send a test");
    expect(delivery.description).toContain("Configured — send a test to finish");
    // It is the active step (first not-done, not-locked).
    expect(model.activeStep?.id).toBe("delivery");
    expect(model.totalDone).toBe(4);
  });

  it("completes step 5 on test-fire success", () => {
    const model = buildChecklistSteps(
      {
        ...allFalseExtended(),
        hasSupplier: true,
        hasCatalog: true,
        hasUpload: true,
        hasResolvedMapping: true,
        hasDeliveryConfig: true,
        hasTestFired: true,
      },
      NOUN,
    );
    const delivery = model.steps.find((s) => s.id === "delivery")!;
    expect(delivery.done).toBe(true);
    expect(delivery.intermediate).toBe(false);
    expect(model.activeStep?.id).toBe("send");
    expect(model.totalDone).toBe(5);
  });

  it("counts a real delivery as step 5 done even without a test-fire (no nagging)", () => {
    const model = buildChecklistSteps(
      {
        ...allFalseExtended(),
        hasSupplier: true,
        hasCatalog: true,
        hasUpload: true,
        hasResolvedMapping: true,
        hasDeliveryConfig: true,
        hasTestFired: false,
        hasDelivery: true,
      },
      NOUN,
    );
    const delivery = model.steps.find((s) => s.id === "delivery")!;
    expect(delivery.done).toBe(true);
    expect(delivery.intermediate).toBe(false);
    expect(model.complete).toBe(true);
    expect(model.totalDone).toBe(6);
    expect(model.activeStep).toBeNull();
  });

  // ── Deep links ────────────────────────────────────────────────────────────
  it("uses server ids for deep links when present", () => {
    const model = buildChecklistSteps(
      {
        ...allFalseExtended(),
        hasSupplier: true,
        firstSupplierId: "sup-123",
        firstActionableOrderId: "ord-456",
      },
      NOUN,
    );
    expect(model.steps.find((s) => s.id === "catalog")?.href).toBe(
      "/library/suppliers/sup-123?tab=catalog",
    );
    expect(model.steps.find((s) => s.id === "delivery")?.href).toBe(
      "/library/suppliers/sup-123?tab=delivery",
    );
    expect(model.steps.find((s) => s.id === "resolve")?.href).toBe("/inbox/ord-456");
    expect(model.steps.find((s) => s.id === "send")?.href).toBe("/inbox/ord-456");
  });

  it("falls back to list routes when ids are missing", () => {
    const model = buildChecklistSteps(allFalseExtended(), NOUN);
    expect(model.steps.find((s) => s.id === "catalog")?.href).toBe("/library/suppliers");
    expect(model.steps.find((s) => s.id === "delivery")?.href).toBe("/library/suppliers");
    expect(model.steps.find((s) => s.id === "resolve")?.href).toBe("/inbox");
    expect(model.steps.find((s) => s.id === "send")?.href).toBe("/inbox");
  });

  // ── Direction-aware copy ──────────────────────────────────────────────────
  it("uses the direction-aware noun in step copy", () => {
    const model = buildChecklistSteps(allFalseExtended(), "customer");
    expect(model.steps[0].label).toBe("Add your first customer");
    expect(model.steps.find((s) => s.id === "catalog")?.label).toBe(
      "Add the customer's item codes",
    );
  });
});
