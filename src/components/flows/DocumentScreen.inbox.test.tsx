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
import { getDocument } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";

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
    // Nothing is set up and nothing is sent from here, so no check says either.
    expect(screen.queryByText(/have not been confirmed|never stop you sending/)).toBeNull();
    // P15: the flow route refuses the inbox (404 flow_not_found), and only then is the inbox asked.
    expect(calls().filter((c) => c === "GET /flows/flow-inbox" || c === "GET /inbox")).toEqual(["GET /flows/flow-inbox", "GET /inbox"]);
    first.unmount();

    // Not known whether it is in the inbox: neither the answers nor Send, and a way to ask again.
    spy().answer = { "GET /inbox": { refuse: [503, "unavailable"] } };
    mount("doc-in-1");
    expect(await screen.findByText("We couldn't check where this document is.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "What to do with it" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("a document in a flow shows Send without asking the inbox, even when the inbox route fails", async () => {
    spy().answer = { "GET /inbox": { refuse: [503, "unavailable"] } };
    mount("doc-1", "flow-1");
    await waitFor(() => expect(document.getElementById("review-send")).toBeEnabled());
    expect(screen.queryByText("We couldn't check where this document is.")).toBeNull();
    expect(calls()).not.toContain("GET /inbox");
  });

  it("any failed flow request asks the inbox: an inbox document is answered, never sent; a flow it does not hold is gone", async () => {
    spy().answer = { "GET /flows/flow-inbox": { refuse: [500, "server_error"] } };
    const first = mount("doc-in-1");
    await answers();
    expect(calls()).toContain("GET /inbox");
    expect(document.getElementById("review-send")).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    first.unmount();

    spy().answer = { "GET /flows/flow-inbox": { refuse: [404, "flow_not_found"] }, "GET /inbox": { flowId: "flow-other", address: null, intakeId: null } };
    mount("doc-in-1");
    expect(await screen.findByText(COPY.flow_not_found)).toBeVisible();
    expect(document.getElementById("review-send")).toBeNull();
    expect(screen.queryByRole("heading", { name: "What we'll send" })).toBeNull();
    expect(screen.queryByRole("region", { name: "What to do with it" })).toBeNull();
  });

  it("a correction is saved before a download, and the rate limiter's sentence is shown as it is", async () => {
    const LIMIT = "Rate limit exceeded. Please slow down and retry shortly.";
    spy().answer = { "POST /documents/doc-in-1/download": { refuse: [429, LIMIT] } };
    mount("doc-in-1");
    const panel = await answers();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Corrected" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Download what we read as Excel" }));
    expect(await within(panel).findByText(LIMIT)).toBeVisible();
    const order = calls().filter((c) => c.startsWith("PATCH /documents/doc-in-1/values") || c.startsWith("POST /documents/doc-in-1/download")).map((c) => c.split(" ")[0]);
    expect(order).toEqual(["PATCH", "POST"]);
  });

  it("a press the document outran says it changed, and shows it as it is now", async () => {
    mount("doc-in-1");
    await answers();
    const now = await getDocument("doc-in-1");
    // Someone put it with a flow meanwhile: the server refuses, and the document is now in Supplier invoices.
    spy().answer = {
      "POST /documents/doc-in-1/set-up": { refuse: [409, "not_in_inbox"] },
      "GET /documents/doc-in-1": { ...now, summary: { ...now.summary, flowId: "flow-1", flowName: "Supplier invoices", statusReason: null, inInbox: false } },
    };
    fireEvent.click(within(await answers()).getByRole("button", { name: "Set it up" }));
    expect(await screen.findByText("This document changed while you were looking at it. This is how it is now.")).toBeVisible();
    await waitFor(() => expect(document.getElementById("review-send")).toBeEnabled());
    expect(screen.queryByRole("region", { name: "What to do with it" })).toBeNull();
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
    expect(within(panel).queryByText(/the first/i)).toBeNull(); // "Choose a flow first." is the move list's hint, not "new"
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
    // flow-4 already has this file: it is held there, with the way on, although its values were read.
    expect(await screen.findByRole("button", { name: "Read it anyway" })).toBeEnabled();
    expect(screen.getAllByText("This file was already uploaded to this flow.")[0]).toBeVisible();
  });

  it("a sort that is not certain says where it went and can be moved, and Send stays", async () => {
    // The person's flows did not load: say so, never a list with only "Choose a flow".
    spy().answer = { "GET /flows": { refuse: [503, "unavailable"] } };
    const failed = mount("doc-in-3", "flow-2");
    // flowsQuery retries twice before it reports the failure.
    expect(await screen.findByText("We couldn't load your flows.", undefined, { timeout: 8000 })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Another flow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    failed.unmount();
    spy().answer = {};

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
