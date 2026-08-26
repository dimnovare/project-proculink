/* ── A failed document load had no way back ───────────────────────────────────
 *
 * THE DEFECT. `useSourceDocument` returned exactly three things:
 *
 *     { state, isLoading, hasDocument }
 *
 * No `refetch`. So no consumer COULD offer a retry after a failed load — not the desktop
 * pane, not the mobile card — and the query's own policy makes that permanent-feeling:
 * `staleTime: 5 * 60_000` is correct (the bytes are immutable, there is nothing to poll),
 * which means a one-second network blip leaves the pane looking empty for five minutes.
 * The only escape was reloading the browser, on a review screen holding unsaved mapping work.
 *
 * TWO MORE THINGS THE HOOK KNEW AND DID NOT SAY:
 *
 *   • `hasDocument` is false for all six states, which is the right answer to "can I render
 *     it" and useless for "is it worth asking again". `none` / `purged` / `missing` are
 *     settled facts about the ORDER; `error` / `throttled` are facts about one REQUEST.
 *   • the throttled branch reads `error.retryAfterSeconds` off the 429 and buries it inside
 *     the state union, where no surface has ever rendered it.
 *
 * The retry CONTROL belongs to the render surfaces (OrderWorkshop builds the pane's
 * `receivedDocument`, MobileSourceDocument owns the phone card) — neither is in this
 * packet's file set. What is fixed here is the reason they could not offer one.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SourceDocumentState } from "@/lib/sourceDocument";

const getOrderSource = vi.fn();

vi.mock("@/lib/api-client", () => ({
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    retryAfterSeconds: number | null;
    // SAME parameter order as the real class in src/lib/api/core.ts —
    // `(message, status, body, retryAfterSeconds)`. The type checker resolves ApiHttpError
    // from the REAL module even though the runtime value comes from this factory, so a mock
    // that reorders the parameters compiles against one signature and runs against another.
    constructor(
      message: string,
      status: number,
      body: unknown = null,
      retryAfterSeconds: number | null = null,
    ) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
  apiClient: { getOrderSource: (...a: unknown[]) => getOrderSource(...a) },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { useSourceDocument } from "./useSourceDocument";
import { ApiHttpError } from "@/lib/api-client";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const DOCUMENT: SourceDocumentState = {
  kind: "document",
  document: { blob: new Blob(["x"]), contentType: "text/csv", filename: "po.csv" },
};

function mount() {
  return renderHook(() => useSourceDocument("ord-1"), { wrapper });
}

// resetAllMocks, not clearAllMocks: `mockResolvedValueOnce` leaves a QUEUED implementation
// that clearAllMocks does not drain, so the second file-level test would consume the first
// test's leftover success and assert against the wrong state.
beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("a failed load can be asked again", () => {
  it("exposes a refetch that actually re-runs the request, and succeeds", async () => {
    getOrderSource.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(DOCUMENT);
    const { result } = mount();

    // Wait for the SETTLED error, not merely for `state.kind === "error"`: the pre-answer
    // branch also reports `{ kind: "error" }` (with isLoading true), so the shorter wait
    // would match while the request is still open and assert against the loading state.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.state.kind).toBe("error");
    });
    expect(result.current.hasDocument).toBe(false);
    expect(result.current.canRetry).toBe(true);

    // The defect: this property did not exist, so nothing downstream could do this.
    expect(typeof result.current.refetch).toBe("function");
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.hasDocument).toBe(true));
    expect(getOrderSource).toHaveBeenCalledTimes(2);
  });

  it("surfaces the wait the 429 asked for", async () => {
    getOrderSource.mockRejectedValue(new ApiHttpError("too many", 429, null, 45));
    const { result } = mount();

    await waitFor(() => expect(result.current.state.kind).toBe("throttled"));
    // Readable without narrowing the union, which is what kept it unrendered.
    expect(result.current.retryAfterSeconds).toBe(45);
    expect(result.current.canRetry).toBe(true);
  });

  it("reports no wait — not zero — when the 429 named none", async () => {
    // ANTI-VACUITY on the number: a hook that answered 0 for everything would pass the
    // assertion above's sibling, and 0 seconds is an instruction ("retry now") rather
    // than the absence of one.
    getOrderSource.mockRejectedValue(new ApiHttpError("too many", 429, null, null));
    const { result } = mount();

    await waitFor(() => expect(result.current.state.kind).toBe("throttled"));
    expect(result.current.retryAfterSeconds).toBeNull();
  });
});

describe("canRetry separates a failed request from a settled absence", () => {
  // The distinction `hasDocument` cannot make: every row here has hasDocument === false.
  const settled: { name: string; state: SourceDocumentState }[] = [
    { name: "204, no file stored", state: { kind: "none" } },
    { name: "410, purged on retention", state: { kind: "purged", message: "removed" } },
    { name: "404, unknown order", state: { kind: "missing" } },
  ];

  it.each(settled)("does not invite a retry for $name", async ({ state }) => {
    getOrderSource.mockResolvedValue(state);
    const { result } = mount();

    await waitFor(() => expect(result.current.state.kind).toBe(state.kind));
    expect(result.current.hasDocument).toBe(false);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retryAfterSeconds).toBeNull();
  });

  it("and does not invite one for a document that arrived", async () => {
    getOrderSource.mockResolvedValue(DOCUMENT);
    const { result } = mount();

    await waitFor(() => expect(result.current.hasDocument).toBe(true));
    expect(result.current.canRetry).toBe(false);
  });

  it("does not invite one before the answer is in", async () => {
    // ANTI-VACUITY the other way: canRetry is not simply !hasDocument. While the request is
    // open there is nothing to retry — offering one would race the request in flight.
    getOrderSource.mockReturnValue(new Promise(() => {}));
    const { result } = mount();

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.hasDocument).toBe(false);
    expect(result.current.canRetry).toBe(false);
  });
});
