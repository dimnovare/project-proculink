import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConnectionRevisionSummary, ReplayResponse, ReprocessResponse } from "@/lib/api/types";

// WP-35 — re-processing one replayed order under the revision being vetted.
//
// The whole point of the feature is that it PERSISTS an artifact while
// DELIVERING NOTHING. These tests therefore assert two things at once: that the
// artifact is named, and that no copy anywhere in the panel claims the order was
// sent. A `reused: true` response must not be dressed up as a fresh success.

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    replayConnectionRevision: vi.fn(),
    reprocessOrderUnderRevision: vi.fn(),
  };
});

import * as apiClient from "@/lib/api-client";
import { ApiHttpError } from "@/lib/api-client";
import { ReplayPanel } from "@/components/connections/ReplayPanel";

const replayMock = vi.mocked(apiClient.replayConnectionRevision);
const reprocessMock = vi.mocked(apiClient.reprocessOrderUnderRevision);

const REVISIONS: ConnectionRevisionSummary[] = [
  { id: "rev-3", versionNo: 3, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: "2026-01-03T00:00:00Z" },
  { id: "rev-2", versionNo: 2, status: "published", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-02T00:00:00Z" },
];

const REPLAY: ReplayResponse = {
  connectionId: "conn-1",
  revisionId: "rev-3",
  revisionVersionNo: 3,
  revisionStatus: "draft",
  orderCount: 1,
  orders: [
    {
      orderId: "ord-77",
      poNumber: "PO-2026-0481",
      outputFormat: "Csv",
      outputChanged: true,
      currentOutput: "PoNumber,ItemCode\nPO-2026-0481,FP-B001",
      draftOutput: "PoNumber,ItemCode\nPO-2026-0481,SUP-B001",
      outputError: null,
      effectiveValueChanges: [],
      validationChanged: false,
      currentValidation: { passed: true, passCount: 3, failCount: 0, hasProfile: true },
      draftValidation: { passed: true, passCount: 3, failCount: 0, hasProfile: true },
      validationFlips: [],
    },
  ],
};

const FRESH: ReprocessResponse = {
  orderId: "ord-77",
  poNumber: "PO-2026-0481",
  revisionId: "rev-3",
  revisionVersionNo: 3,
  artifactId: "a1b2c3d4-0000-4000-8000-000000000001",
  format: "Csv",
  fileKey: "orgs/o1/orders/ord-77/reprocess/a1b2c3d4.csv",
  artifactSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  createdAt: "2026-08-06T10:30:00Z",
  reused: false,
  deliverableArtifactId: "dddddddd-0000-4000-8000-000000000009",
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Render, run the replay, and return the one order row. */
async function renderWithResults(): Promise<HTMLElement> {
  render(
    <Wrapper>
      <ReplayPanel connectionId="conn-1" revisions={REVISIONS} activeRevisionId="rev-2" />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText("PO-2026-0481");
  return screen.getByRole("listitem");
}

function reprocessButton(row: HTMLElement): HTMLElement {
  return within(row).getByRole("button", { name: /re-process under this version/i });
}

/**
 * No copy in the panel may claim the order went to the supplier. "Not sent to
 * the supplier" is the whole point, so a bare "sent to the supplier" is only
 * allowed when a negation immediately precedes it.
 */
function expectNoDeliveryClaim(): void {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/\bdelivered\b/i);
  expect(text).not.toMatch(/\bdelivery (?:started|queued|scheduled)\b/i);
  expect(text).not.toMatch(/(?<!not )(?<!never )sent to (?:the |your )?supplier/i);
}

beforeEach(() => {
  replayMock.mockReset();
  reprocessMock.mockReset();
  replayMock.mockResolvedValue(REPLAY);
});

afterEach(() => cleanup());

describe("ReplayPanel — re-process one order under a revision (WP-35)", () => {
  it("offers the action per order and explains it produces a file rather than a delivery", async () => {
    const row = await renderWithResults();

    expect(reprocessButton(row)).toBeTruthy();
    expect(within(row).getByText(/not sent to the supplier/i)).toBeTruthy();
    expectNoDeliveryClaim();
  });

  it("names the artifact it created and calls the client with the replayed revision", async () => {
    reprocessMock.mockResolvedValue(FRESH);
    const row = await renderWithResults();

    fireEvent.click(reprocessButton(row));

    await within(row).findByText(/output file created/i);
    expect(reprocessMock).toHaveBeenCalledWith("conn-1", "rev-3", "ord-77");
    // The artifact is identified by format + id, so an operator can find the
    // bytes they just made. (Bare /Csv/ would also hit the row's format chip.)
    expect(within(row).getByText(/Csv · a1b2c3d4/)).toBeTruthy();
    expectNoDeliveryClaim();
  });

  it("shows the order's deliverable output is unchanged by the re-process", async () => {
    reprocessMock.mockResolvedValue(FRESH);
    const row = await renderWithResults();

    fireEvent.click(reprocessButton(row));

    await within(row).findByText(/output file created/i);
    expect(within(row).getByText(/deliverable output is unchanged/i)).toBeTruthy();
    expect(within(row).getByText(/dddddddd/)).toBeTruthy();
  });

  it("says plainly that nothing new was written when the output already existed", async () => {
    reprocessMock.mockResolvedValue({ ...FRESH, reused: true });
    const row = await renderWithResults();

    fireEvent.click(reprocessButton(row));

    await within(row).findByText(/already existed/i);
    expect(within(row).getByText(/no new file was created/i)).toBeTruthy();
    // Must NOT be dressed up as a fresh success.
    expect(within(row).queryByText(/output file created/i)).toBeNull();
    expectNoDeliveryClaim();
  });

  it("surfaces the backend's reason when the revision cannot render this order (422)", async () => {
    reprocessMock.mockRejectedValue(
      new ApiHttpError("Template render failed: unknown variable 'Line.Sku' at line 8.", 422),
    );
    const row = await renderWithResults();

    fireEvent.click(reprocessButton(row));

    await within(row).findByText(/unknown variable 'Line\.Sku' at line 8\./i);
    expect(within(row).getByText(/could not produce output for this order/i)).toBeTruthy();
    // A failure must not leave a success line behind.
    expect(within(row).queryByText(/output file created/i)).toBeNull();
    expect(within(row).queryByText(/already existed/i)).toBeNull();
    expectNoDeliveryClaim();
  });

  it("reports storage being unavailable as nothing saved rather than a generic failure (503)", async () => {
    reprocessMock.mockRejectedValue(new ApiHttpError("File storage is not configured.", 503));
    const row = await renderWithResults();

    fireEvent.click(reprocessButton(row));

    await within(row).findByText(/nothing was saved/i);
    expect(within(row).queryByText(/output file created/i)).toBeNull();
    expectNoDeliveryClaim();
  });

  it("keeps each order's result on its own row", async () => {
    replayMock.mockResolvedValue({
      ...REPLAY,
      orderCount: 2,
      orders: [
        REPLAY.orders[0],
        { ...REPLAY.orders[0], orderId: "ord-78", poNumber: "PO-2026-0479" },
      ],
    });
    reprocessMock.mockResolvedValue(FRESH);

    render(
      <Wrapper>
        <ReplayPanel connectionId="conn-1" revisions={REVISIONS} activeRevisionId="rev-2" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
    await screen.findByText("PO-2026-0481");

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    fireEvent.click(reprocessButton(rows[0]));

    await within(rows[0]).findByText(/output file created/i);
    await waitFor(() => expect(within(rows[1]).queryByText(/output file created/i)).toBeNull());
  });
});
