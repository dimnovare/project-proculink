import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// P0-A (audit 2026-08-13 v3, finding 1) — the read-only conformance check
// rendered a DELIVERY VERDICT.
//
// THE DEFECT, verbatim. `ConformancePanel.tsx:221` was
//     <UnifiedStatusBadge status={report.overallPass ? "delivered" : "rejected"} />
// and UnifiedStatusBadge's vocabulary is the order lifecycle: STATUS_META maps
// `delivered` → "Delivered" and `rejected` → "Supplier rejected". So a pre-flight
// check that transforms in memory and validates the bytes printed the word
// **"Delivered"** — four lines beneath the panel's own sentence "Read-only:
// nothing is delivered or changed." — and on failure printed **"Supplier
// rejected"**, attributing a decision to a supplier that had never seen the
// document.
//
// WHY THE COPY PACKET MISSED IT. #152 rewrote the sentence BESIDE the badge
// ("Matches the standard" → "Required elements present") and left the badge. The
// audited artifact was the words in the JSX string; the badge's words live one
// file away in a lookup table, so they were never read. That is why these tests
// assert THE RENDERED WORD and never the component name — a test that asserted
// "does not import UnifiedStatusBadge" would have passed all along on the copy
// packet's own terms and still shipped "Delivered".
//
// ANTI-VACUITY. The lifecycle sweep below reads the real STATUS_LABELS map and
// floors its size. `[].every()` is true, so a sweep over an empty label set would
// pass against a panel that says "Delivered" in 48pt.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, getConformanceReport: vi.fn(), downloadConformanceReport: vi.fn() };
});

import * as apiClient from "@/lib/api-client";
import type { ConformanceReport } from "@/lib/api-client";
import { ConformancePanel } from "@/components/bridge/ConformancePanel";
import { STATUS_LABELS } from "@/components/bridge/UnifiedStatusBadge";

const reportMock = vi.mocked(apiClient.getConformanceReport);

function makeReport(overallPass: boolean): ConformanceReport {
  return {
    orderId: "ord-1",
    format: "cxml",
    profile: "Cxml12OrderRequest",
    profileName: "cXML 1.2 OrderRequest — mandatory elements",
    profileVersion: "1.2",
    overallPass,
    errorCount: overallPass ? 0 : 2,
    warningCount: 0,
    checks: [
      {
        code: "cxml.header.from",
        message: overallPass ? "From/Credential present." : "From/Credential missing.",
        severity: "Error",
        passed: overallPass,
        profileRef: "cXML 1.2 §3.1",
      },
    ],
  } as ConformanceReport;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function renderPanel(overallPass: boolean): Promise<string> {
  reportMock.mockResolvedValue(makeReport(overallPass));
  render(
    <Wrapper>
      <ConformancePanel orderId="ord-1" supplierName="Nordmark" defaultFormat="cxml" />
    </Wrapper>,
  );
  await screen.findByText(/cXML 1\.2 OrderRequest/);
  return document.body.textContent ?? "";
}

/**
 * Every order-lifecycle word this product owns, read from the map that owns them
 * rather than hand-typed here — a hand-typed list is how a status rename walks
 * straight past a guard in this repo.
 *
 * Two labels are excluded and named:
 *   • "Draft"/"Live" are the connection-lifecycle keys that share the map.
 * Nothing else is excluded: a conformance report has no business printing any of
 * them.
 */
const CONNECTION_LIFECYCLE_LABELS = new Set([STATUS_LABELS.draft, STATUS_LABELS.live]);
const ORDER_LIFECYCLE_LABELS = Array.from(
  new Set(Object.values(STATUS_LABELS).filter((l) => !CONNECTION_LIFECYCLE_LABELS.has(l))),
);

beforeEach(() => reportMock.mockReset());
afterEach(() => cleanup());

describe("ConformancePanel — a pre-flight check is not a lifecycle state (P0-A)", () => {
  it("never prints the word 'Delivered' when the checks pass", async () => {
    const text = await renderPanel(true);

    // The exact word the operator saw before this fix, on the exact input that
    // produced it (overallPass === true).
    //
    // A case-sensitive SUBSTRING, deliberately not /\bDelivered\b/. The badge's
    // label sits flush against the sentence beside it, so `textContent` reads
    // "DeliveredRequired elements present" — and `\b` does not match between two
    // word characters, so the word-boundary form silently passed against the live
    // defect. The mutation run is what surfaced that; it is recorded here because
    // the same shape will be reached for again.
    //
    // Case-sensitivity is load-bearing in the other direction: the panel's honest
    // copy says "nothing is delivered or changed", which must NOT trip this.
    expect(text).not.toContain("Delivered");
    expect(text).toContain("Read-only: nothing is delivered or changed.");
  });

  it("never prints 'Supplier rejected' when the checks fail", async () => {
    const text = await renderPanel(false);

    expect(text).not.toMatch(/Supplier rejected/);
    expect(text).toContain("Read-only: nothing is delivered or changed.");
  });

  it("states the verdict in check vocabulary, pass and fail", async () => {
    expect(await renderPanel(true)).toContain("Checks passed");
    cleanup();
    expect(await renderPanel(false)).toContain("Checks failed");
  });

  it("prints no order-lifecycle label at all, on pass or fail", async () => {
    // Anti-vacuity floor: count what was EXTRACTED from the live map, not files
    // scanned. `[].every()` is vacuously true.
    expect(ORDER_LIFECYCLE_LABELS.length).toBeGreaterThanOrEqual(20);
    expect(ORDER_LIFECYCLE_LABELS).toContain("Delivered");
    expect(ORDER_LIFECYCLE_LABELS).toContain("Supplier rejected");

    for (const overallPass of [true, false]) {
      const text = await renderPanel(overallPass);
      // Case-sensitive substring, NOT a word-boundary regex — see the note in the
      // first test. Adjacent spans concatenate in `textContent`, so `\b` fails to
      // fire on exactly the render this is guarding.
      const leaked = ORDER_LIFECYCLE_LABELS.filter((label) => text.includes(label));
      expect(
        leaked,
        `conformance panel (overallPass=${overallPass}) printed order-lifecycle label(s): ${leaked.join(", ")}`,
      ).toEqual([]);
      cleanup();
    }
  });
});
