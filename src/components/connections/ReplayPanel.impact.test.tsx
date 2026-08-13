import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConnectionRevisionSummary, ReplayOrderDiff, ReplayResponse } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// P0-C at the surface. `replayImpactModel.test.ts` pins the predicate; this pins
// THE SENTENCE THE OPERATOR READS, on the exact input that produced it — a draft
// revision that rendered nothing for any replayed order.
//
// Separate from the model test on purpose. The defect was not that the predicate
// was unknown; `errors` was computed four lines above `noImpact` and left out of
// it. A model-only test would have been satisfiable while ReplayPanel kept its own
// inline arithmetic, so this one renders the real component and reads the DOM.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, replayConnectionRevision: vi.fn(), reprocessOrderUnderRevision: vi.fn() };
});

import * as apiClient from "@/lib/api-client";
import { ReplayPanel } from "@/components/connections/ReplayPanel";

const replayMock = vi.mocked(apiClient.replayConnectionRevision);

const REVISIONS: ConnectionRevisionSummary[] = [
  { id: "rev-3", versionNo: 3, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: "2026-01-03T00:00:00Z" },
  { id: "rev-2", versionNo: 2, status: "published", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-02T00:00:00Z" },
];

/** What a template broken for this order actually looks like on the wire. */
function unrenderable(po: string): ReplayOrderDiff {
  return {
    orderId: `ord-${po}`,
    poNumber: po,
    outputFormat: "Csv",
    // The load-bearing value: `outputChanged` is `current.Ok && draft.Ok && …`, so a
    // draft that cannot render scores FALSE here. That is what summed to zero.
    outputChanged: false,
    currentOutput: "PoNumber,ItemCode\nPO,FP-B001",
    draftOutput: null,
    outputError: "Template render failed: unknown variable 'Line.Sku' at line 8.",
    effectiveValueChanges: [],
    validationChanged: false,
    currentValidation: { passed: true, passCount: 3, failCount: 0, hasProfile: true },
    draftValidation: { passed: true, passCount: 3, failCount: 0, hasProfile: true },
    validationFlips: [],
  } as ReplayOrderDiff;
}

function renderable(po: string): ReplayOrderDiff {
  return { ...unrenderable(po), draftOutput: "PoNumber,ItemCode\nPO,FP-B001", outputError: null };
}

function response(orders: ReplayOrderDiff[]): ReplayResponse {
  return {
    connectionId: "conn-1",
    revisionId: "rev-3",
    revisionVersionNo: 3,
    revisionStatus: "draft",
    orderCount: orders.length,
    orders,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function runReplay(orders: ReplayOrderDiff[]): Promise<string> {
  replayMock.mockResolvedValue(response(orders));
  render(
    <Wrapper>
      <ReplayPanel connectionId="conn-1" revisions={REVISIONS} activeRevisionId="rev-2" />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(new RegExp(`${orders.length} orders? replayed`));
  return document.body.textContent ?? "";
}

beforeEach(() => {
  replayMock.mockReset();
});
afterEach(() => cleanup());

describe("ReplayPanel — the pre-publish headline (P0-C)", () => {
  it("does not headline 'safe to go live' when the version emitted nothing for every order", async () => {
    const text = await runReplay([unrenderable("PO-1"), unrenderable("PO-2"), unrenderable("PO-3")]);

    // The exact words the operator read before this fix.
    expect(text).not.toContain("safe to go live");
    expect(text).not.toContain("would process the same way under this version");
    expect(text).not.toContain("Good news");

    // And the panel is genuinely rendered — not an empty body passing by default.
    expect(text).toContain("3 orders replayed");
    expect(text).toContain("produced no output at all");
  });

  it("still headlines 'safe to go live' when every order rendered and nothing changed", async () => {
    const text = await runReplay([renderable("PO-1"), renderable("PO-2")]);

    expect(text).toContain("safe to go live");
    expect(text).toContain("2 orders replayed");
  });

  it("does not headline 'safe to go live' when only some orders rendered", async () => {
    const text = await runReplay([renderable("PO-1"), unrenderable("PO-2")]);

    expect(text).not.toContain("safe to go live");
    expect(text).toContain("2 orders replayed");
  });
});
