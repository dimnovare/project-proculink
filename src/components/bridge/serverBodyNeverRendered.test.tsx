import { describe, it, expect } from "vitest";

/**
 * The RENDER half of the server-body guard. Its companion, `src/lib/serverText.test.ts`, pins the
 * cleaning; this file pins that the screens actually do it.
 *
 * That split is the whole point. The reason this defect survived two fixes is that unit tests
 * pinned the sanitiser while nothing pinned that the render sites call it — deleting the call left
 * every unit test green. So each test below renders the REAL component and asserts on
 * `document.body.textContent`: what a person actually reads.
 *
 * These sites carry a different string from the one `ApiHttpError` now cleans at construction.
 * `order.errorMessage` and `catalogSource.lastSyncError` arrive on a
 * 200, as persisted fields, and the backend concatenates the supplier's response body after its own
 * sentence ("Response summary: …"). They stay raw in the data layer on purpose — production logic
 * reads them, e.g. `problemCopy.isDeliveryConfigMissing` matches
 * `/delivery config(uration)? is missing/i` on `order.errorMessage` to decide whether to offer the
 * "add a delivery endpoint" arm — so they are cleaned where they become prose.
 *
 * FIXTURE DISCIPLINE. FE #98's post-mortem: an earlier render test set `errorMessage: null`, so the
 * fixture, not the code, was what passed. Every test here therefore asserts BOTH directions — the
 * markup is gone AND something from the message survived — so a fixture that stops carrying the
 * defect fails instead of passing quietly.
 *
 * Families 3 and 4 (the order details drawer and the send flow's notice) went with the order
 * review screen on 2026-11-13; the catalog source's line is the render site left.
 */

// A real gateway page appended to a backend sentence: the exact shape production produced.
const APPENDED_HTML =
  "HTTP 502: the supplier endpoint returned an error. Response summary: " +
  "<!-- Tip: set Accept to application/json for errors in JSON. -->" +
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>" +
  "<body><center><h1>502 Bad Gateway</h1></center></body></html>";

// ─────────────────────────────────────────────────────────────────────────────
// Family 5 — the catalog source's lastSyncError, interpolated the same way.
// ─────────────────────────────────────────────────────────────────────────────

describe("formatLastSync — catalogSource.lastSyncError", () => {
  it("does not interpolate a fetched error page into 'Last sync failed: …'", async () => {
    const { formatLastSync } = await import("@/components/bridge/catalogSourceHelpers");
    const line = formatLastSync({
      lastSyncStatus: "failed",
      lastSyncAt: "2026-08-06T09:00:00Z",
      lastSyncError: APPENDED_HTML,
    } as never);

    expect(line.text).not.toContain("<!DOCTYPE");
    expect(line.text).not.toContain("<html");
    expect(line.text).toContain("HTTP 502");
  });

  it("still says only 'Last sync failed' when nothing legible came back", async () => {
    const { formatLastSync } = await import("@/components/bridge/catalogSourceHelpers");
    const line = formatLastSync({
      lastSyncStatus: "failed",
      lastSyncAt: "2026-08-06T09:00:00Z",
      lastSyncError: "<html><head></head><body></body></html>",
    } as never);
    expect(line.text).toBe("Last sync failed");
  });
});
