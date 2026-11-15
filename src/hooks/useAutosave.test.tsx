import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutosave } from "./useAutosave";

const deferred = () => { let resolve!: () => void, reject!: (e: unknown) => void; const p = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
afterEach(() => vi.useRealTimers());

describe("useAutosave", () => {
  it("waits for a pause, sends one request at a time, and always ends on the newest value", async () => {
    vi.useFakeTimers();
    const calls: { v: string; d: ReturnType<typeof deferred> }[] = [];
    const save = (v: string) => { const d = deferred(); calls.push({ v, d }); return d.p; };
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.change("a"));
    expect(result.current.state).toBe("saving");
    act(() => vi.advanceTimersByTime(799));
    expect(calls).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(calls.map((c) => c.v)).toEqual(["a"]);
    act(() => { result.current.change("b"); result.current.change("c", true); });
    expect(calls).toHaveLength(1);                                       // nothing overlaps the save on its way
    await act(async () => calls[0].d.resolve());
    expect(calls.map((c) => c.v)).toEqual(["a", "c"]);                   // "b" is never sent
    await act(async () => calls[1].d.resolve());
    expect(result.current.state).toBe("saved");
  });

  it("a failed save keeps the newest value, says so, and sends it again on flush", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    await act(async () => { result.current.change("x", true); });
    expect(result.current.state).toBe("failed");
    expect((result.current.error as Error).message).toBe("offline");
    await act(async () => { await result.current.flush(); });
    expect(save.mock.calls.map((c) => c[0])).toEqual(["x", "x"]);
    expect([result.current.state, result.current.error]).toEqual(["saved", null]);
  });
});
