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

  it("includes every announced hub's first-tab href so all 4 hubs survive core mode", () => {
    // Partners, Rules & formats, Operations, Inbound (Inbound is additionally
    // gated by INBOUND_ENABLED in buildVisibleNav, so listing it here does not
    // leak it — it only lets it survive the core filter once on).
    for (const href of [
      "/library/suppliers",
      "/library/mappings",
      "/operations/health",
      "/inbound/invoices",
    ]) {
      expect(LAUNCH_CORE_HREFS.has(href)).toBe(true);
    }
  });

  // Integrations was a fifth entry, pointing at /operations/connectors. That
  // page was deleted on 2026-08-13 and the URL now 308s to /library/suppliers
  // (src/lib/retired-routes.ts) — a redirect needs no nav state, so keeping the
  // href here would have let a deleted route survive the core filter.
  it("carries no href for the deleted /operations/connectors", () => {
    expect(LAUNCH_CORE_HREFS.has("/operations/connectors")).toBe(false);
  });
});
