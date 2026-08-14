/**
 * `CatalogSourceEditor` — a failed load must not render as "no import source".
 *
 * `getCatalogSource` throws on any non-ok response (`catalog/source: <status>`). The editor
 * caught that, set a red banner, and then fell straight through to the full form with
 * `savedSource === null` — every field on its "nothing configured" default, the footer's
 * "Save source" button live, because the footer sits OUTSIDE the `loading` branch.
 *
 * The banner was never the problem. The WRITE is:
 *
 *   - `passwordPayload()` returns `""` when `hasPassword` is false, and `hasPassword` reads off
 *     the `savedSource` that failed to load. `""` is the CLEAR sentinel, not the keep sentinel —
 *     so one click on a source that exists and is syncing wipes its stored password.
 *   - `columnMappingPayload()` sends the empty row set, discarding the saved column mapping.
 *   - the schedule resets to 24h and `isEnabled` to false.
 *
 * A 500 or a dropped connection is not evidence that a supplier has no import source. So the
 * assertions below are about REACHABILITY of the write, not about the presence of a message.
 *
 * `DeliveryConfigEditor` already shipped this exact shape (`loadFailed` + a blocking retry card,
 * with a comment naming the same hazard); this is that pattern applied to its sibling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

/** A healthy saved SFTP source with a stored password — what the blank form would overwrite. */
const SAVED_SFTP: CatalogSource = {
  protocol: "sftp",
  host: "files.supplier.example",
  port: 22,
  remotePath: "/out/catalog.csv",
  username: "proculink",
  hasPassword: true,
  fileFormat: "csv",
  syncIntervalHours: 6,
  isEnabled: true,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  url: null,
  authMethod: null,
  hasAuthConfig: false,
  httpMethod: null,
  columnMapping: { sku: "code", descr: "name" },
};

const bodyText = () => document.body.textContent ?? "";

/** The only control that can write. Absent = the overwrite is unreachable. */
const saveButton = () => screen.queryByRole("button", { name: /Save source/i });

beforeEach(() => {
  getCatalogSource.mockReset();
  upsertCatalogSource.mockReset();
  deleteCatalogSource.mockReset();
  testFetchCatalogSource.mockReset();
});

afterEach(cleanup);

describe("CatalogSourceEditor — a load failure blocks the write, not just the view", () => {
  it("does not offer Save when the source could not be loaded", async () => {
    getCatalogSource.mockRejectedValue(new Error("catalog/source: 500"));
    renderEditor();

    // Settle on the failed load WITHOUT asserting the copy — the wait keys off the control
    // that carries the danger, so this test fails on REACHABILITY OF THE WRITE rather than on
    // the wording of a banner. Deleting the blocking branch must be caught here, not by a
    // sentence: the banner shipped all along and stopped nothing.
    await waitFor(() => expect(screen.queryByText(/Loading import source/i)).toBeNull());
    expect(saveButton()).toBeNull();
    expect(upsertCatalogSource).not.toHaveBeenCalled();

    // The other two writes on this card are equally unreachable.
    expect(screen.queryByRole("button", { name: /Test connection & preview/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete$/i })).toBeNull();

    // And the FORM is gone, not merely a disabled button. This is the difference that matters:
    // on a blank form `canSave` starts false, so Save renders disabled — which protects nothing,
    // because the screen reads as "not configured" and the operator's natural next move is to
    // type the connection back in, which enables the very write that clears the stored password.
    // (Both of these are pinned as PRESENT in the successful-load test below, so their absence
    // here is a real difference and not a selector that never matches anything.)
    expect(screen.queryByRole("radiogroup", { name: /Protocol/i })).toBeNull();
    expect(screen.queryByLabelText(/Catalog URL/i)).toBeNull();

    // And only then the copy, which has to keep "we could not look" apart from
    // "there is nothing there".
    expect(bodyText()).toMatch(/Couldn't load this import source/i);
    expect(bodyText()).toMatch(/not the same as .no import source./i);
  });

  it("still offers Save on a successful load, including when nothing is configured yet", async () => {
    // Anti-vacuity. Without this, the assertions above would pass on an editor that never
    // renders a Save button at all — "no import source" is the ordinary first-run state and
    // must stay fully editable.
    getCatalogSource.mockResolvedValue(null);
    renderEditor();

    await waitFor(() => expect(saveButton()).not.toBeNull());
    expect(bodyText()).not.toMatch(/Couldn't load this import source/i);
    // The floor for the two absence assertions above: these selectors DO match the ordinary
    // screen, so their `toBeNull()` in the failure case measures the blocking branch.
    expect(screen.getByRole("radiogroup", { name: /Protocol/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Catalog URL/i)).toBeInTheDocument();
  });

  it("restores the form when the retry succeeds, with the saved source hydrated", async () => {
    getCatalogSource.mockRejectedValueOnce(new Error("catalog/source: 503"));
    renderEditor();
    await waitFor(() => expect(bodyText()).toMatch(/Couldn't load this import source/i));

    getCatalogSource.mockResolvedValue(SAVED_SFTP);
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    // Recovery is part of the contract: a blocking state with no way out is its own defect.
    await waitFor(() => expect(saveButton()).not.toBeNull());
    expect(bodyText()).not.toMatch(/Couldn't load this import source/i);
    // Hydrated from the source that finally loaded — not the blank defaults.
    expect(
      (screen.getByDisplayValue("files.supplier.example") as HTMLInputElement).value,
    ).toBe("files.supplier.example");
  });
});
