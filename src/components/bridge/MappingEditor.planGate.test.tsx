import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-11 follow-through — bulk mapping import.
//
// Uploading a code list in bulk is gated at Operations (`bulk_mapping_import_requires_operations`).
// The import endpoint returns the body as text and the client rethrows it verbatim, so the
// panel's red banner printed the raw code. Below the gate this is the FIRST thing a customer
// sees after picking a file — it has to say what to do about it.

const getSuppliers = vi.fn();
const getSupplierMappings = vi.fn();
const importSupplierMappings = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
    getSupplierMappings: (...a: unknown[]) => getSupplierMappings(...a),
    importSupplierMappings: (...a: unknown[]) => importSupplierMappings(...a),
    createSupplierMapping: vi.fn(),
    updateSupplierMapping: vi.fn(),
    deleteSupplierMapping: vi.fn(),
  },
  isApiMockMode: false,
}));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));

import { MappingEditor } from "./MappingEditor";

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MappingEditor />
    </QueryClientProvider>,
  );
}

/** Open the import panel, attach a CSV, and run the import. */
async function runImport(container: HTMLElement) {
  fireEvent.click(await screen.findByRole("button", { name: /^Import$/i }));

  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, {
    target: { files: [new File(["HX-1,ACM-1"], "codes.csv", { type: "text/csv" })] },
  });

  fireEvent.click(screen.getByRole("button", { name: /Import mappings/i }));
}

beforeEach(() => {
  getSuppliers.mockReset().mockResolvedValue([{ id: "sup-1", name: "Acme Components" }]);
  getSupplierMappings.mockReset().mockResolvedValue([]);
  importSupplierMappings.mockReset();
});

afterEach(cleanup);

describe("MappingEditor — plan-gated bulk import", () => {
  it("explains the plan and links to the upgrade page", async () => {
    importSupplierMappings.mockRejectedValue(
      new Error(JSON.stringify({ error: "bulk_mapping_import_requires_operations", upgradeUrl: "/settings" })),
    );

    const { container } = renderEditor();
    await runImport(container);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Operations/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|bulk_mapping_import/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
  });

  it("keeps the server's own message for an ordinary import failure", async () => {
    importSupplierMappings.mockRejectedValue(new Error("Row 4: supplier code is empty."));

    const { container } = renderEditor();
    await runImport(container);

    expect(await screen.findByText(/Row 4: supplier code is empty/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /plans/i })).toBeNull();
  });
});
