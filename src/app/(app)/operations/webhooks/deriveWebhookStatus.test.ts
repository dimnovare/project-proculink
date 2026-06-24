import { describe, expect, it } from "vitest";
import { deriveWebhookStatus } from "./webhookStatus";

// Guards B4: the webhooks monitor previously derived status from isActive alone
// and DROPPED failureCount, so a failing (or auto-deactivated) endpoint read as
// "Healthy". deriveWebhookStatus must mirror the Settings page logic exactly.
describe("deriveWebhookStatus — mirrors the Settings page webhook status logic", () => {
  it("reads as healthy only when active AND failure-free", () => {
    expect(deriveWebhookStatus(true, 0)).toBe("healthy");
  });

  it("reads as failing when active but with recent failures (NOT healthy)", () => {
    expect(deriveWebhookStatus(true, 1)).toBe("failing");
    expect(deriveWebhookStatus(true, 3)).toBe("failing");
    expect(deriveWebhookStatus(true, 99)).toBe("failing");
  });

  it("reads as paused when inactive, regardless of failure count", () => {
    // An endpoint auto-deactivated after 3 failures is inactive → paused, not benign-healthy.
    expect(deriveWebhookStatus(false, 0)).toBe("paused");
    expect(deriveWebhookStatus(false, 3)).toBe("paused");
  });
});
