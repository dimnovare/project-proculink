import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

/**
 * `/library/suppliers/{id}` — the claims this screen made without asking.
 *
 * PR #135 fixed one instance of this class ("No deliveries yet for this
 * supplier.", rendered by a page that ran no order query) and swept up eight
 * more in the same file. This file is the guard for those eight.
 *
 * There is one contract, stated two ways:
 *
 *   1. A claim may render ONLY when a completed query actually returned it.
 *      Loading is not empty. An error is not empty. "We could not look" and
 *      "there is nothing there" are different sentences and the screen must be
 *      able to tell them apart.
 *
 *   2. An unknown value resolves to the LEAST confident reading available,
 *      never the most. An unattributed mapping is not "Manual"; a severity we
 *      cannot classify is not the calm "info" blue.
 *
 * Every negative assertion here is paired with a positive one — the populated
 * path, the error path — so this file cannot pass by never rendering the
 * sentence at all, which is the failure mode a "the sentence is absent" suite
 * has by construction.
 */

// ── The defects, verbatim as they shipped ───────────────────────────────────
//
// Each string below is copied out of the code this branch changes. They are the
// literal thing an operator read.

/** :1100 CatalogTab — rendered whenever `data` was undefined, INCLUDING on a failed fetch. */
const CATALOG_EMPTY_CLAIM =
  "No products yet. Upload this supplier's product list (CSV or XLSX). ProcuLink uses it so AI only suggests real supplier codes and flags unknown ones. Only \"code\" is required; name, unit, price, barcode are optional. Example: ACM-PL-22, Hydraulic seal kit, box, 24.50.";

/** :1517-1520 KPI strip — four cards captioned this, with no metrics query in the file. */
const KPI_NO_DATA_CAPTION = "no data yet";
/** The three KPI labels that had no endpoint behind them and now do not exist. */
const UNFETCHABLE_KPI_LABELS = ["Avg cycle time", "Issue rate", "Acceptance"] as const;

/** :1817 History tab — reached by `connectionId ?? null`, so a failed fetch said this. */
const NO_VERSIONS_CLAIM = "No versions yet";

/** :1577-1586 Delivery summary — rendered with no delivery-config fetch anywhere on the tab. */
const DELIVERY_UNCONFIGURED_CLAIM =
  "Configure this supplier in the Delivery tab to populate this summary.";

/** :853 normalizeSource — an unattributed row was labelled with the HIGHEST-trust provenance. */
const HIGHEST_TRUST_SOURCE_LABEL = "Manual";

/** :1290 header — initials synthesised from the name, printed in the real-code slot. */
const SYNTHETIC_SUPPLIER_CODE = "NHG";
const SUPPLIER_NAME = "Nordmark Handel GmbH";

// ── Query harness ───────────────────────────────────────────────────────────

type QueryResult = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
};

const refetch = vi.fn();

const loading = (): QueryResult => ({ data: undefined, isLoading: true, isError: false, isFetching: true, error: null, refetch });
const errored = (): QueryResult => ({ data: undefined, isLoading: false, isError: true, isFetching: false, error: new Error("boom"), refetch });
const resolved = (data: unknown): QueryResult => ({ data, isLoading: false, isError: false, isFetching: false, error: null, refetch });

/** Per-queryKey state for the render under test. Anything unset resolves to a benign nothing. */
let QUERIES: Record<string, QueryResult> = {};

/**
 * Every queryKey the component actually asked for during a render.
 *
 * This is the mechanical half of the contract: a surface that makes a claim must
 * have a query behind it. Four of the eight defects were surfaces with NO query
 * at all, so "did this key get requested" is not a detail — it is the difference
 * between the fixed code and the shipped code.
 */
const OBSERVED_KEYS = new Set<string>();

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(Array.isArray(queryKey) ? queryKey[0] : queryKey);
    OBSERVED_KEYS.add(key);
    if (key === "suppliers") {
      return resolved([{ id: "sup-1", name: SUPPLIER_NAME }]);
    }
    return QUERIES[key] ?? resolved(undefined);
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

let tabParam = "overview";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${tabParam}`),
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn(), deleteSupplier: vi.fn(), getOrders: vi.fn() },
  isApiMockMode: false,
  getAcceptanceProfile: vi.fn(),
  saveAcceptanceProfile: vi.fn(),
  activateAcceptanceVersion: vi.fn(),
  applyPoMappingTemplate: vi.fn(),
  getSupplierCatalog: vi.fn(),
  importSupplierCatalog: vi.fn(),
  clearSupplierCatalog: vi.fn(),
  getSupplierRuleBindings: vi.fn(),
  listConnections: vi.fn(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

// Neighbouring editors are out of scope — stub them so each claim is isolated.
// PoMappingEditor reports the seed it was mounted with, because "was the saved
// layout read back" is exactly what defect 6 is about.
vi.mock("./PoMappingEditor", () => ({
  PoMappingEditor: ({ initialConfig }: { initialConfig: unknown }) => (
    <div data-testid="po-mapping-editor" data-seeded={String(initialConfig != null)} />
  ),
}));
vi.mock("./DeliveryConfigEditor", () => ({ DeliveryConfigEditor: () => <div data-testid="delivery-config-editor" /> }));
vi.mock("./DeliveryGuidedSetup", () => ({ DeliveryGuidedSetup: () => <div data-testid="delivery-guided-setup" /> }));
vi.mock("./CatalogSourceEditor", () => ({ CatalogSourceEditor: () => <div data-testid="catalog-source-editor" /> }));
vi.mock("./SupplierIdentityCard", () => ({ SupplierIdentityCard: () => <div data-testid="supplier-identity-card" /> }));
vi.mock("@/components/connections/SupplierHistoryTab", () => ({
  SupplierHistoryTab: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="supplier-history-tab" data-connection-id={connectionId} />
  ),
}));

import { SupplierDockProfile } from "./SupplierDockProfile";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Matches an element whose text is exactly `s`, ignoring only whitespace runs —
 * JSX splits these sentences across text nodes and interpolations, so a plain
 * string matcher would silently never match and every negative assertion in the
 * file would pass for the wrong reason.
 */
function exactText(s: string) {
  const want = s.replace(/\s+/g, " ").trim();
  return (_content: string, el: Element | null) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim() === want;
}

/**
 * The deepest elements whose text is exactly `s`.
 *
 * `exactText` matches on `textContent`, so a `<td>` holding nothing but the chip
 * matches as well as the chip — which would make any count here a hostage to
 * markup rather than to behaviour. Dropping every match that contains another
 * match leaves one element per rendered occurrence, while still keeping a
 * sentence whose only children are non-matching (the Delivery-tab link inside
 * the delivery-summary paragraph).
 */
function matchesOf(s: string): Element[] {
  const all = screen.queryAllByText(exactText(s));
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

const present = (s: string) => matchesOf(s).length > 0;

/** The four query states every claim has to be told apart from. */
const STATE_NAMES = ["loading", "error", "empty", "populated"] as const;
type StateName = (typeof STATE_NAMES)[number];

/** Which states each claim actually put on screen. Read by the file-level floor. */
const EXERCISED: Record<string, Set<StateName>> = {};
function exercised(claim: string, state: StateName) {
  (EXERCISED[claim] ??= new Set()).add(state);
}

function renderProfile(tab: string, queries: Record<string, QueryResult>, state?: [string, StateName]) {
  tabParam = tab;
  QUERIES = queries;
  if (state) exercised(state[0], state[1]);
  render(<SupplierDockProfile id="sup-1" />);
}

beforeEach(() => {
  refetch.mockClear();
  QUERIES = {};
  tabParam = "overview";
});
afterEach(cleanup);

// ── 1. CatalogTab — "No products yet." ──────────────────────────────────────
//
// The `["supplier-catalog", …]` query's `isError` was never destructured, and
// `getSupplierCatalog` throws on a non-ok response — so a 500 left `data`
// undefined, fell through `data?.items ?? []`, and told a supplier with 8,000
// imported products that it had none and should go upload a file.

const CATALOG_EMPTY = { items: [], total: 0 };
const CATALOG_FULL = { items: [{ id: "p1", code: "ACM-PL-22", name: "Hydraulic seal kit" }], total: 8000 };

/** ANTI-VACUITY FLOOR (per test): prove the sentence CAN render before forbidding it. */
function floorCatalogClaimIsRenderable() {
  renderProfile("catalog", { "supplier-catalog": resolved(CATALOG_EMPTY) });
  expect(present(CATALOG_EMPTY_CLAIM)).toBe(true);
  cleanup();
}

describe("SupplierDockProfile — the catalog does not report a failed fetch as an empty catalog", () => {
  it("claims emptiness when a completed query really returned no products", () => {
    renderProfile("catalog", { "supplier-catalog": resolved(CATALOG_EMPTY) }, ["catalog", "empty"]);
    expect(present(CATALOG_EMPTY_CLAIM)).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not claim emptiness when the catalog fetch failed", () => {
    floorCatalogClaimIsRenderable();

    renderProfile("catalog", { "supplier-catalog": errored() }, ["catalog", "error"]);
    // Contract assertion first: "the panel claimed an absence it had not
    // established" is the finding, not "the alert is missing".
    expect(present(CATALOG_EMPTY_CLAIM)).toBe(false);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/not the same as/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("does not claim emptiness while the catalog is still loading", () => {
    floorCatalogClaimIsRenderable();

    renderProfile("catalog", { "supplier-catalog": loading() }, ["catalog", "loading"]);
    expect(present(CATALOG_EMPTY_CLAIM)).toBe(false);
    expect(screen.getByText("Loading catalog…")).toBeInTheDocument();
  });

  it("lists the returned products instead of the sentence", () => {
    floorCatalogClaimIsRenderable();

    renderProfile("catalog", { "supplier-catalog": resolved(CATALOG_FULL) }, ["catalog", "populated"]);
    expect(present(CATALOG_EMPTY_CLAIM)).toBe(false);
    expect(screen.getByText("ACM-PL-22")).toBeInTheDocument();
  });
});

// ── 2. KPI strip — four cards captioned "no data yet", with no query ────────
//
// This was the strongest form on the screen after #135's: not a misread value
// but a caption with nothing behind it, and once the panel below it started
// printing a real "412 total" the same screen contradicted itself.

const ORDERS_PAGE = {
  items: [{ id: "o1", poNumber: "PO-2026-008412", status: "delivered", totalValue: 100, currency: "EUR" }],
  totalCount: 412,
  page: 1,
  pageSize: 6,
};
const ORDERS_EMPTY = { items: [], totalCount: 0, page: 1, pageSize: 6 };

describe("SupplierDockProfile — the order-volume KPI is fetched, and the unfetchable ones are gone", () => {
  it("prints the count a completed query returned", () => {
    renderProfile("overview", { "supplier-recent-orders": resolved(ORDERS_PAGE) }, ["kpi", "populated"]);
    expect(screen.getByText("Total orders")).toBeInTheDocument();
    // The KPI's own value node, distinct from the panel's "412 total".
    expect(screen.getByText("412")).toBeInTheDocument();
  });

  it("prints no count while the order query is loading", () => {
    renderProfile("overview", { "supplier-recent-orders": loading() }, ["kpi", "loading"]);
    expect(screen.queryByText("412")).toBeNull();
    expect(screen.getByText("Total orders")).toBeInTheDocument();
  });

  it("prints no count, and does not caption the blank as an absence of orders, on error", () => {
    renderProfile("overview", { "supplier-recent-orders": errored() }, ["kpi", "error"]);
    expect(screen.queryByText("412")).toBeNull();
    expect(present(KPI_NO_DATA_CAPTION)).toBe(false);
  });

  it("claims zero only when a completed query really returned zero", () => {
    renderProfile("overview", { "supplier-recent-orders": resolved(ORDERS_EMPTY) }, ["kpi", "empty"]);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("never captions a KPI 'no data yet', in any state", () => {
    // The floor for this one is the populated test above: the KPI strip is
    // provably on screen and provably able to print a caption, so an absent
    // caption here is a real absence and not an unrendered component.
    for (const [state, q] of [
      ["loading", loading()],
      ["error", errored()],
      ["empty", resolved(ORDERS_EMPTY)],
      ["populated", resolved(ORDERS_PAGE)],
    ] as Array<[StateName, QueryResult]>) {
      renderProfile("overview", { "supplier-recent-orders": q });
      expect(screen.getByText("Total orders"), `KPI strip absent in ${state}`).toBeInTheDocument();
      expect(present(KPI_NO_DATA_CAPTION), `'${KPI_NO_DATA_CAPTION}' rendered in ${state}`).toBe(false);
      cleanup();
    }
  });

  it("does not offer the three KPIs no endpoint can answer", () => {
    // Avg cycle time / Issue rate / Acceptance had no per-supplier metrics route
    // to read. Removing the claim is the honest outcome; re-adding a card
    // without an endpoint behind it puts the caption straight back.
    renderProfile("overview", { "supplier-recent-orders": resolved(ORDERS_PAGE) });
    expect(screen.getByText("Total orders")).toBeInTheDocument();
    for (const label of UNFETCHABLE_KPI_LABELS) {
      expect(screen.queryByText(label), `${label} has no query behind it`).toBeNull();
    }
  });
});

// ── 3. History tab — "No versions yet" from a `?? null` ─────────────────────

const CONNECTIONS_NONE: Array<{ id: string; supplierId: string }> = [];
const CONNECTIONS_ONE = [{ id: "conn-1", supplierId: "sup-1" }];

function floorVersionsClaimIsRenderable() {
  renderProfile("history", { connections: resolved(CONNECTIONS_NONE) });
  expect(present(NO_VERSIONS_CLAIM)).toBe(true);
  cleanup();
}

describe("SupplierDockProfile — a failed connections fetch is not 'no versions'", () => {
  it("claims no versions when a completed query really returned none", () => {
    renderProfile("history", { connections: resolved(CONNECTIONS_NONE) }, ["versions", "empty"]);
    expect(present(NO_VERSIONS_CLAIM)).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not claim no versions when the connections fetch failed", () => {
    floorVersionsClaimIsRenderable();

    renderProfile("history", { connections: errored() }, ["versions", "error"]);
    expect(present(NO_VERSIONS_CLAIM)).toBe(false);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/not the same as/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("does not claim no versions while the connections fetch is outstanding", () => {
    floorVersionsClaimIsRenderable();

    renderProfile("history", { connections: loading() }, ["versions", "loading"]);
    expect(present(NO_VERSIONS_CLAIM)).toBe(false);
    expect(screen.getByText("Checking for saved versions…")).toBeInTheDocument();
  });

  it("mounts the version history when the supplier has a connection", () => {
    floorVersionsClaimIsRenderable();

    renderProfile("history", { connections: resolved(CONNECTIONS_ONE) }, ["versions", "populated"]);
    expect(present(NO_VERSIONS_CLAIM)).toBe(false);
    expect(screen.getByTestId("supplier-history-tab")).toHaveAttribute("data-connection-id", "conn-1");
  });
});

// ── 4. Delivery summary — "Configure this supplier in the Delivery tab…" ────

const DELIVERY_CONFIG = {
  supplierId: "sup-1",
  protocol: "HTTP",
  autoDeliver: true,
  configJson: "{}",
  outputFormat: "cXML",
  hasCredentials: true,
  credentialsDisplay: "API key ••••4821",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** The sentence that may only render once a read established there is no config. */
const DELIVERY_EMPTY_SENTENCE =
  "Nothing is configured yet. Set this supplier up in the Delivery tab and this summary fills in.";

function floorDeliveryClaimIsRenderable() {
  renderProfile("overview", { "supplier-delivery-config": resolved(null) });
  expect(present(DELIVERY_EMPTY_SENTENCE)).toBe(true);
  cleanup();
}

describe("SupplierDockProfile — the delivery summary checks before telling you to configure it", () => {
  it("asks for configuration only when a completed read returned no config", () => {
    renderProfile("overview", { "supplier-delivery-config": resolved(null) }, ["delivery", "empty"]);
    expect(present(DELIVERY_EMPTY_SENTENCE)).toBe(true);
  });

  it("does not ask for configuration when the delivery-config read failed", () => {
    floorDeliveryClaimIsRenderable();

    renderProfile("overview", { "supplier-delivery-config": errored() }, ["delivery", "error"]);
    expect(present(DELIVERY_EMPTY_SENTENCE)).toBe(false);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/not the same as/i);
  });

  it("does not ask for configuration while the read is outstanding", () => {
    floorDeliveryClaimIsRenderable();

    renderProfile("overview", { "supplier-delivery-config": loading() }, ["delivery", "loading"]);
    expect(present(DELIVERY_EMPTY_SENTENCE)).toBe(false);
    expect(screen.getByText("Checking this supplier's delivery setup…")).toBeInTheDocument();
  });

  it("summarises the saved config instead of asking for one", () => {
    floorDeliveryClaimIsRenderable();

    renderProfile("overview", { "supplier-delivery-config": resolved(DELIVERY_CONFIG) }, ["delivery", "populated"]);
    expect(present(DELIVERY_EMPTY_SENTENCE)).toBe(false);
    expect(screen.getByText("cXML")).toBeInTheDocument();
    expect(screen.getByText("API key ••••4821")).toBeInTheDocument();
  });

  it("never renders the sentence that shipped unconditionally, in any state", () => {
    floorDeliveryClaimIsRenderable();

    for (const q of [loading(), errored(), resolved(null), resolved(DELIVERY_CONFIG)]) {
      renderProfile("overview", { "supplier-delivery-config": q });
      expect(present(DELIVERY_UNCONFIGURED_CLAIM)).toBe(false);
      cleanup();
    }
  });
});

// ── 5. normalizeSource — an unattributed mapping labelled "Manual" ──────────
//
// The sharpest of the eight. "Manual" is the HIGHEST-trust provenance in this
// product's vocabulary — a human typed it and stands behind it — sitting in the
// same column as the violet AI pill operators are trained to scrutinise. It is
// the defect MappingConfidence was already fixed for, one column over.

const MAPPING_ROWS = [
  { id: "m1", buyerItemCode: "HX-4412", supplierItemCode: "ACM-FL-08", source: "manual", confidence: 1 },
  { id: "m2", buyerItemCode: "HX-4410", supplierItemCode: "ACM-PL-22", source: undefined, confidence: 0.95 },
  { id: "m3", buyerItemCode: "HX-5500", supplierItemCode: "ACM-BR-55", source: "", confidence: 0.9 },
  { id: "m4", buyerItemCode: "HX-3301", supplierItemCode: "ACM-NT-33", source: "bulk_import", confidence: 0.9 },
];
const MAPPING_ONLY_MANUAL = [MAPPING_ROWS[0]];
const MAPPING_ONLY_UNATTRIBUTED = [MAPPING_ROWS[1], MAPPING_ROWS[2]];

/**
 * ANTI-VACUITY FLOOR (per test).
 *
 * "Manual does not render" is worth nothing if "Manual" cannot render at all —
 * deleting the label outright would turn the negative tests green. So prove a
 * genuinely manual row still says Manual, in the same process, first.
 */
function floorManualLabelIsRenderable() {
  renderProfile("mappings", { "supplier-mappings": resolved(MAPPING_ONLY_MANUAL) });
  expect(present(HIGHEST_TRUST_SOURCE_LABEL)).toBe(true);
  cleanup();
}

describe("SupplierDockProfile — an unattributed mapping is not attributed to a human", () => {
  it("still labels a genuinely manual mapping Manual", () => {
    renderProfile("mappings", { "supplier-mappings": resolved(MAPPING_ONLY_MANUAL) }, ["source", "populated"]);
    expect(present(HIGHEST_TRUST_SOURCE_LABEL)).toBe(true);
  });

  it("does not label a mapping with no recorded source Manual", () => {
    floorManualLabelIsRenderable();

    renderProfile("mappings", { "supplier-mappings": resolved(MAPPING_ONLY_UNATTRIBUTED) }, ["source", "empty"]);
    expect(present(HIGHEST_TRUST_SOURCE_LABEL)).toBe(false);
    // …and says so, rather than leaving a blank cell under a "Source" header.
    expect(present("Source not recorded")).toBe(true);
  });

  it("echoes a source it does not recognise instead of promoting it to Manual", () => {
    floorManualLabelIsRenderable();

    renderProfile("mappings", { "supplier-mappings": resolved([MAPPING_ROWS[3]]) }, ["source", "populated"]);
    expect(present(HIGHEST_TRUST_SOURCE_LABEL)).toBe(false);
    expect(present("bulk_import")).toBe(true);
  });

  it("labels exactly the rows that earned each label, and no others", () => {
    renderProfile("mappings", { "supplier-mappings": resolved(MAPPING_ROWS) });
    // Counts are DERIVED from the fixture, never typed: a hand-written number
    // here would go on passing after a row changed provenance underneath it.
    // The tab renders every row twice — the ≥sm table and the phone cards — so
    // one row is two occurrences.
    const LAYOUTS = 2;
    const manualRows = MAPPING_ROWS.filter((m) => m.source === "manual").length;
    const unattributedRows = MAPPING_ROWS.filter((m) => !m.source).length;
    expect(manualRows).toBeGreaterThan(0);
    expect(unattributedRows).toBeGreaterThan(0);

    expect(matchesOf(HIGHEST_TRUST_SOURCE_LABEL)).toHaveLength(manualRows * LAYOUTS);
    expect(matchesOf("Source not recorded")).toHaveLength(unattributedRows * LAYOUTS);
  });
});

// ── 6. PO mapping — a saved layout that was never read back ─────────────────
//
// `poMappingConfig` was `useState<PoMappingConfig | null>(null)` written only by
// an in-session save, and PoMappingEditor does not fetch it either — so a
// supplier with a saved column layout got a blank editor on every fresh load.

const PO_MAPPING = { hasHeaderRecord: true, separator: ",", header: {}, lines: {} };

describe("SupplierDockProfile — the saved order layout is read back", () => {
  it("seeds the editor with the layout the query returned", () => {
    renderProfile("po-mapping", { "supplier-po-mapping": resolved(PO_MAPPING) }, ["po-mapping", "populated"]);
    expect(screen.getByTestId("po-mapping-editor")).toHaveAttribute("data-seeded", "true");
  });

  it("opens an unseeded editor only when the query returned no layout", () => {
    renderProfile("po-mapping", { "supplier-po-mapping": resolved(null) }, ["po-mapping", "empty"]);
    expect(screen.getByTestId("po-mapping-editor")).toHaveAttribute("data-seeded", "false");
  });

  it("does not open an empty editor while the layout is still loading", () => {
    // Contract first: an editor showing no layout IS the claim that there is
    // none, so it must not mount before the read settles.
    renderProfile("po-mapping", { "supplier-po-mapping": loading() }, ["po-mapping", "loading"]);
    expect(screen.queryByTestId("po-mapping-editor")).toBeNull();
    expect(screen.getByText("Loading this supplier's saved order layout…")).toBeInTheDocument();
  });

  it("does not open an empty editor when the layout read failed", () => {
    renderProfile("po-mapping", { "supplier-po-mapping": errored() }, ["po-mapping", "error"]);
    expect(screen.queryByTestId("po-mapping-editor")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/not the same as/i);
  });
});

// ── 7. Header — a supplier code that exists in no system ────────────────────

describe("SupplierDockProfile — the header does not invent a supplier code", () => {
  it("prints the supplier's real name", () => {
    renderProfile("overview", {}, ["header", "populated"]);
    expect(screen.getByRole("heading", { name: SUPPLIER_NAME })).toBeInTheDocument();
  });

  it("does not print initials synthesised from the name as an identifier", () => {
    // The floor is the test above: the header provably renders, so an absent
    // code is an absent code and not an unrendered header.
    renderProfile("overview", {});
    expect(screen.getByRole("heading", { name: SUPPLIER_NAME })).toBeInTheDocument();
    expect(present(SYNTHETIC_SUPPLIER_CODE)).toBe(false);
  });
});

// ── 8. Rule severity — an unrecognised severity painted "info" ──────────────
//
// The weakest of the eight: the raw severity string prints verbatim beside the
// dot, so only the colour lied. `SupplierAcceptanceRule.Severity` is free text
// on the backend, so an unrecognised value does reach the frontend.

const RULE_BINDINGS = [
  { ruleId: "r1", ruleCode: "CUR", severity: "error", fieldPath: "currency", operator: "equals", expectedValue: "EUR", blockOnFail: true, definition: null },
  { ruleId: "r2", ruleCode: "DESC", severity: "warning", fieldPath: "description", operator: "required", expectedValue: "", blockOnFail: false, definition: null },
  { ruleId: "r3", ruleCode: "NOTE", severity: "info", fieldPath: "note", operator: "required", expectedValue: "", blockOnFail: false, definition: null },
  { ruleId: "r4", ruleCode: "WAT", severity: "banana", fieldPath: "watt", operator: "required", expectedValue: "", blockOnFail: false, definition: null },
];

function severityColor(severity: string): string {
  const label = screen.getByText(exactText(severity));
  return (label as HTMLElement).style.color;
}

describe("SupplierDockProfile — an unclassifiable severity does not borrow a semantic tone", () => {
  it("gives the severities it recognises three distinct tones", () => {
    // ANTI-VACUITY FLOOR for the assertion below: if this function assigned one
    // colour to everything, "unknown differs from info" would be unprovable and
    // "unknown equals nothing semantic" would be trivially true.
    renderProfile("acceptance", { "rule-bindings": resolved(RULE_BINDINGS) }, ["severity", "populated"]);
    const tones = ["error", "warning", "info"].map(severityColor);
    expect(new Set(tones).size, `expected three distinct tones, got ${tones.join(" / ")}`).toBe(3);
    for (const tone of tones) expect(tone).not.toBe("");
  });

  it("does not paint an unrecognised severity with the calm 'info' blue", () => {
    renderProfile("acceptance", { "rule-bindings": resolved(RULE_BINDINGS) });
    const unknown = severityColor("banana");
    // The defect verbatim: the `default:` arm returned the info blue, so a
    // severity nobody could classify read as the mildest kind.
    expect(unknown).not.toBe(severityColor("info"));
    // …nor either of the other two, so it has not simply moved to another lie.
    expect(unknown).not.toBe(severityColor("error"));
    expect(unknown).not.toBe(severityColor("warning"));
    // The word itself still prints, which is the part that was never wrong.
    expect(present("banana")).toBe(true);
  });
});

// ── File-level anti-vacuity floor ───────────────────────────────────────────

describe("SupplierDockProfile — unfetched-claims guard, anti-vacuity floor", () => {
  it("every claim was driven through the query states it is asserted against", () => {
    // Runs last. A fixture that stopped reaching the component — a renamed tab
    // id, a mock that swallowed the render — fails HERE, loudly, instead of
    // turning a file of negative assertions silently green.
    const REQUIRED: Record<string, StateName[]> = {
      catalog: ["loading", "error", "empty", "populated"],
      kpi: ["loading", "error", "empty", "populated"],
      versions: ["loading", "error", "empty", "populated"],
      delivery: ["loading", "error", "empty", "populated"],
      "po-mapping": ["loading", "error", "empty", "populated"],
      source: ["empty", "populated"],
      header: ["populated"],
      severity: ["populated"],
    };
    expect(Object.keys(EXERCISED).length).toBeGreaterThan(0);
    expect(Object.keys(EXERCISED).sort()).toEqual(Object.keys(REQUIRED).sort());
    for (const [claim, states] of Object.entries(REQUIRED)) {
      expect([...(EXERCISED[claim] ?? [])].sort(), `${claim} did not exercise every state`).toEqual(
        [...states].sort(),
      );
    }
  });

  it("every claim that survived has a query key behind it", () => {
    // The mechanical half of the contract. Four of these eight surfaces made a
    // claim with NO query in existence; the fix is only real if the key is
    // genuinely requested, so this asserts the reads happened rather than
    // trusting the copy on screen.
    for (const key of [
      "supplier-catalog",
      "supplier-recent-orders",
      "connections",
      "supplier-delivery-config",
      "supplier-po-mapping",
      "supplier-mappings",
      "rule-bindings",
    ]) {
      expect(OBSERVED_KEYS.has(key), `no query was ever issued for "${key}"`).toBe(true);
    }
  });
});
