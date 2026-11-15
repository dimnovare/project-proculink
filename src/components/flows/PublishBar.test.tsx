import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow } from "@/lib/api/documents";
import { FlowDraftProvider, useDraftPart } from "./flowDraft";
import { PublishBar } from "./PublishBar";

const api = vi.hoisted(() => ({ publishFlow: vi.fn(), restoreFlowVersion: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 3,
  createdAt: "", automation: "review", publishedVersion: 1, hasChanges: true, noCorrectionStreak: null,
} as Flow;

let change: (v: string) => void;
let block: (reason: string | null) => void;
function Values({ save }: { save: (v: string) => Promise<unknown> }) {
  ({ change, block } = useDraftPart("values", "read", save));
  return null;
}
/** The bar reads the flow from the cache, as the page does, so a publish's answer reaches it. */
function Bar({ initial }: { initial: Flow }) {
  const f = useQuery({ queryKey: ["flow", initial.id], queryFn: () => Promise.resolve(initial), initialData: initial, staleTime: Infinity });
  return <PublishBar flow={f.data} />;
}
const page = (f: Flow, save: (v: string) => Promise<unknown> = () => Promise.resolve()) => (
  <QueryClientProvider client={new QueryClient()}>
    <FlowDraftProvider flowId={f.id}><Values save={save} /><Bar initial={f} /></FlowDraftProvider>
  </QueryClientProvider>
);
const bar = () => within(screen.getByRole("region", { name: "Unpublished changes" }));

beforeEach(() => vi.clearAllMocks());

describe("PublishBar", () => {
  it("publish saves the waiting change first, and a second press sends no second request", async () => {
    const log: string[] = [];
    const save = vi.fn(async (v: string) => { log.push(`save ${v}`); await Promise.resolve(); log.push("saved"); });
    api.publishFlow.mockImplementation(async () => { log.push("publish"); return { ...flow, publishedVersion: 2, hasChanges: false }; });
    render(page(flow, save));
    expect(bar().getByText("Your changes are saved as a draft. New documents use version 1 until you publish.")).toBeTruthy();
    act(() => change("Invoice no"));
    const publish = bar().getByRole("button", { name: "Publish changes" });
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(await bar().findByText("Version 2 is live.")).toBeTruthy();
    expect(log).toEqual(["save Invoice no", "saved", "publish"]);
    expect(api.publishFlow).toHaveBeenCalledTimes(1);
    expect(api.publishFlow).toHaveBeenCalledWith("flow-1");
  });

  it("a refused change blocks publish and says where it is", async () => {
    const save = vi.fn().mockRejectedValue(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    render(page(flow, save));
    act(() => change("Invoice no"));
    fireEvent.click(bar().getByRole("button", { name: "Publish changes" }));
    expect(await bar().findByText("A change on We read couldn't be saved, so nothing was published.")).toBeTruthy();
    expect(bar().getByRole("link", { name: "Go to We read" })).toHaveAttribute("href", "/flows/flow-1?tab=read");
    await waitFor(() => expect(bar().getByRole("button", { name: "Publish changes" })).toBeEnabled());
    expect(api.publishFlow).not.toHaveBeenCalled();
  });

  it("an edit a check stopped blocks publish with its step and reason, until the check passes", async () => {
    api.publishFlow.mockResolvedValue({ ...flow, publishedVersion: 2, hasChanges: false });
    render(page(flow));
    act(() => block("Give every value a name."));
    fireEvent.click(bar().getByRole("button", { name: "Publish changes" }));
    expect(await bar().findByText("A change on We read couldn't be saved, so nothing was published.")).toBeTruthy();
    expect(bar().getByText("Give every value a name.")).toBeTruthy();
    expect(bar().getByRole("link", { name: "Go to We read" })).toBeTruthy();
    expect(api.publishFlow).not.toHaveBeenCalled();
    act(() => block(null));
    await waitFor(() => expect(bar().getByRole("button", { name: "Publish changes" })).toBeEnabled());
    fireEvent.click(bar().getByRole("button", { name: "Publish changes" }));
    expect(await bar().findByText("Version 2 is live.")).toBeTruthy();
    expect(api.publishFlow).toHaveBeenCalledTimes(1);
  });

  it("the bar is not drawn while the flow is unconfirmed, and on an unpublished flow it offers Publish", () => {
    const { unmount } = render(page({ ...flow, fieldsConfirmed: false }));
    expect(screen.queryByRole("region", { name: "Unpublished changes" })).toBeNull();
    unmount();
    render(page({ ...flow, publishedVersion: null, hasChanges: false }));
    expect(bar().getByText("Changes to this flow apply straight away until you publish it.")).toBeTruthy();
    expect(bar().getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(bar().queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("an older backend with no version info gets no bar", () => {
    render(page({ ...flow, publishedVersion: undefined }));
    expect(screen.queryByRole("region", { name: "Unpublished changes" })).toBeNull();
  });
});
