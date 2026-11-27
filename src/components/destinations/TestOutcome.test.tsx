import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentPage, DocumentRow } from "@/lib/api/documents";
import { TestOutcome } from "./TestOutcome";

const api = vi.hoisted(() => ({ listDocumentPage: vi.fn(), sendDocument: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const row = (id: string, fileName: string, failedAt: string | null): DocumentRow => ({
  id, fileName, failedAt, flowId: null, flowName: null, status: "send_failed", statusReason: null, pageCount: null,
  billingUnits: null, failedChecks: null, createdAt: null, source: null, sourceRef: null, number: null, sender: null,
  checks: [], sentAt: null, stop: null, isSample: false,
});
const page = (items: DocumentRow[]): DocumentPage => ({ items, totalCount: items.length, page: 1, pageSize: 50, sampleCount: 0 });
const at = new Date(2026, 5, 1, 14, 5).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 1, 15, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("TestOutcome", () => {
  it("a passing test offers Send it now for what was waiting, sends each once, and says what happened", async () => {
    api.listDocumentPage.mockResolvedValue(page([row("doc-4", "invoice-2290.pdf", new Date(2026, 5, 1, 9, 12).toISOString())]));
    let release!: () => void;
    api.sendDocument.mockImplementation(() => new Promise((r) => { release = () => r([]); }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(<QueryClientProvider client={qc}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Test file arrived at 14:05.");
    const band = await screen.findByTestId("destination-waiting");
    expect(band).toHaveTextContent("1 document is waiting for this destination.");
    expect(band).toHaveTextContent("invoice-2290.pdf couldn't be sent at 09:12. We stopped trying.");
    expect(api.listDocumentPage).toHaveBeenCalledWith({ waitingOnDestination: "dest-1", page: 1, pageSize: 50 });
    const now = within(band).getByRole("button", { name: /^Send (it|all \d+) now$/ });
    fireEvent.click(now);
    fireEvent.click(now);
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendDocument).toHaveBeenCalledWith("doc-4");
    // A list fetched while the run is still going (a refocus, say) still names what is being sent.
    const waitingKey = { queryKey: ["documents", "waiting"] };
    vi.setSystemTime(new Date(2026, 5, 1, 15, 1));
    await act(() => qc.refetchQueries(waitingKey));
    api.listDocumentPage.mockRejectedValue(new Error("offline")); // and the refetch after the run fails
    vi.setSystemTime(new Date(2026, 5, 1, 15, 2));
    release();
    expect(await screen.findByText("invoice-2290.pdf is on its way again.")).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    // Only a list fetched after the run ended is offered: not the old one, not the mid-run one.
    expect(screen.queryByRole("button", { name: /^Send (it|all \d+) now$/ })).toBeNull();
    api.listDocumentPage.mockResolvedValue(page([row("doc-4", "invoice-2290.pdf", null)]));
    vi.setSystemTime(new Date(2026, 5, 1, 15, 3));
    await act(() => qc.refetchQueries(waitingKey));
    expect(await screen.findByRole("button", { name: /^Send (it|all \d+) now$/ })).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
    cleanup();
    api.listDocumentPage.mockResolvedValue(page([row("doc-4", "invoice-2290.pdf", null), row("doc-8", "invoice-2291.pdf", null)]));
    api.sendDocument.mockReset();
    api.sendDocument.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiHttpError("refused", 409, { error: "not_ready" }));
    render(<QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    const two = await screen.findByTestId("destination-waiting");
    expect(two).toHaveTextContent("2 documents are waiting for this destination.");
    expect(two).toHaveTextContent("The latest couldn't be sent. We stopped trying.");
    fireEvent.click(within(two).getByRole("button", { name: /^Send (it|all \d+) now$/ }));
    const refused = await screen.findByRole("alert");
    expect(refused).toHaveTextContent("1 of 2 couldn't be sent again: This document can't be sent right now. Reload to see its latest state.");
    expect(within(refused).getByRole("link", { name: "Show what couldn't be sent" })).toHaveAttribute("href", "/documents?show=failed");
  });

  it("a failed test says why and how to go on, and nothing is said about waiting documents while it is not known", async () => {
    render(<QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-3" protocol="sftp" result={{ success: false, message: "The server refused the login.", responseCode: null }} error={null} at={at} place="row" /></QueryClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("The test didn't arrive: The server refused the login. Press Edit to check the details, then test again.");
    expect(api.listDocumentPage).not.toHaveBeenCalled();
    cleanup();
    // Made when asked: a rejection made up front is unhandled until its turn, which fails the run.
    const answers = [[() => new Promise(() => {}), "pending"], [() => Promise.reject(new Error("offline")), "error"]] as const;
    for (const [answer, state] of answers) {
      api.listDocumentPage.mockImplementationOnce(answer);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><TestOutcome destinationId="dest-1" protocol="email" result={{ success: true, message: null, responseCode: 250 }} error={null} at={at} place="form" /></QueryClientProvider>);
      // The failed half is asserted only once the failure has landed, so a line drawn on failure is seen.
      await waitFor(() => expect(qc.getQueryState(["documents", "waiting", "dest-1", at])?.status).toBe(state));
      await act(() => new Promise((r) => setTimeout(r, 0))); // TanStack tells the component on the next tick
      expect(api.listDocumentPage).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Test accepted by the mail server at 14:05.");
      expect(screen.queryByTestId("destination-waiting")).toBeNull();
      expect(document.body).not.toHaveTextContent(/waiting|0 documents/);
      cleanup();
      api.listDocumentPage.mockClear();
    }
  });

  it("Send it now stops at a refusal about the workspace, says what was sent and the reason once", async () => {
    const docs = ["a", "b", "c", "d"].map((f, i) => row(`doc-${i + 1}`, `${f}.pdf`, null));
    api.listDocumentPage.mockResolvedValue(page(docs));
    api.sendDocument.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiHttpError("refused", 409, { error: "not_ready" }))
      .mockRejectedValueOnce(new ApiHttpError("limit", 429, { error: "order_limit_reached" })).mockResolvedValue([]);
    render(<QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    fireEvent.click(within(await screen.findByTestId("destination-waiting")).getByRole("button", { name: /^Send (it|all \d+) now$/ }));
    const [own, stop] = await screen.findAllByRole("alert");
    expect(stop).toHaveTextContent("1 sent. You've reached your plan's document limit for this month.");
    expect(screen.getAllByText(/document limit/)).toHaveLength(1);
    expect(api.sendDocument.mock.calls).toEqual([["doc-1"], ["doc-2"], ["doc-3"]]);
    // A document refused on its own before the stop is still said for itself.
    expect(own).toHaveTextContent("1 of 2 couldn't be sent again: This document can't be sent right now.");
    cleanup();
    // Paused processing is answered 409, not 429: its machine code stops the run all the same.
    api.sendDocument.mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiHttpError("paused", 409, { error: "processing_paused" }))
      .mockResolvedValue([]);
    render(<QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    fireEvent.click(within(await screen.findByTestId("destination-waiting")).getByRole("button", { name: /^Send (it|all \d+) now$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 sent. Processing is paused on this workspace.");
    expect(api.sendDocument.mock.calls).toEqual([["doc-1"], ["doc-2"]]);
  });

  it("each test's result is scrolled into view once, as it appears", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const fail = { success: false, message: null, responseCode: null };
    const outcome = (when: number) => <QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-1" protocol="sftp" result={fail} error={null} at={when} place="row" /></QueryClientProvider>;
    const { rerender } = render(outcome(at));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toContainElement(screen.getByRole("alert"));
    rerender(outcome(at));             // a later render of the same result does not move the page
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(outcome(at + 1));         // the next press does
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
