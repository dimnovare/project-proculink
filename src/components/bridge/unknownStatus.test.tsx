/* ── An unknown status must not render as a decided one ─────────────────────────
 *
 * THE DEFECT, in two files, one shape.
 *
 * `InboxView.mapStatus` ended `return "new"`, and its own comment admitted what that
 * meant: "landing here claims the pipeline never started". STATUS_PRESENTATION renders
 * `new` as the word "New" at stage 0, so an order whose status this build had never
 * heard of was drawn as brand new and untouched — a full verdict, invented out of not
 * knowing. Frontend and backend deploy separately, so an unrecognised status is a
 * routine event, not an exotic one, and the rows it lands on are the rows we understand
 * least.
 *
 * `UploadWorkbench.recentStatusFromOrder` had the same default under a different name:
 * every unrecognised status was toned `draft`, a decided state no order in this product
 * has ever been in. Nothing rendered the word "Draft" (the pill's text has come from
 * `statusLabel(rawStatus)` for a while), so the visible damage was smaller — but the
 * bucket was named for a real state and shared its treatment, which is how anything
 * Draft ever grew would have attached itself to every status the frontend cannot read.
 *
 * This is the recurring defect class in this codebase: an UNKNOWN value rendering as a
 * DECIDED one. The same shape produced "delivered", "succeeded" and "100%" from absent
 * data on four unrelated surfaces.
 *
 * WHAT THIS FILE PINS. Both halves, in both directions:
 *   • a genuinely unrecognised status renders the neutral, stage-less presentation, and
 *   • every status the order-status manifest DOES name still reaches a decided one.
 * The second half is the control. Without it the whole file would pass against a
 * `mapStatus` that answered "unknown" for everything, which is the opposite defect and
 * an easy one to ship while making this one green.
 *
 * The manifest walk is derived from `ORDER_STATUSES` (src/lib/orderStatusManifest.ts),
 * the registry that owns the question, rather than from a list retyped here — a
 * hand-typed copy is how nine status checklists came to disagree with each other.
 *
 * jsdom applies no Tailwind, so the inbox's mobile card list (`lg:hidden`) AND its
 * desktop table (`hidden lg:block`) both mount. That is used deliberately below: the
 * caption is expected TWICE, once per tree, so a fix that reached only one viewport
 * fails here.
 * ──────────────────────────────────────────────────────────────────────────── */

// 2026-11-13: the inbox row, the inbox Pipeline stage and the upload page's
// recent-uploads pill went with their screens. What is left is the shared
// mapper, mapStatus (src/lib/orderArchiveStatus.ts), which the archive renders.

import { describe, it, expect } from "vitest";
import { ORDER_STATUSES } from "@/lib/orderStatusManifest";
import { mapStatus } from "@/lib/orderArchiveStatus";

const ALIEN = "quantum_flux";

describe("mapStatus sorts ignorance from a verdict", () => {
  it("sends an unrecognised status to the unknown bucket rather than to 'New'", () => {
    expect(mapStatus(ALIEN)).toBe("unknown");
    expect(mapStatus(ALIEN)).not.toBe("new");
  });

  it("the manifest names enough statuses for the walk below to mean something", () => {
    // Anti-vacuity: an empty or truncated ORDER_STATUSES would make the control pass by
    // iterating nothing, which is exactly how a coverage test stops covering anything.
    expect(ORDER_STATUSES.length).toBeGreaterThanOrEqual(16);
  });

  it.each([...ORDER_STATUSES])(
    "%s is a status this build knows, so it still reaches a decided bucket",
    (status) => {
      expect(
        mapStatus(status),
        `${status} is in the order-status manifest but mapStatus has no arm for it`,
      ).not.toBe("unknown");
    },
  );

  it("keeps pending_parse on 'New' — the one status that really does mean nothing has run", () => {
    // The arm the unknown default must not swallow. `pending_parse` genuinely means
    // queued-and-untouched, which is what stage 0 says.
    expect(mapStatus("pending_parse")).toBe("new");
  });
});
