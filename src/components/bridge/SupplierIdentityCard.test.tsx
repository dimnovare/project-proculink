import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

/* =====================================================================
   The supplier identity fields (PR #70's new columns): VAT number,
   registration number, EDI/GLN code, primary domain.

   They are the right-hand side of supplier auto-detect — what an incoming
   document's numbers get compared against. They are ALSO patch-style on
   PUT /api/suppliers/{id}: null means "leave it", empty string means
   "clear it", so this form always sends strings and never nulls.
   ===================================================================== */

const api = {
  getSuppliers: vi.fn(),
  renameSupplier: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    renameSupplier: (...a: unknown[]) => api.renameSupplier(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));

import { SupplierIdentityCard } from "./SupplierIdentityCard";

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup-1",
    name: "FastParts Inc",
    vatNumber: "DE123456789",
    registrationNumber: "HRB 123456",
    ediCode: "5412345000176",
    primaryDomain: "fastparts.com",
    ...over,
  };
}

function renderCard(id = "sup-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierIdentityCard supplierId={id} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.getSuppliers.mockReset();
  api.renameSupplier.mockReset();
});

describe("SupplierIdentityCard", () => {
  it("shows the identity values already saved for this supplier", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);

    renderCard();

    expect(await screen.findByLabelText(/VAT number/i)).toHaveValue("DE123456789");
    expect(screen.getByLabelText(/registration number/i)).toHaveValue("HRB 123456");
    expect(screen.getByLabelText(/EDI/i)).toHaveValue("5412345000176");
    expect(screen.getByLabelText(/primary domain/i)).toHaveValue("fastparts.com");
  });

  it("says plainly what the fields are for, without claiming they are AI", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);

    renderCard();

    expect(await screen.findByText(/used to recognise documents from this supplier/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
  });

  it("starts empty for a supplier that has none of them", async () => {
    api.getSuppliers.mockResolvedValue([
      supplier({ vatNumber: null, registrationNumber: null, ediCode: null, primaryDomain: null }),
    ]);

    renderCard();

    expect(await screen.findByLabelText(/VAT number/i)).toHaveValue("");
    expect(screen.getByLabelText(/primary domain/i)).toHaveValue("");
  });

  it("saves every identity field through the supplier update path, alongside the name", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);
    api.renameSupplier.mockResolvedValue(supplier({ vatNumber: "EE101234567" }));

    renderCard();

    const vat = await screen.findByLabelText(/VAT number/i);
    fireEvent.change(vat, { target: { value: "EE101234567" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(api.renameSupplier).toHaveBeenCalledWith("sup-1", {
        name: "FastParts Inc",
        vatNumber: "EE101234567",
        registrationNumber: "HRB 123456",
        ediCode: "5412345000176",
        primaryDomain: "fastparts.com",
      }),
    );
  });

  it("sends an emptied field as an empty string, which is how the API is told to clear it", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);
    api.renameSupplier.mockResolvedValue(supplier({ ediCode: null }));

    renderCard();

    fireEvent.change(await screen.findByLabelText(/EDI/i), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(api.renameSupplier).toHaveBeenCalledWith("sup-1", expect.objectContaining({ ediCode: "" })),
    );
  });

  it("confirms the save, and shows what came back", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);
    api.renameSupplier.mockResolvedValue(supplier({ primaryDomain: "fastparts.de" }));

    renderCard();

    fireEvent.change(await screen.findByLabelText(/primary domain/i), {
      target: { value: "HTTPS://WWW.FastParts.de/" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    // The backend normalises the domain; the form must show what was stored, not
    // what was typed, or the operator is looking at a value that does not exist.
    await waitFor(() => expect(screen.getByLabelText(/primary domain/i)).toHaveValue("fastparts.de"));
  });

  it("reports a failed save instead of pretending it worked", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);
    api.renameSupplier.mockRejectedValue(new Error("A supplier named 'FastParts Inc' already exists."));

    renderCard();

    fireEvent.change(await screen.findByLabelText(/VAT number/i), { target: { value: "EE1" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it("renders nothing for a supplier it cannot resolve", async () => {
    api.getSuppliers.mockResolvedValue([supplier()]);

    const { container } = renderCard("sup-missing");

    await waitFor(() => expect(api.getSuppliers).toHaveBeenCalled());
    expect(container.querySelector("input")).toBeNull();
  });
});
