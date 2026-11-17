import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true, useQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ listDocumentPage: vi.fn(), listFlows: vi.fn(), listLookups: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

import { CommandPalette } from "./CommandPalette";

const NAME = "Search documents, flows, lookups and actions";
const row = (n: number, sender: string | null = "Example Supplier Ltd") => ({
  id: `doc-${n}`, flowId: "f1", flowName: "Supplier invoices", fileName: `invoice-${1000 + n}.pdf`, status: "ready", statusReason: null,
  pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "", number: null, sender, checks: [], sentAt: null, failedAt: null, stop: null,
});
const page = (items: unknown[], totalCount = items.length) => ({ items, totalCount, page: 1, pageSize: 5, sampleCount: 0 });
/** Each documents request waits until the test answers it. */
let answers: { ok: (v: unknown) => void; no: (e: unknown) => void }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  answers = [];
  api.listDocumentPage.mockImplementation(() => new Promise((ok, no) => answers.push({ ok, no })));
  api.listFlows.mockResolvedValue([{ id: "f1", name: "Supplier invoices", documentCount: 23 }]);
  api.listLookups.mockResolvedValue([{ id: "l1", name: "Item codes", count: 1 }]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const onClose = vi.fn();
const onShortcuts = vi.fn();
function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommandPalette onClose={onClose} onShortcuts={onShortcuts} />
    </QueryClientProvider>,
  );
  const dialog = within(screen.getByRole("dialog", { name: NAME }));
  return { dialog, box: dialog.getByRole("combobox", { name: "Search" }) };
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const answer = (i: number, v: unknown) => act(async () => { answers[i].ok(v); await vi.advanceTimersByTimeAsync(1); });

describe("CommandPalette", () => {
  it("shows only the answer for the term on screen, one request per pause, and says Nothing found only after the server said so", async () => {
    const { dialog, box } = open();
    fireEvent.change(box, { target: { value: "inv" } });
    await wait(100);
    fireEvent.change(box, { target: { value: "invo" } });
    await wait(100);
    fireEvent.change(box, { target: { value: "invoice-1002" } });
    await wait(250);
    expect(api.listDocumentPage).not.toHaveBeenCalled();                     // not before the pause has passed
    await wait(60);
    expect(api.listDocumentPage.mock.calls).toEqual([[{ q: "invoice-1002", page: 1, pageSize: 5 }]]);
    expect(dialog.getByRole("status")).toHaveTextContent("Searching…");
    expect(dialog.queryByRole("option", { name: "invoice-1002.pdf" })).toBeNull();
    await answer(0, page([row(2)]));
    expect(dialog.getByRole("option", { name: "invoice-1002.pdf" })).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "zzz" } });
    expect(dialog.queryByRole("option", { name: "invoice-1002.pdf" })).toBeNull();   // at once, before the pause
    expect(dialog.getByRole("status")).toHaveTextContent("Searching…");
    await wait(310);
    expect(api.listDocumentPage).toHaveBeenCalledTimes(2);
    expect(dialog.queryByRole("option", { name: "invoice-1002.pdf" })).toBeNull();   // nor while the new answer is out
    expect(dialog.queryByText(/Nothing found/)).toBeNull();
    await answer(1, page([]));
    expect(dialog.getByRole("status")).toHaveTextContent("Nothing found for “zzz”.");

    fireEvent.change(box, { target: { value: "boom" } });
    await wait(310);
    await act(async () => { answers[2].no(new ApiHttpError("down", 500, null)); await vi.advanceTimersByTimeAsync(1); });
    expect(dialog.getByRole("alert")).toHaveTextContent("Documents couldn't be searched.");
    expect(within(dialog.getByRole("alert")).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(dialog.queryByText(/Nothing found/)).toBeNull();
  });

  it("lists the newest five with the total, the flows and lookups whose names match, and the three actions", async () => {
    const { dialog, box } = open();
    await wait(310);
    expect(api.listDocumentPage).not.toHaveBeenCalled();                     // a blank term asks nothing
    expect(dialog.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Actions"]);
    const actions = within(dialog.getByRole("group", { name: "Actions" })).getAllByRole("option");
    expect(actions).toHaveLength(3);
    ["Upload a document", "New flow", "Open History"].forEach((name, i) => expect(actions[i]).toHaveAccessibleName(name));

    fireEvent.change(box, { target: { value: "invoice" } });
    await wait(310);
    await answer(0, page([1, 2, 3, 4, 5].map((n) => row(n)), 23));
    const docs = within(dialog.getByRole("group", { name: "Documents, the newest 5 of 23" }));
    const first = docs.getAllByRole("option")[0];
    expect(first).toHaveAccessibleName("invoice-1001.pdf");
    expect(first).toHaveAccessibleDescription(/^From Example Supplier Ltd, in Supplier invoices/);
    expect(first).toHaveAttribute("href", "/flows/f1/documents/doc-1");
    const flow = within(dialog.getByRole("group", { name: "Flows" })).getByRole("option", { name: "Supplier invoices" });
    expect(flow).toHaveAccessibleDescription("23 documents");

    fireEvent.change(box, { target: { value: "item" } });
    await wait(310);
    await answer(1, page([]));
    expect(within(dialog.getByRole("group", { name: "Lookups" })).getByRole("option", { name: "Item codes" })).toHaveAccessibleDescription("1 row");
    expect(dialog.queryByRole("group", { name: /^Documents/ })).toBeNull();
  });

  it("a document result says what it is", async () => {
    const { dialog, box } = open();
    fireEvent.change(box, { target: { value: "7781" } });
    await wait(310);
    await answer(0, page([{ ...row(7781, "Sample Traders Ltd."), kind: "Invoice", flowId: "inbox", flowName: "New documents", inInbox: true }]));
    expect(dialog.getByRole("option", { name: "invoice-8781.pdf" })).toHaveAccessibleDescription(/^An invoice from Sample Traders Ltd, in New documents/);
  });

  it("gives focus back to what had it when it closes", async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <button type="button" onClick={() => setOn(true)}>Open search</button>
          {on && <CommandPalette onClose={() => setOn(false)} onShortcuts={onShortcuts} />}
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open search" });
    trigger.focus();
    fireEvent.click(trigger);
    await wait(50);
    const box = within(screen.getByRole("dialog", { name: NAME })).getByRole("combobox", { name: "Search" });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: "Escape" });
    await wait(1);
    expect(screen.queryByRole("dialog", { name: NAME })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("arrows move, Enter opens the highlighted result, and Ctrl K closes it", async () => {
    const { dialog, box } = open();
    await wait(50);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const active = dialog.getByRole("option", { selected: true });
    expect(active).toHaveTextContent("New flow");
    expect(box).toHaveAttribute("aria-activedescendant", active.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/flows/new");

    onClose.mockClear();                                                     // Enter closed it too
    fireEvent.keyDown(box, { key: "k", code: "KeyK", ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(box, { target: { value: "short" } });
    await wait(310);
    await answer(0, page([]));
    expect(dialog.getByRole("option", { selected: true })).toHaveTextContent("Keyboard shortcuts");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onShortcuts).toHaveBeenCalledTimes(1);
  });
});
