import { describe, it, expect } from "vitest";
import { isPlanGateError, planGateMessage, planGateUpgradeUrl } from "./planGate";

// WP-11 defect #1, frontend half.
//
// The backend used to answer gated endpoints with `*_requires_integration` even where the
// gate's real minimum was Growth. It now derives the plan segment from the gate table, so the
// same endpoints answer `*_requires_growth` — and any future re-tier changes the string again.
//
// The frontend matched those codes by hardcoded substring. `CatalogSourceEditor` tested for
// the literal `catalog_sync_requires_integration`, so the corrected code would have fallen
// straight through to the raw-error branch and shown a customer a snake_case token instead of
// a sentence. These tests pin the plan-AGNOSTIC matcher that replaces it: it must keep working
// no matter which plan the backend names.

describe("isPlanGateError", () => {
  it("matches the corrected codes", () => {
    expect(isPlanGateError("catalog_sync_requires_growth")).toBe(true);
    expect(isPlanGateError("sftp_ingestion_requires_growth")).toBe(true);
    expect(isPlanGateError("s3_ingestion_requires_growth")).toBe(true);
    expect(isPlanGateError("email_ingestion_requires_growth")).toBe(true);
    expect(isPlanGateError("webhook_delivery_requires_growth")).toBe(true);
    expect(isPlanGateError("erp_delivery_requires_enterprise")).toBe(true);
    expect(isPlanGateError("cxml_output_requires_operations")).toBe(true);
    expect(isPlanGateError("advanced_audit_requires_operations")).toBe(true);
  });

  it("still matches the OLD codes, so a mid-deploy client is not left showing a raw token", () => {
    expect(isPlanGateError("catalog_sync_requires_integration")).toBe(true);
    expect(isPlanGateError("sftp_ingestion_requires_integration")).toBe(true);
  });

  it("matches a plan name it has never seen, because the backend derives it", () => {
    expect(isPlanGateError("some_future_capability_requires_distributor")).toBe(true);
  });

  it("finds the code inside a wrapped error message", () => {
    expect(isPlanGateError('API 403: {"error":"catalog_sync_requires_growth"}')).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isPlanGateError("host_not_allowed")).toBe(false);
    expect(isPlanGateError("Default supplier was not found.")).toBe(false);
    expect(isPlanGateError("")).toBe(false);
    // Near-miss: an upgrade prompt is not a plan-gate code.
    expect(isPlanGateError("requires_attention")).toBe(false);
  });
});

describe("planGateMessage", () => {
  it("names the plan the backend actually asked for", () => {
    expect(planGateMessage("catalog_sync_requires_growth")).toContain("Growth");
    expect(planGateMessage("erp_delivery_requires_enterprise")).toContain("Enterprise");
    expect(planGateMessage("cxml_output_requires_operations")).toContain("Operations");
  });

  it("is a sentence, never a raw code", () => {
    const msg = planGateMessage("sftp_ingestion_requires_growth");

    expect(msg).not.toMatch(/_/);
    expect(msg).toMatch(/^[A-Z][\s\S]*\.$/);
  });

  it("falls back to a plan-less sentence when the code has no recognisable plan", () => {
    const msg = planGateMessage("something_odd");

    expect(msg).not.toMatch(/undefined|_/);
    expect(msg.length).toBeGreaterThan(0);
  });
});

// The 403 body is `{ error, upgradeUrl }`. The upsell link must use the URL the
// BACKEND named (it owns where a given gate sends you), not a client guess — but the
// client still refuses anything that isn't an in-app path, so a compromised or
// mis-templated response cannot turn an error banner into an off-site link.
describe("planGateUpgradeUrl", () => {
  it("reads the url the backend returned in a parsed body", () => {
    expect(planGateUpgradeUrl({ error: "cxml_output_requires_operations", upgradeUrl: "/settings" }))
      .toBe("/settings");
    expect(planGateUpgradeUrl({ error: "x_requires_growth", upgradeUrl: "/settings?tab=billing" }))
      .toBe("/settings?tab=billing");
  });

  it("reads it out of a raw body string, because most clients only keep the message", () => {
    expect(planGateUpgradeUrl('API error 403: {"error":"webhook_delivery_requires_growth","upgradeUrl":"/settings?tab=billing"}'))
      .toBe("/settings?tab=billing");
  });

  it("falls back to /settings when the body names no url", () => {
    expect(planGateUpgradeUrl("advanced_audit_requires_operations")).toBe("/settings");
    expect(planGateUpgradeUrl(null)).toBe("/settings");
    expect(planGateUpgradeUrl({ error: "x_requires_growth" })).toBe("/settings");
  });

  it("refuses anything that is not an in-app path", () => {
    expect(planGateUpgradeUrl({ upgradeUrl: "https://evil.example/upgrade" })).toBe("/settings");
    expect(planGateUpgradeUrl({ upgradeUrl: "//evil.example/upgrade" })).toBe("/settings");
    expect(planGateUpgradeUrl({ upgradeUrl: "javascript:alert(1)" })).toBe("/settings");
    expect(planGateUpgradeUrl({ upgradeUrl: "settings" })).toBe("/settings");
  });
});
