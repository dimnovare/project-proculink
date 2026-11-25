import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PeppolReceiverLine } from "./PeppolReceiverLine";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const api = vi.hoisted(() => ({ getPeppolReceiver: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const ID = "0208:0000000097";
const r = (status: string, more: object = {}) => ({ status, participant: ID, derived: false, invoice: null, creditNote: null, ...more });
const renderLine = (creditNote = false) =>
  render(<QueryClientProvider client={new QueryClient()}><PeppolReceiverLine documentId="d" creditNote={creditNote} /></QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe("PeppolReceiverLine", () => {
  it.each([
    [r("found", { invoice: true }), false, `This buyer can receive Peppol invoices (${ID}).`],
    [r("found", { invoice: false, creditNote: true }), false, `This buyer is on Peppol (${ID}) but doesn't receive Peppol invoices.`],
    [r("found", { invoice: true, creditNote: true }), true, `This buyer can receive Peppol credit notes (${ID}).`],
    [r("found", { invoice: true, derived: true }), false,
      `This buyer can receive Peppol invoices as ${ID}, found from their VAT number. Add it as the Receiver Peppol ID so the invoice is addressed to them.`],
    [r("not_found"), false, `This buyer wasn't found on Peppol (${ID}). Check the Receiver Peppol ID, or send another way.`],
    [r("not_found", { derived: true }), false, `No Receiver Peppol ID was read, and the buyer wasn't found on Peppol from their VAT number (${ID}).`],
    [r("no_id", { participant: null }), false, "No Receiver Peppol ID was read, so we can't check whether this buyer is on Peppol."],
    [r("invalid_id", { participant: "BE 0123" }), false, `"BE 0123" isn't a Peppol ID. It looks like 0208:0123456789: a four-digit scheme, a colon, then the number.`],
  ])("says %j", async (answer, creditNote, words) => {
    api.getPeppolReceiver.mockResolvedValue(answer);
    renderLine(creditNote);
    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it.each([
    ["a failed request", () => api.getPeppolReceiver.mockRejectedValue(new Error("boom"))],
    ["a status this build does not know", () => api.getPeppolReceiver.mockResolvedValue(r("maybe"))],
    ["a found without a yes or no", () => api.getPeppolReceiver.mockResolvedValue(r("found"))],
  ])("treats %s as couldn't check, never a negative", async (_name, arrange) => {
    arrange();
    renderLine();
    expect(await screen.findByText("We couldn't check Peppol right now.")).toBeInTheDocument();
    expect(screen.queryByText(/wasn't found|doesn't receive/)).toBeNull();
  });
});
