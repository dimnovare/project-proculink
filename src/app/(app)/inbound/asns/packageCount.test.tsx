import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsnsPage from "./page";

/**
 * The Packages column reads the wire field verbatim.
 *
 * `getAsns` returns `res.json()` with no mapping step, so `AsnDto.packageCount` is only ever
 * populated if the backend spells the field exactly that way. Until 2026-08-26 it did not:
 * `DesadvController.List` projected the notice without any package count, `asn.packageCount`
 * was `undefined`, and the column rendered blank on every row. ProcuLink #256 added the count
 * as a correlated, org-scoped subquery over `AsnPackages`; that the count is CORRECT is pinned
 * backend-side on real Postgres by `DesadvListPackageCountPostgresTests`. What is pinned here
 * is the other half — that the field survives the wire and reaches the cell.
 *
 * So the payload below is not a convenient fixture: it is the exact projection shape
 * `DesadvController.List` emits, serialized the way ASP.NET Core serializes it (camelCase, the
 * `AddControllers()` default — production configures no `PropertyNamingPolicy`). A rename on
 * either side has to break this test.
 *
 * The zero row is the case that would go quietly wrong. `{asn.packageCount}` renders nothing
 * for `undefined` and "0" for a real zero, and a notice with no packages is indistinguishable
 * from the old broken state unless something asserts the difference.
 */

// Exactly the fields DesadvController.List projects — no more, no less.
const WIRE = [
  {
    id: "8f1c4a2e-0000-4000-8000-000000000001",
    shipmentId: "SHIP-TWO",
    status: "received",
    despatchDate: "2026-08-26",
    sourceFileName: "SHIP-TWO.edi",
    createdAt: "2026-08-26T10:00:00Z",
    packageCount: 2,
  },
  {
    id: "8f1c4a2e-0000-4000-8000-000000000002",
    shipmentId: "SHIP-EMPTY",
    status: "pending",
    despatchDate: "2026-08-26",
    sourceFileName: "SHIP-EMPTY.edi",
    createdAt: "2026-08-26T09:55:00Z",
    packageCount: 0,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AsnsPage />
    </QueryClientProvider>,
  );
}

describe("/inbound/asns Packages column", () => {
  beforeEach(() => {
    // authHeader() polls window.Clerk for up to 5s before reading a token; a loaded
    // Clerk with no session short-circuits that and sends the request unauthenticated,
    // which is all this test needs.
    (window as unknown as { Clerk: unknown }).Clerk = { loaded: true, session: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(WIRE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { Clerk?: unknown }).Clerk;
  });

  it("prints the backend's packageCount in the desktop table", async () => {
    const { container } = renderPage();

    // jsdom applies no Tailwind, so the `sm:hidden` mobile list and the `hidden sm:block`
    // table BOTH mount. Scope to the table or an assertion passes against the wrong tree.
    const table = await waitFor(() => {
      // The loading branch mounts its OWN `<table>` of skeleton rows, so a bare
      // querySelector("table") can hand back the skeleton and every assertion below then
      // runs against placeholders. Wait for the skeleton to be gone first.
      if (container.querySelector(".animate-pulse")) throw new Error("still loading");
      const t = container.querySelector("table");
      if (!t) throw new Error("table not rendered yet");
      return t;
    });

    const rows = within(table).getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);

    // Column order: ASN # · Supplier · Ship date · Packages · Status.
    const packagesCell = (row: HTMLElement) => within(row).getAllByRole("cell")[3];

    expect(packagesCell(rows[0]).textContent).toBe("2");
    expect(packagesCell(rows[1]).textContent).toBe("0");
  });

  it("prints the backend's packageCount in the mobile list", async () => {
    const { container } = renderPage();

    const mobile = await waitFor(() => {
      if (container.querySelector(".animate-pulse")) throw new Error("still loading");
      // Attribute selector, not `.sm\:hidden` — nwsapi rejects the escaped colon.
      const m = container.querySelector("[class~='sm:hidden']");
      if (!m) throw new Error("mobile list not rendered yet");
      return m as HTMLElement;
    });

    expect(within(mobile).getByText("2 pkgs")).toBeInTheDocument();
    expect(within(mobile).getByText("0 pkgs")).toBeInTheDocument();
  });

  it("would have failed before the backend sent the field", async () => {
    // Anti-vacuity control: the same render against the OLD projection — every field the
    // controller emitted before #256, and no packageCount — leaves the cell empty. Without
    // this, a test that only ever sees a good payload cannot show it is reading the field
    // rather than reading anything at all.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(WIRE.map(({ packageCount: _dropped, ...rest }) => rest)),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const { container } = renderPage();

    const table = await waitFor(() => {
      // The loading branch mounts its OWN `<table>` of skeleton rows, so a bare
      // querySelector("table") can hand back the skeleton and every assertion below then
      // runs against placeholders. Wait for the skeleton to be gone first.
      if (container.querySelector(".animate-pulse")) throw new Error("still loading");
      const t = container.querySelector("table");
      if (!t) throw new Error("table not rendered yet");
      return t;
    });

    const firstRow = within(table).getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")[3].textContent).toBe("");
  });
});
