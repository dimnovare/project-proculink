import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The mock engine with its inbox states (the flag is read once, when the engine module loads).
vi.hoisted(() => sessionStorage.setItem("proculink.mock.inbox", "on"));
vi.mock("@/lib/api/core", async (orig) => ({ ...(await orig<typeof import("@/lib/api/core")>()), isApiMockMode: true }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
// jsdom cannot draw a PDF; the original is not what these tests are about.
vi.mock("@/components/bridge/document/SourceDocumentBody", () => ({ SourceDocumentBody: () => null, scrollTo: () => {} }));

import { DocumentScreen } from "./DocumentScreen";

type Spy = { calls: string[]; answer?: Record<string, object> };
const spy = () => (window as unknown as { __mockEngine: Spy }).__mockEngine;
const calls = () => spy().calls;

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { __mockEngine: Spy }).__mockEngine = { calls: [] };
});

const mount = (documentId: string, flowId = "flow-inbox") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DocumentScreen flowId={flowId} documentId={documentId} />
    </QueryClientProvider>,
  );
const answers = () => screen.findByRole("region", { name: "What to do with it" });

describe("DocumentScreen, a document in the inbox", () => {
  it("an inbox document offers three answers and nothing that sends", async () => {
    const first = mount("doc-in-1");
    const panel = await answers();
    expect(within(panel).getByRole("heading", { name: "This is the first statement here." })).toBeVisible();
    expect(within(panel).getByText("Choose once where documents like this go. The next one is read and handled by itself.")).toBeVisible();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Set it up", "Excel", "CSV", "Move it"]);
    expect(screen.getByTestId("review-sub")).toHaveTextContent(/^Added by upload/);
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /send/i })).toBeNull();
    expect(screen.queryByText(/Teach|Point to it|Something missing/)).toBeNull();
    expect(calls().filter((c) => c.startsWith("GET /flows/flow-inbox"))).toEqual([]);
    first.unmount();

    // Not known whether it is in the inbox: neither the answers nor Send, and a way to ask again.
    spy().answer = { "GET /inbox": { refuse: [503, "unavailable"] } };
    mount("doc-1", "flow-1");
    expect(await screen.findByText("We couldn't check where this document is.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "What to do with it" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("pressing twice sets up one flow, and nothing else can be pressed while it runs", async () => {
    mount("doc-in-1");
    const panel = await answers();
    const setUp = within(panel).getByRole("button", { name: "Set it up" });
    fireEvent.click(setUp);
    fireEvent.click(setUp);
    expect(within(panel).getByRole("button", { name: "Download what we read as CSV" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Download what we read as Excel" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Move it" })).toBeDisabled();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringMatching(/^\/flows\/new\?step=send&flow=flow-set-up-\d+&doc=doc-in-1$/)));
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(calls().filter((c) => c.includes("/set-up"))).toHaveLength(1);
    expect(calls().filter((c) => c.startsWith("POST") && c.includes("/outputs"))).toEqual([]); // the server makes the CSV file (P3)
  });

  it("several flows fit: Move it comes first and nothing says it is new", async () => {
    mount("doc-in-2");
    const panel = await answers();
    expect(within(panel).getByRole("heading", { name: "Which flow does this invoice belong with?" })).toBeVisible();
    expect(within(panel).queryByText(/first/)).toBeNull();
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Move it", "Set it up", "Excel", "CSV"]);
    const list = within(panel).getByRole("combobox", { name: "Flow it belongs with" });
    // The flows that fit first, then the others; none chosen.
    await waitFor(() => expect(within(list).getAllByRole("option").slice(0, 3).map((o) => o.textContent))
      .toEqual(["Choose a flow", "Remittance advices", "Supplier invoices"]));
    expect(within(list).getByRole("option", { name: "Delivery notes" })).toBeTruthy();
    expect(list).toHaveValue("");
    expect(within(panel).getByRole("button", { name: "Move it" })).toBeDisabled();
    fireEvent.change(list, { target: { value: "flow-4" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Move it" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/flows/flow-4/documents/doc-in-2"));
    expect(calls().filter((c) => c.startsWith("POST /documents/doc-in-2/move"))).toEqual(['POST /documents/doc-in-2/move {"flowId":"flow-4"}']);
  });

  it("a sort that is not certain says where it went and can be moved, and Send stays", async () => {
    mount("doc-in-3", "flow-2");
    expect(await screen.findByText("We put this with Delivery notes. Check that is right.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "What to do with it" })).toBeNull();
    const list = screen.getByRole("combobox", { name: "Another flow" });
    await waitFor(() => expect(within(list).getByRole("option", { name: "Supplier invoices" })).toBeTruthy());
    expect(within(list).queryByRole("option", { name: "Delivery notes" })).toBeNull();
    expect(list).toHaveValue("");
    expect(document.getElementById("review-send")).toBeEnabled();
    fireEvent.change(list, { target: { value: "flow-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/flows/flow-1/documents/doc-in-3"));
    expect(calls().filter((c) => c.startsWith("POST /documents/doc-in-3/move"))).toEqual(['POST /documents/doc-in-3/move {"flowId":"flow-1"}']);
  });
});
