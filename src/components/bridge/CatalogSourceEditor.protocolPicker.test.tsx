// Catalog protocol picker — "aes2fa" names an auth mechanism (a vendor connector whose
// per-call AES 2FA request signing bypasses the generic HTTP auth path), not a transport
// protocol, so it must NOT be offered when setting up a new source. But a source already
// SAVED with protocol "aes2fa" must stay visible and editable (offer⇔works): the tile
// renders only while the saved source (or the current, not-yet-saved selection) uses it.
//
// The fixture URL is a reserved-for-documentation host (RFC 2606 `.example`). This
// repository is public: a real endpoint must never be committed as test data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  getCatalogSource.mockReset();
  upsertCatalogSource.mockReset();
  deleteCatalogSource.mockReset();
  testFetchCatalogSource.mockReset();
});

afterEach(cleanup);

describe("CatalogSourceEditor — protocol picker offers", () => {
  it("does NOT offer the AES 2FA connector for a new setup (no saved source)", async () => {
    getCatalogSource.mockResolvedValue(null);
    renderEditor();
    // Wait for load to finish — the generic transport tiles are present…
    await screen.findByRole("radio", { name: "HTTPS API (encrypted)" });
    expect(screen.getByRole("radio", { name: "SFTP" })).toBeInTheDocument();
    // …but the vendor connector is not offered.
    expect(screen.queryByRole("radio", { name: /AES 2FA/i })).not.toBeInTheDocument();
  });

  it("still shows (and selects) the AES 2FA tile when the SAVED source uses it", async () => {
    getCatalogSource.mockResolvedValue(SAVED_AES2FA);
    renderEditor();
    const tile = await screen.findByRole("radio", { name: /AES 2FA/i });
    expect(tile).toHaveAttribute("aria-checked", "true");
    // The saved config stays editable — its credentials panel is on screen.
    expect(screen.getByText("AES 2FA credentials")).toBeInTheDocument();
  });

  it("keeps the AES 2FA tile while switching away pre-save, so the user can switch back", async () => {
    getCatalogSource.mockResolvedValue(SAVED_AES2FA);
    renderEditor();
    const tile = await screen.findByRole("radio", { name: /AES 2FA/i });
    fireEvent.click(screen.getByRole("radio", { name: "SFTP" }));
    expect(tile).toBeInTheDocument(); // still offered until the save commits the change
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-checked", "true");
  });

  it("arrow-key navigation skips the hidden AES 2FA tile on a new setup", async () => {
    getCatalogSource.mockResolvedValue(null);
    renderEditor();
    await screen.findByRole("radio", { name: "HTTPS API (encrypted)" });
    // FTP is the last VISIBLE tile; ArrowDown must wrap to the first, not land on aes2fa.
    const ftp = screen.getByRole("radio", { name: "FTP" });
    fireEvent.click(ftp);
    fireEvent.keyDown(ftp, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "HTTPS API (encrypted)" })).toHaveAttribute("aria-checked", "true");
  });
});
