import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
});

describe("TestOutcome", () => {
  it("a passing test offers Send it now for what was waiting, sends each once, and says what happened", async () => {
    api.listDocumentPage.mockResolvedValue(page([row("doc-4", "invoice-2290.pdf", new Date(2026, 5, 1, 9, 12).toISOString())]));
    let release!: () => void;
    api.sendDocument.mockImplementation(() => new Promise((r) => { release = () => r([]); }));
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(<QueryClientProvider client={qc}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Test file arrived at 14:05.");
    const band = await screen.findByTestId("destination-waiting");
    expect(band).toHaveTextContent("1 document was waiting for this destination.");
    expect(band).toHaveTextContent("invoice-2290.pdf couldn't be sent at 09:12. We stopped trying.");
    expect(api.listDocumentPage).toHaveBeenCalledWith({ waitingOnDestination: "dest-1", page: 1, pageSize: 50 });
    const now = within(band).getByRole("button", { name: "Send it now" });
    fireEvent.click(now);
    fireEvent.click(now);
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendDocument).toHaveBeenCalledWith("doc-4");
    release();
    expect(await screen.findByText("invoice-2290.pdf is on its way again.")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
    cleanup();
    api.listDocumentPage.mockResolvedValue(page([row("doc-4", "invoice-2290.pdf", null), row("doc-8", "invoice-2291.pdf", null)]));
    api.sendDocument.mockReset();
    api.sendDocument.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiHttpError("refused", 409, { error: "not_ready" }));
    render(<QueryClientProvider client={new QueryClient()}><TestOutcome destinationId="dest-1" protocol="sftp" result={{ success: true, message: null, responseCode: null }} error={null} at={at} place="form" /></QueryClientProvider>);
    const two = await screen.findByTestId("destination-waiting");
    expect(two).toHaveTextContent("2 documents were waiting for this destination.");
    expect(two).toHaveTextContent("The latest couldn't be sent. We stopped trying.");
    fireEvent.click(within(two).getByRole("button", { name: "Send it now" }));
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
    for (const answer of [() => new Promise(() => {}), () => Promise.reject(new Error("offline"))]) {
      api.listDocumentPage.mockImplementationOnce(answer);
      render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TestOutcome destinationId="dest-1" protocol="email" result={{ success: true, message: null, responseCode: 250 }} error={null} at={at} place="form" /></QueryClientProvider>);
      await waitFor(() => expect(api.listDocumentPage).toHaveBeenCalled());
      expect(screen.getByRole("status")).toHaveTextContent("Test file arrived at 14:05.");
      expect(screen.queryByTestId("destination-waiting")).toBeNull();
      expect(document.body).not.toHaveTextContent(/waiting|0 documents/);
      cleanup();
      api.listDocumentPage.mockClear();
    }
  });
});
