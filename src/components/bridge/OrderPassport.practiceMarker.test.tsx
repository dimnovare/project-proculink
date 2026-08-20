import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PassportDto } from "@/types/procurement";

// A practice order's passport rendered with no practice marker at all: the header showed
// the PO number and offered "Download order record" exactly as it does for a real
// delivery, so a shared or screenshotted practice passport was indistinguishable from a
// real one. The workshop header already solves this with <PracticeChip/>; the passport
// gets the same chip (size="sm") next to the title, and the downloaded JSON file's name
// carries a "-practice" suffix so the file itself is marked too.

const api = {
  getOrderPassport: vi.fn(),
  getDownloadUrl: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
    getDownloadUrl: (...a: unknown[]) => api.getDownloadUrl(...a),
  },
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { OrderPassport } from "./OrderPassport";

const ORDER_ID = "ord-1";

function passport(overrides: Partial<PassportDto["order"]> = {}): PassportDto {
  return {
    order: {
      id: ORDER_ID,
      poNumber: "PO-88231",
      status: "delivered",
      supplierId: "sup-1",
      supplierName: "Nordmark",
      buyerName: "Acme",
      currency: "EUR",
      orderDate: "2026-07-30",
      createdAt: "2026-07-30T09:00:00Z",
      updatedAt: "2026-07-30T09:30:00Z",
      isSample: false,
      ...overrides,
    },
    sourceArtifact: { storageKey: "org/ord-1/source.csv", detectedFormat: "csv" },
    canonical: { lineCount: 2, currency: "EUR", totalValue: 120, totalQuantity: 6 },
    supplierProfile: null,
    validationResults: [],
    mappingDecisions: [],
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: null,
    deliveryAttempts: [],
    supplierResponse: null,
    finalStatus: "delivered",
    timeline: [],
    notes: [],
  } as PassportDto;
}

function renderPassport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderPassport orderId={ORDER_ID} />
    </QueryClientProvider>,
  );
}

/** The passport header block — the region a screenshot or share is judged by. */
async function header(): Promise<HTMLElement> {
  const title = await screen.findByText("Order history");
  // h2 → title column → header row
  return title.closest("div")!.parentElement as HTMLElement;
}

afterEach(() => {
  cleanup();
  api.getOrderPassport.mockReset();
  api.getDownloadUrl.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("A practice passport is visibly a practice passport", () => {
  it("renders the practice chip in the header for a practice order", async () => {
    api.getOrderPassport.mockResolvedValue(passport({ isSample: true }));
    renderPassport();

    const head = await header();
    expect(within(head).getByText("Practice")).toBeInTheDocument();
  });

  it("shows NO practice marker for a real order (control)", async () => {
    api.getOrderPassport.mockResolvedValue(passport({ isSample: false }));
    renderPassport();

    await header();
    expect(screen.queryByText("Practice")).not.toBeInTheDocument();
    // Happy path unchanged: the download action is still offered under its normal name.
    expect(screen.getByRole("button", { name: /download order record/i })).toBeInTheDocument();
  });

  it("suffixes the downloaded JSON filename with -practice for a practice order", async () => {
    api.getOrderPassport.mockResolvedValue(passport({ isSample: true }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    renderPassport();
    fireEvent.click(await screen.findByRole("button", { name: /download order record/i }));

    await waitFor(() => expect(downloadName).toBe("passport-PO-88231-practice.json"));
  });

  it("keeps the plain filename for a real order (control)", async () => {
    api.getOrderPassport.mockResolvedValue(passport({ isSample: false }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    renderPassport();
    fireEvent.click(await screen.findByRole("button", { name: /download order record/i }));

    await waitFor(() => expect(downloadName).toBe("passport-PO-88231.json"));
  });
});
