// The AES 2FA connector stores all four vendor keys inside one encrypted auth blob —
// the UI copy says "they are stored encrypted and never shown again" — yet the
// "Consumer key" input rendered as plain text while its siblings (Consumer secret,
// Access-token key) were masked. A secret at rest must be a secret on screen.
//
// The fixture URL is a reserved-for-documentation host (RFC 2606 `.example`). This
// repository is public: a real endpoint must never be committed as test data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CatalogSource } from "@/lib/api/catalogSources";

const getCatalogSource = vi.fn();
const upsertCatalogSource = vi.fn();
const deleteCatalogSource = vi.fn();
const testFetchCatalogSource = vi.fn();

vi.mock("@/lib/api/catalogSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/catalogSources")>();
  return {
    ...actual,
    getCatalogSource: (...a: unknown[]) => getCatalogSource(...a),
    upsertCatalogSource: (...a: unknown[]) => upsertCatalogSource(...a),
    deleteCatalogSource: (...a: unknown[]) => deleteCatalogSource(...a),
    testFetchCatalogSource: (...a: unknown[]) => testFetchCatalogSource(...a),
  };
});

import { CatalogSourceEditor } from "./CatalogSourceEditor";

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CatalogSourceEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

const SAVED_AES2FA: CatalogSource = {
  protocol: "aes2fa",
  host: "",
  port: 0,
  remotePath: "",
  username: null,
  hasPassword: false,
  fileFormat: "auto",
  syncIntervalHours: 24,
  isEnabled: true,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  url: "https://api.supplier.example/catalog",
  authMethod: null,
  hasAuthConfig: true,
  httpMethod: "GET",
  columnMapping: null,
};

beforeEach(() => {
  getCatalogSource.mockReset().mockResolvedValue(SAVED_AES2FA);
  upsertCatalogSource.mockReset();
  deleteCatalogSource.mockReset();
  testFetchCatalogSource.mockReset();
});

afterEach(cleanup);

describe("CatalogSourceEditor — AES 2FA consumer key is masked like its siblings", () => {
  it("renders the Consumer key input as type password", async () => {
    renderEditor();

    const consumerKey = await screen.findByLabelText("Consumer key");
    // Control assertions — the two siblings were ALREADY masked before this fix.
    // If these fail, the harness never reached the credential section and the
    // assertion under test would pass for the wrong reason.
    expect(screen.getByLabelText("Consumer secret")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Access-token key")).toHaveAttribute("type", "password");

    // The defect: no type attribute at all, i.e. a plain-text input.
    expect(consumerKey).toHaveAttribute("type", "password");
  });
});
