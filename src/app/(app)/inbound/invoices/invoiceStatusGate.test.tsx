import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /inbound/invoices — the status-gate guard.
//
// THE DEFECT THIS PINS, verbatim. The page gated on the literal `"pending"` in three
// places (the row dot, the Approve button, the "Pending review" tile). The backend has
// never written that value: a parsed invoice is `"pending_review"`
// (ProcuLink.Infrastructure/Services/InvoiceService.cs:68). So the tile reported 0 beside
// N rows, and the only control left visible was the CSV export, which the backend refuses
// for anything that is not `"approved"` (InvoiceService.cs:175). The screen could not be
// used for the one thing it exists to do.
//
// EVERY ASSERTION BELOW IS DERIVED FROM src/lib/invoiceStatusManifest.ts, never from a
// status literal. That is deliberate and it is the point: a test that re-typed
// `"pending_review"` on its own side would pass just as happily if both sides were wrong
// together, which is exactly how the mirror drift that produced this bug survived
// review. The manifest is diffed against the real C# by src/test/backendMirror.test.ts,
// so these tests inherit that anchoring rather than inventing their own.
//
// The literal `"pending"` appears in this file ONLY as the defect's own value, asserted
// to be a stranger to the vocabulary.

import InvoicesPage from "./page";
import {
  APPROVABLE_INVOICE_STATUSES,
  DOWNLOADABLE_INVOICE_STATUSES,
  INVOICE_STATUSES,
  INVOICE_STATUS_FACTS,
  UNRECOGNISED_INVOICE_LABEL,
  canApproveInvoice,
  canDownloadInvoice,
  invoiceStatusFact,
  invoiceStatusLabel,
  summariseInvoiceStatuses,
} from "@/lib/invoiceStatusManifest";
import type { InvoiceDto } from "@/lib/api-client";

/** The status the page used to gate on. No backend writer produces it. */
const THE_BUG = "pending";

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

function invoice(status: string, i: number): InvoiceDto {
  return {
    id: `inv-${i}`,
    supplierId: null,
    supplierName: `Supplier ${i}`,
    invoiceNumber: `INV-${1000 + i}`,
    invoiceDate: "2026-05-01",
    totalAmount: 100 + i,
    currency: "EUR",
    status,
    lineCount: 2,
    createdAt: new Date().toISOString(),
  };
}

async function renderWith(statuses: readonly string[]) {
  getInvoices.mockResolvedValue(statuses.map((s, i) => invoice(s, i)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InvoicesPage />
    </QueryClientProvider>,
  );
  // The desktop table and the mobile card list BOTH render, so every row query is
  // scoped to the table to keep matches single. The table is found via a real cell
  // rather than by role: the loading skeleton is also a <table>, so `findByRole`
  // resolves before the data ever arrives.
  const cells = await screen.findAllByText("INV-1000");
  const table = cells.map((c) => c.closest("table")).find((t): t is HTMLTableElement => t !== null);
  if (!table) throw new Error("invoices rendered no desktop table");
  return table as HTMLElement;
}

/** The row for invoice `i`, found by its invoice number rather than by index. */
function rowFor(table: HTMLElement, i: number): HTMLElement {
  const cell = within(table).getByText(`INV-${1000 + i}`);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for INV-${1000 + i}`);
  return row as HTMLElement;
}

// ── Anti-vacuity ─────────────────────────────────────────────────────────────
//
// Every sweep below iterates INVOICE_STATUSES. A sweep over an empty list passes every
// negative assertion it contains for free, so the list's SIZE is pinned here first. This
// repo has shipped that exact vacuous shape before.

describe("the vocabulary being exercised is real and non-empty", () => {
  it("has the five statuses the backend writes, no more and no fewer", () => {
    expect(INVOICE_STATUSES).toHaveLength(5);
    expect(INVOICE_STATUS_FACTS).toHaveLength(INVOICE_STATUSES.length);
    expect(new Set(INVOICE_STATUSES).size, "a status is listed twice").toBe(INVOICE_STATUSES.length);
  });

  it("offers at least one approvable and one downloadable status", () => {
    // Without this, "no status may be approved" would satisfy the sweeps below and the
    // screen would be just as unusable as the bug it replaces — silently, and green.
    expect(APPROVABLE_INVOICE_STATUSES.length).toBeGreaterThan(0);
    expect(DOWNLOADABLE_INVOICE_STATUSES.length).toBeGreaterThan(0);
  });

  it("cites a real backend file:line and a note for every status", () => {
    for (const fact of INVOICE_STATUS_FACTS) {
      expect(fact.backendSite, `${fact.status} cites no backend site`).toMatch(
        /^ProcuLink\.[\w.]+\/[\w./]+\.cs:\d+$/,
      );
      expect(fact.note.length, `${fact.status} has no note`).toBeGreaterThan(20);
      expect(fact.label.length, `${fact.status} has no operator-facing label`).toBeGreaterThan(0);
      expect(fact.label, `${fact.status} shows the raw wire value as its label`).not.toBe(fact.status);
    }
  });
});

// ── The defect itself ────────────────────────────────────────────────────────

describe("the status the page used to gate on is not a status", () => {
  it("is unknown to the manifest", () => {
    expect(invoiceStatusFact(THE_BUG)).toBeNull();
    expect(INVOICE_STATUSES).not.toContain(THE_BUG);
  });

  it("offers no action, because an unplaceable row is where the UI knows least", () => {
    expect(canApproveInvoice(THE_BUG)).toBe(false);
    expect(canDownloadInvoice(THE_BUG)).toBe(false);
  });

  it("renders no Approve button and a disabled export", async () => {
    const table = await renderWith([THE_BUG]);
    const row = rowFor(table, 0);
    expect(within(row).queryByRole("button", { name: /approve/i })).toBeNull();
    expect(within(row).getByRole("button", { name: /CSV/i })).toBeDisabled();
  });

  it("is counted in its own tile instead of vanishing", async () => {
    // The original symptom was a counter that did not add up. An unknown status must
    // never be silently dropped from the summary — that is the same lie, one level down.
    const tallies = summariseInvoiceStatuses([THE_BUG]);
    const unrecognised = tallies.find((t) => t.status === null);
    expect(unrecognised?.count).toBe(1);
    expect(unrecognised?.label).toBe(UNRECOGNISED_INVOICE_LABEL);
  });
});

// ── What the backend really writes must work ─────────────────────────────────

describe("every status the backend writes lights its row and is counted", () => {
  it("renders one row per status, each with a human label and never the raw value", async () => {
    const table = await renderWith(INVOICE_STATUSES);
    expect(within(table).getAllByRole("row")).toHaveLength(INVOICE_STATUSES.length + 1); // + header

    INVOICE_STATUSES.forEach((status, i) => {
      const row = rowFor(table, i);
      expect(within(row).getByText(invoiceStatusLabel(status))).toBeTruthy();
      expect(
        within(row).queryByText(status),
        `${status} leaked its raw wire value onto the screen`,
      ).toBeNull();
    });
  });

  it("counts every status, and the tiles sum to the number of rows on screen", async () => {
    // THE ORIGINAL SYMPTOM, inverted into a property: a tile reading 0 beside N rows is
    // now impossible without breaking this sum.
    const statuses = [...INVOICE_STATUSES, ...APPROVABLE_INVOICE_STATUSES];
    const tallies = summariseInvoiceStatuses(statuses);

    expect(tallies.reduce((n, t) => n + t.count, 0)).toBe(statuses.length);
    for (const fact of INVOICE_STATUS_FACTS) {
      const tile = tallies.find((t) => t.status === fact.status);
      expect(tile, `${fact.status} has no summary tile`).toBeDefined();
      expect(tile!.count, `${fact.status} counted wrong`).toBe(
        statuses.filter((s) => s === fact.status).length,
      );
    }
    // Nothing real fell into the unrecognised bucket.
    expect(tallies.find((t) => t.status === null)).toBeUndefined();
  });

  it("shows a non-zero count for the review state, on screen", async () => {
    const reviewable = APPROVABLE_INVOICE_STATUSES[0];
    const label = invoiceStatusLabel(reviewable);
    await renderWith([reviewable, reviewable, "approved"]);

    // Scoped to the summary row, because the same label is also the row badge — and
    // read out of the tile that carries it, rather than trusting that some "2" exists
    // somewhere on the page. The count reading 0 here beside visible rows IS the bug.
    const summary = screen.getByRole("group", { name: /invoice status summary/i });
    const tile = within(summary).getByText(label).closest("div");
    expect(tile).toBeTruthy();
    expect(within(tile as HTMLElement).getByText("2")).toBeTruthy();
    expect(within(tile as HTMLElement).queryByText("0")).toBeNull();
  });
});

describe("Approve is offered exactly where the backend means it", () => {
  it.each(INVOICE_STATUSES)("%s: the button matches the manifest", async (status) => {
    const table = await renderWith([status]);
    const row = rowFor(table, 0);
    const button = within(row).queryByRole("button", { name: /approve/i });

    if (canApproveInvoice(status)) {
      expect(button, `${status} is approvable but offers no Approve button`).not.toBeNull();
      expect(button).toBeEnabled();
    } else {
      expect(button, `${status} is not approvable but offers an Approve button`).toBeNull();
    }
  });

  it("offers it on the real review status — the whole point of the screen", async () => {
    // Named separately from the sweep so that an APPROVABLE set that shrank to empty
    // fails here loudly rather than making the sweep above vacuously true.
    const table = await renderWith(APPROVABLE_INVOICE_STATUSES);
    expect(APPROVABLE_INVOICE_STATUSES.length).toBeGreaterThan(0);
    APPROVABLE_INVOICE_STATUSES.forEach((_, i) => {
      expect(within(rowFor(table, i)).getByRole("button", { name: /approve/i })).toBeEnabled();
    });
  });
});

describe("the export is offered only where the endpoint answers 2xx", () => {
  it.each(INVOICE_STATUSES)("%s: the button matches the backend guard", async (status) => {
    // InvoiceService.ForwardAsync refuses anything but `approved` with a 400. Offering
    // it anywhere else is the audit's "the only visible button 400s by design".
    const table = await renderWith([status]);
    const button = within(rowFor(table, 0)).getByRole("button", { name: /CSV/i });

    if (canDownloadInvoice(status)) {
      expect(button, `${status} is downloadable but the export is disabled`).toBeEnabled();
    } else {
      expect(button, `${status} would 400 but the export is offered`).toBeDisabled();
    }
  });
});
