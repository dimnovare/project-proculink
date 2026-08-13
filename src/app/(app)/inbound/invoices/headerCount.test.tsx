import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /inbound/invoices — the header count may only speak for a fetch that succeeded.
//
// THE DEFECT THIS PINS, verbatim. `invoices` is `data ?? []`, and the header's
// subtitle branched only on `isLoading`:
//
//     const subText = isLoading && !isApiMockMode
//       ? "Loading…"
//       : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`;
//
// The body DID branch on `isError` and rendered "Failed to load invoices". The header
// did not, so a failed fetch put both on screen at once — a red panel saying the load
// failed, and above it a confident "0 invoices". Of the two, the number is the one a
// reader believes, and it was the false one. Zero is a claim about what the server
// holds; it is not an acceptable fallback for "I don't know".
//
// The repair is the same shape and the same ORDER as the dead-letter list on
// src/app/(app)/operations/health/page.tsx:374 — the error branch is evaluated before
// the count, so a number on this screen can only ever mean a successful fetch.

import InvoicesPage from "./page";
import type { InvoiceDto } from "@/lib/api-client";

const getInvoices = vi.fn();

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getInvoices: (...args: unknown[]) => getInvoices(...args),
    approveInvoice: vi.fn(),
    uploadInvoice: vi.fn(),
    downloadInvoice: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  getInvoices.mockReset();
});

function invoice(i: number): InvoiceDto {
  return {
    id: `inv-${i}`,
    supplierId: null,
    supplierName: `Supplier ${i}`,
    invoiceNumber: `INV-${1000 + i}`,
    invoiceDate: "2026-05-01",
    totalAmount: 100 + i,
    currency: "EUR",
    status: "pending_review",
    lineCount: 2,
    createdAt: new Date().toISOString(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InvoicesPage />
    </QueryClientProvider>,
  );
}

/**
 * The header subtitle, read as the page lays it out rather than by scanning the
 * document for a number — the rows and the status tiles are full of digits, and a
 * page-wide text match would pass or fail for reasons that have nothing to do with
 * the header. `titleHidden` renders `<h1 class="sr-only">` and the header row as its
 * next sibling, with the subtitle as that row's first child.
 */
function headerSubText(): string {
  const h1 = screen.getByRole("heading", { name: "Invoices", level: 1 });
  const row = h1.nextElementSibling;
  if (!row) throw new Error("PageHeader rendered no subtitle/actions row");
  const sub = row.querySelector("p");
  if (!sub) throw new Error("PageHeader rendered no subtitle paragraph");
  return sub.textContent ?? "";
}

/** Any claim about how many invoices exist — "0 invoices", "3 invoices", "1 invoice". */
const COUNT_CLAIM = /\b\d+\s+invoices?\b/;

// ── The claim that shipped ───────────────────────────────────────────────────
//
// Reconstructed here so that a green result below means the page changed, not that
// the assertion drifted somewhere harmless. If this control ever stops producing
// "0 invoices" the control itself is wrong, not the page.

describe("the expression that shipped", () => {
  /** The header subtitle exactly as it was written: `isLoading` was its only branch. */
  const originalSubText = (s: { isLoading: boolean; invoices: unknown[] }) =>
    s.isLoading ? "Loading…" : `${s.invoices.length} invoice${s.invoices.length !== 1 ? "s" : ""}`;

  it("answers a failed fetch with '0 invoices'", () => {
    // isLoading is false once the query settles into error, and `data ?? []` is [].
    expect(originalSubText({ isLoading: false, invoices: [] })).toBe("0 invoices");
    expect(COUNT_CLAIM.test(originalSubText({ isLoading: false, invoices: [] }))).toBe(true);
  });
});

// ── Anti-vacuity: the count path is real ─────────────────────────────────────
//
// Every assertion below is "the header does NOT claim a count". All of them would
// pass for free against a header that had simply stopped counting, which would be a
// worse screen than the one being fixed. These two pin that it still counts, and
// counts correctly, whenever it is entitled to.

describe("a successful fetch is still counted, exactly", () => {
  it("says '0 invoices' when the server really returned none", async () => {
    getInvoices.mockResolvedValue([]);
    renderPage();
    await screen.findByText("No invoices yet");
    expect(headerSubText()).toBe("0 invoices");
  });

  it("counts what it was given, and singularises one", async () => {
    getInvoices.mockResolvedValue([invoice(0), invoice(1), invoice(2)]);
    renderPage();
    await screen.findAllByText("INV-1000");
    expect(headerSubText()).toBe("3 invoices");

    cleanup();
    getInvoices.mockResolvedValue([invoice(0)]);
    renderPage();
    await screen.findAllByText("INV-1000");
    expect(headerSubText()).toBe("1 invoice");
  });
});

// ── The defect itself ────────────────────────────────────────────────────────

describe("a failed fetch is never reported as a count", () => {
  it("does not put '0 invoices' on the same screen as the failure", async () => {
    getInvoices.mockRejectedValue(new Error("Network request failed"));
    renderPage();

    // The body's failure panel is the state under test — wait for it, so this is not
    // asserting about a page that simply has not loaded yet.
    await screen.findByText("Failed to load invoices");

    const sub = headerSubText();
    expect(sub, `the header claimed "${sub}" beside "Failed to load invoices"`).not.toMatch(
      COUNT_CLAIM,
    );
    expect(sub).toBe("Couldn't load invoices");
  });

  it("says so in the header too, rather than going silent", async () => {
    // A blank subtitle would satisfy the assertion above while telling the reader
    // nothing. The header has to carry the same news the body does.
    getInvoices.mockRejectedValue(new Error("Network request failed"));
    renderPage();
    await screen.findByText("Failed to load invoices");

    expect(headerSubText().trim().length).toBeGreaterThan(0);
  });

  it("never renders a count anywhere while the failure panel is up", async () => {
    // The property behind the two assertions above, stated once: these two things
    // may not coexist, whichever way a later edit reintroduces them.
    getInvoices.mockRejectedValue(new Error("Network request failed"));
    renderPage();
    await screen.findByText("Failed to load invoices");

    expect(screen.queryByText(COUNT_CLAIM)).toBeNull();
  });

  it("goes back to counting once the fetch succeeds", async () => {
    // The error copy must be a state, not a latch.
    getInvoices.mockRejectedValue(new Error("Network request failed"));
    renderPage();
    await screen.findByText("Failed to load invoices");
    expect(headerSubText()).toBe("Couldn't load invoices");

    cleanup();
    getInvoices.mockReset();
    getInvoices.mockResolvedValue([invoice(0), invoice(1)]);
    renderPage();
    await screen.findAllByText("INV-1000");
    await waitFor(() => expect(headerSubText()).toBe("2 invoices"));
  });
});
