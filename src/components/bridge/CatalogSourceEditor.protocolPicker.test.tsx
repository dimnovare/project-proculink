// Catalog protocol picker — Logicom QuickConnect is a vendor connector, not a transport
// protocol, so it must NOT be offered when setting up a new source. But a source already
// SAVED with protocol "logicom" must stay visible and editable (offer⇔works): the tile
// renders only while the saved source (or the current, not-yet-saved selection) uses it.

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

const SAVED_LOGICOM: CatalogSource = {
  protocol: "logicom",
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
  url: "https://quickconnect.logicompartners.com/api",
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
  it("does NOT offer Logicom QuickConnect for a new setup (no saved source)", async () => {
    getCatalogSource.mockResolvedValue(null);
    renderEditor();
    // Wait for load to finish — the generic transport tiles are present…
    await screen.findByRole("radio", { name: "HTTPS API (encrypted)" });
    expect(screen.getByRole("radio", { name: "SFTP" })).toBeInTheDocument();
    // …but the vendor connector is not offered.
    expect(screen.queryByRole("radio", { name: /Logicom/i })).not.toBeInTheDocument();
  });

  it("still shows (and selects) the Logicom tile when the SAVED source uses it", async () => {
    getCatalogSource.mockResolvedValue(SAVED_LOGICOM);
    renderEditor();
    const tile = await screen.findByRole("radio", { name: /Logicom/i });
    expect(tile).toHaveAttribute("aria-checked", "true");
    // The saved config stays editable — its credentials panel is on screen.
    expect(screen.getByText("Logicom credentials")).toBeInTheDocument();
  });

  it("keeps the Logicom tile while switching away pre-save, so the user can switch back", async () => {
    getCatalogSource.mockResolvedValue(SAVED_LOGICOM);
    renderEditor();
    const tile = await screen.findByRole("radio", { name: /Logicom/i });
    fireEvent.click(screen.getByRole("radio", { name: "SFTP" }));
    expect(tile).toBeInTheDocument(); // still offered until the save commits the change
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-checked", "true");
  });

  it("arrow-key navigation skips the hidden Logicom tile on a new setup", async () => {
    getCatalogSource.mockResolvedValue(null);
    renderEditor();
    await screen.findByRole("radio", { name: "HTTPS API (encrypted)" });
    // FTP is the last VISIBLE tile; ArrowDown must wrap to the first, not land on logicom.
    const ftp = screen.getByRole("radio", { name: "FTP" });
    fireEvent.click(ftp);
    fireEvent.keyDown(ftp, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "HTTPS API (encrypted)" })).toHaveAttribute("aria-checked", "true");
  });
});
