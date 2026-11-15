import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { COPY } from "@/lib/documentRefusals";
import { useDocumentEdits } from "./useDocumentEdits";

const api = vi.hoisted(() => ({ editDocumentValues: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const detailWith = (value: string) => ({
  summary: { id: "d", flowId: "f", status: "needs_review" },
  read: { fields: [{ key: "supplier", value }], tables: [] },
  checks: [],
});
const renderEdits = () => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useDocumentEdits("d"), { wrapper });
};

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("useDocumentEdits", () => {
  it("saves the newest value once typing pauses, keeps a failed one, and Try again sends it", async () => {
    let answer!: (d: unknown) => void;
    api.editDocumentValues.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const { result } = renderEdits();
    act(() => result.current.type({ field: "supplier" }, "Exam"));
    act(() => result.current.type({ field: "supplier" }, "Example"));
    expect(api.editDocumentValues).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1400));
    expect(api.editDocumentValues).not.toHaveBeenCalled();                    // R7: not before 1.5 s
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.editDocumentValues.mock.calls).toEqual([["d", { fields: [{ key: "supplier", value: "Example" }] }]]);
    act(() => result.current.type({ field: "supplier" }, "Example Ltd"));       // typed while the save is on its way
    await act(async () => answer(detailWith("Example")));
    expect(result.current.drafts).toEqual({ "field:supplier": "Example Ltd" }); // the newer keystroke stays
    api.editDocumentValues.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.state).toBe("failed");
    expect(result.current.drafts).toEqual({ "field:supplier": "Example Ltd" }); // never lost
    api.editDocumentValues.mockResolvedValueOnce(detailWith("Example Ltd"));
    await act(async () => result.current.commit());
    expect(api.editDocumentValues).toHaveBeenLastCalledWith("d", { fields: [{ key: "supplier", value: "Example Ltd" }] });
    expect(api.editDocumentValues).toHaveBeenCalledTimes(3);
    expect([result.current.state, result.current.drafts]).toEqual(["saved", {}]);
  });

  it("a refusal drops the drafts and says why; a value still waiting is sent when the screen closes", async () => {
    api.editDocumentValues.mockRejectedValueOnce(new ApiHttpError("no", 409, { error: "document_sent" }));
    const { result, unmount } = renderEdits();
    act(() => result.current.type({ table: "lines", row: 0, column: "qty" }, "4"));
    await act(async () => result.current.commit());
    expect(result.current.refusal).toBe(COPY.document_sent);
    expect([result.current.state, result.current.drafts]).toEqual(["saved", {}]);
    api.editDocumentValues.mockResolvedValueOnce(detailWith("x"));
    act(() => result.current.type({ field: "supplier" }, "Sam Sample Supplies"));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.editDocumentValues).toHaveBeenLastCalledWith("d", { fields: [{ key: "supplier", value: "Sam Sample Supplies" }] });
    expect(api.editDocumentValues).toHaveBeenCalledTimes(2);
  });
});
