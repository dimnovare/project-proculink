import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import type { Flow } from "@/lib/api/documents";
import { FlowDraftProvider, useDraftPart, useFlowDraft } from "./flowDraft";
import { FlowVersionsPanel } from "./FlowVersionsPanel";
import { PublishBar, barPending } from "./PublishBar";

const api = vi.hoisted(() => ({ publishFlow: vi.fn(), restoreFlowVersion: vi.fn(), listFlowVersions: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

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
/** What a refetch of the flow answers; a discard or restore changes it, as the server would. */
let server: Flow;
/** The bar reads the flow from the cache, as the page does, so a publish's answer reaches it. */
function Bar({ initial }: { initial: Flow }) {
  const f = useQuery({ queryKey: ["flow", initial.id], queryFn: () => Promise.resolve(server), initialData: initial, staleTime: Infinity });
  return <PublishBar flow={f.data} />;
}
/** An editor as the page keys it: on the draft's revision, starting from the flow the cache holds. */
function NameInput() {
  const qc = useQueryClient();
  const [v, setV] = useState(() => qc.getQueryData<Flow>(["flow", "flow-1"])!.name);
  return <input aria-label="Name" value={v} onChange={(e) => { setV(e.target.value); change(e.target.value); }} />;
}
function Editors() {
  const { revision, bump } = useFlowDraft();
  return <><NameInput key={revision} /><FlowVersionsPanel flowId="flow-1" onRestored={bump} /></>;
}
let client: QueryClient;
const page = (f: Flow, save: (v: string) => Promise<unknown> = () => Promise.resolve(), editors?: boolean) => (
  <QueryClientProvider client={(client = new QueryClient())}>
    <FlowDraftProvider flowId={f.id}><Values save={save} /><Bar initial={f} />{editors && <Editors />}</FlowDraftProvider>
  </QueryClientProvider>
);
const bar = () => within(screen.getByRole("region", { name: "Changes not in use yet" }));
const renderBar = (over: Partial<Flow>) => render(page({ ...flow, ...over }));

beforeEach(() => {
  vi.clearAllMocks();
  server = flow;
  vi.stubGlobal("confirm", vi.fn(() => true));
  api.listFlowVersions.mockResolvedValue([
    { versionNo: 1, publishedAt: "2026-11-01T10:00:00Z", publishedBy: null, live: true },
    { versionNo: 0, publishedAt: "2026-10-01T10:00:00Z", publishedBy: null, live: false },
  ]);
});

describe("PublishBar", () => {
  it("publish saves the waiting change first, and a second press sends no second request", async () => {
    const log: string[] = [];
    const save = vi.fn(async (v: string) => { log.push(`save ${v}`); await Promise.resolve(); log.push("saved"); });
    api.publishFlow.mockImplementation(async () => { log.push("publish"); return { ...flow, publishedVersion: 2, hasChanges: false }; });
    render(page(flow, save));
    client.setQueryData(["outputs", "flow-1", "published"], [{ id: "out-1" }]);
    act(() => change("Invoice no"));
    const publish = bar().getByRole("button", { name: "Use these changes" });
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(await bar().findByText("Your changes are in use.")).toBeTruthy();
    // The live list from before the use is gone, so no file's count can be drawn from it.
    expect(client.getQueryData(["outputs", "flow-1", "published"])).toBeUndefined();
    expect(log).toEqual(["save Invoice no", "saved", "publish"]);
    expect(api.publishFlow).toHaveBeenCalledTimes(1);
    expect(api.publishFlow).toHaveBeenCalledWith("flow-1");
  });

  it("a refused change blocks publish and says where it is", async () => {
    const save = vi.fn().mockRejectedValue(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    render(page(flow, save));
    act(() => change("Invoice no"));
    fireEvent.click(bar().getByRole("button", { name: "Use these changes" }));
    expect(await bar().findByText("A change on We read couldn't be saved, so nothing was put in use.")).toBeTruthy();
    expect(bar().getByRole("link", { name: "Go to We read" })).toHaveAttribute("href", "/flows/flow-1?tab=read");
    await waitFor(() => expect(bar().getByRole("button", { name: "Use these changes" })).toBeEnabled());
    expect(api.publishFlow).not.toHaveBeenCalled();
  });

  it("an edit a check stopped blocks publish with its step and reason, until the check passes", async () => {
    api.publishFlow.mockResolvedValue({ ...flow, publishedVersion: 2, hasChanges: false });
    render(page(flow));
    act(() => block("Give every value a name."));
    fireEvent.click(bar().getByRole("button", { name: "Use these changes" }));
    expect(await bar().findByText("A change on We read couldn't be saved, so nothing was put in use.")).toBeTruthy();
    expect(bar().getByText("Give every value a name.")).toBeTruthy();
    expect(bar().getByRole("link", { name: "Go to We read" })).toBeTruthy();
    expect(api.publishFlow).not.toHaveBeenCalled();
    act(() => block(null));
    await waitFor(() => expect(bar().getByRole("button", { name: "Use these changes" })).toBeEnabled());
    fireEvent.click(bar().getByRole("button", { name: "Use these changes" }));
    expect(await bar().findByText("Your changes are in use.")).toBeTruthy();
    expect(api.publishFlow).toHaveBeenCalledTimes(1);
  });

  it("Undo my changes asks, restores the published version, never sends what was typed, and the editors show the server's state", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    api.restoreFlowVersion.mockImplementation(async () => (server = { ...flow, hasChanges: false }));
    render(page(flow, save, true));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Supplier bills" } });
    fireEvent.click(bar().getByRole("button", { name: "Undo my changes" }));
    expect(await screen.findByText("Your changes are undone.")).toBeTruthy();
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain("The flow goes back to the setup in use. This can't be undone.");
    expect(api.restoreFlowVersion).toHaveBeenCalledWith("flow-1", 1);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Supplier invoices");
    expect(save).not.toHaveBeenCalled();
  });

  it("a restore of an earlier version puts the editors on it, in place of what was typed", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    api.restoreFlowVersion.mockResolvedValue({ ...flow, name: "Older invoices" });
    render(page(flow, save, true));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Supplier bills" } });
    fireEvent.click(within((await screen.findByText("Version 0")).closest("li")!).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Older invoices"));
    expect(api.restoreFlowVersion).toHaveBeenCalledWith("flow-1", 0);
  });

  it("a published flow with changes says they are not in use, with one way to use them and one to undo", async () => {
    api.publishFlow.mockResolvedValue({ ...flow, publishedVersion: 4, hasChanges: false });
    renderBar({ fieldsConfirmed: true, publishedVersion: 3, hasChanges: true });
    const region = within(screen.getByRole("region", { name: "Changes not in use yet" }));
    expect(region.getByText("Your changes aren't in use yet.")).toBeInTheDocument();
    expect(region.getByText("New documents still follow the last saved setup.")).toBeInTheDocument();
    expect(region.getAllByRole("button").map((b) => b.textContent)).toEqual(["Undo my changes", "Use these changes"]);
    fireEvent.click(region.getByRole("button", { name: "Use these changes" }));
    expect(await screen.findByText("Your changes are in use.")).toBeInTheDocument();
  });

  it("before the first save, one button saves the setup; unconfirmed, there is no bar", async () => {
    const { unmount } = renderBar({ fieldsConfirmed: false });
    expect(screen.queryByRole("region")).toBeNull();
    unmount();
    api.publishFlow.mockResolvedValue({ ...flow, publishedVersion: 1, hasChanges: false });
    renderBar({ fieldsConfirmed: true, publishedVersion: null, hasChanges: false });
    expect(screen.getByText("Changes to this flow are in use straight away until you save this setup.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Changes not in use yet" })).toBeNull();   // nothing waits before the first save
    const unsaved = within(screen.getByRole("region", { name: "Save this setup" }));
    expect(unsaved.getAllByRole("button").map((b) => b.textContent)).toEqual(["Save this setup"]);
    expect(barPending({ fieldsConfirmed: true, publishedVersion: undefined } as Flow)).toBe(false);
    fireEvent.click(unsaved.getByRole("button", { name: "Save this setup" }));
    expect(await screen.findByText("Setup saved. Later changes wait until you use them.")).toBeInTheDocument();
  });

  it("an older backend with no version info gets no bar", () => {
    render(page({ ...flow, publishedVersion: undefined }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a refused use of the changes says why, never that they are in use", async () => {
    const refusal = new ApiHttpError("conflict", 409, { error: "nothing_to_publish" });
    api.publishFlow.mockRejectedValue(refusal);
    render(page(flow));
    fireEvent.click(bar().getByRole("button", { name: "Use these changes" }));
    expect(await bar().findByText(documentRefusalMessage(refusal))).toBeInTheDocument();
    expect(screen.queryByText("Your changes are in use.")).toBeNull();
  });
});
