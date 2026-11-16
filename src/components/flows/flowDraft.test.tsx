import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { FlowStep } from "@/lib/flowSteps";
import { DraftPartFailed, DraftState, FlowDraftProvider, useDraftPart, useFlowDraft } from "./flowDraft";

const deferred = () => { let resolve!: () => void, reject!: (e: unknown) => void; const p = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const refused = () => new ApiHttpError("forbidden", 403, { error: "requires_org_admin" });

type Part = ReturnType<typeof useDraftPart<string>>;
const parts: Record<string, Part> = {};
let draft: ReturnType<typeof useFlowDraft>;

function Editor({ name, step, save }: { name: string; step: FlowStep; save: (v: string) => Promise<unknown> }) {
  const part = useDraftPart(name, step, save);
  parts[name] = part;
  return <div data-testid={`part-${name}`}><DraftState part={part} /></div>;
}
function Grab() { draft = useFlowDraft(); return null; }
const page = (editors: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <FlowDraftProvider flowId="flow-1"><Grab />{editors}</FlowDraftProvider>
  </QueryClientProvider>
);
/** flushAll()'s outcome without letting a rejection escape the test. */
const settle = (p: Promise<void>) => p.then(() => "ok" as const, (e: unknown) => e);

afterEach(() => vi.useRealTimers());

describe("flowDraft", () => {
  it("flushAll waits for a save on its way, and for the value typed while it was on its way", async () => {
    vi.useFakeTimers();
    const calls: { v: string; d: ReturnType<typeof deferred> }[] = [];
    const save = vi.fn((v: string) => { const d = deferred(); calls.push({ v, d }); return d.p; });
    render(page(<Editor name="values" step="read" save={save} />));
    act(() => parts.values.change("a"));
    act(() => vi.advanceTimersByTime(800));
    expect(calls.map((c) => c.v)).toEqual(["a"]);
    act(() => parts.values.change("b"));
    let outcome: unknown = "pending";
    act(() => { void settle(draft.flushAll()).then((o) => (outcome = o)); });
    await act(async () => calls[0].d.resolve());
    expect(calls.map((c) => c.v)).toEqual(["a", "b"]);     // "b" goes at once, without waiting for its timer
    expect(outcome).toBe("pending");
    await act(async () => calls[1].d.resolve());
    expect(outcome).toBe("ok");
    expect(within(screen.getByTestId("part-values")).queryByText(/^(Draft saved|Saved)$/)).toBeNull();
  });

  it("a refused part stops flushAll, says why at the part, and Undo drops the value so it is never sent again", async () => {
    vi.useFakeTimers();
    const saveA = vi.fn().mockResolvedValue(undefined);
    const saveB = vi.fn().mockRejectedValue(refused());
    const { unmount } = render(page(<><Editor name="A" step="read" save={saveA} /><Editor name="B" step="send" save={saveB} /></>));
    act(() => { parts.A.change("a1"); parts.B.change("b1"); });
    let outcome: unknown;
    await act(async () => { outcome = await settle(draft.flushAll()); });
    expect(saveA.mock.calls).toEqual([["a1"]]);
    expect(outcome).toBeInstanceOf(DraftPartFailed);
    expect(outcome).toMatchObject({ part: "B", step: "send" });
    const b = within(screen.getByTestId("part-B"));
    expect(b.getByText("Only a workspace admin can change this.")).toBeTruthy();
    expect(b.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(b.getByRole("button", { name: "Undo my change" }));
    expect(b.queryByText("Only a workspace admin can change this.")).toBeNull();
    await act(async () => { outcome = await settle(draft.flushAll()); });
    expect(outcome).toBe("ok");
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(saveB).toHaveBeenCalledTimes(1);
    expect(saveA).toHaveBeenCalledTimes(1);
  });

  it("a part that leaves sends what it held once, and flushAll still waits for that save to answer", async () => {
    vi.useFakeTimers();
    const d = deferred();
    const save = vi.fn(() => d.p);
    const { rerender } = render(page(<Editor name="output:out-1" step="send" save={save} />));
    act(() => parts["output:out-1"].change("x"));
    rerender(page(null));
    expect(save.mock.calls).toEqual([["x"]]);
    let outcome: unknown = "pending";
    act(() => { void settle(draft.flushAll()).then((o) => (outcome = o)); });
    await act(async () => {});
    expect(outcome).toBe("pending");
    await act(async () => d.resolve());
    expect(outcome).toBe("ok");
    await act(async () => { outcome = await settle(draft.flushAll()); vi.advanceTimersByTime(1000); });
    expect(outcome).toBe("ok");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
