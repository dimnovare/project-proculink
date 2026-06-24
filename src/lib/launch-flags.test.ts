import { describe, it, expect } from "vitest";
import { LAUNCH_CORE_HREFS } from "./launch-flags";

// STRUCT-1 — "/connections" was dropped from the launch sidebar's core hrefs.
// The route still resolves; it is just no longer surfaced in the nav.
describe("LAUNCH_CORE_HREFS (STRUCT-1)", () => {
  it("no longer contains /connections", () => {
    expect(LAUNCH_CORE_HREFS.has("/connections")).toBe(false);
  });

  it("still contains the supplier directory (where version history now lives)", () => {
    expect(LAUNCH_CORE_HREFS.has("/library/suppliers")).toBe(true);
  });

  it("keeps the rest of the core launch surface", () => {
    for (const href of ["/bridge", "/upload", "/inbox", "/operations/exceptions", "/operations/health", "/admin", "/settings", "/help"]) {
      expect(LAUNCH_CORE_HREFS.has(href)).toBe(true);
    }
  });
});
