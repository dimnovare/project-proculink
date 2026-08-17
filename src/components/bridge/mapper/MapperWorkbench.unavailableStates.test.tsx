// TWO MORE "WE COULDN'T ASK" STATES RENDERED AS "WE ASKED AND THE ANSWER WAS NOTHING".
//
//   1. The saved mapping override failed to load. The model falls back to a blank document, so
//      the screen is identical to an unmapped order and the first edit PUTs that blank over the
//      real mapping. The refusal lives in useMapperModel (pinned by
//      useMapperModel.overrideLoadFailure.test.tsx); this file pins the SENTENCE, because a
//      mapper that silently ignores drags is its own defect.
//   2. The catalog hint fetch failed. `catalogHintByLine` is empty either way, and the toolbar
//      stated "No catalog hints for this order. Add a supplier catalog, or no lines differ from
//      it." — telling the operator their lines match a catalog nobody managed to read.
//
// `validationUnavailable` and `aiUnavailable` were already fixed IN THAT FILE; these are the
// same defect in the two queries the fix skipped.
//
// The model is mocked so each state is set directly and the assertions land on the DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const model: Record<string, unknown> = {};

vi.mock("./useMapperModel", () => ({ useMapperModel: () => model }));
vi.mock("./MapperWireLayer", () => ({
  useMapperWireLayer: () => ({ svg: null, dragging: null, hoverTarget: null, sourcePortProps: () => ({}) }),
}));
vi.mock("./IncomingPane", () => ({ IncomingPane: () => <div data-testid="incoming" /> }));
vi.mock("./OutgoingPane", () => ({ OutgoingPane: () => <div data-testid="outgoing" /> }));
vi.mock("./MapperPreviewPane", () => ({ MapperPreviewPane: () => <div data-testid="preview" /> }));
vi.mock("../OutputStructureDesigner", () => ({ OutputStructureDesigner: () => null }));
vi.mock("../OutputMappingEditor", () => ({ OutputMappingEditor: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MapperWorkbench } from "./MapperWorkbench";
import type { TargetField } from "./types";

const TARGETS: TargetField[] = [
  { outputPath: "PoNumber", label: "PO number", scope: "header" },
  { outputPath: "Quantity", label: "Quantity", scope: "line" },
];

function restingModel() {
  return {
    loading: false,
    saving: false,
    error: null as string | null,
    override: { customFields: [] },
    sourceFields: [],
    hasIncomingSource: true,
    canonicalNodes: [],
    customFields: [],
    targetFields: TARGETS,
    sourceConnections: {},
    outputConnections: {},
    fixedValues: {},
    knownSourceTokenIds: new Set<string>(),
    suggestions: [],
    aiUnavailable: false,
    validationUnavailable: false,
    overrideUnavailable: false,
    catalogUnavailable: false,
    validationByKey: new Map(),
    catalogHintByLine: new Map(),
    blockingCount: 0,
    tokenValueById: new Map(),
    canonicalValueByKey: new Map([["PoNumber", "PO-1"], ["Quantity", "3"]]),
    labelForCanonical: (k: string) => k,
    signature: "sig",
    lastTouched: null,
    previewOrderId: "ord-1",
    outputFormat: null,
    readOnly: false,
    onSourceConnect: vi.fn(),
    onSourceDisconnect: vi.fn(),
    onTargetConnect: vi.fn(),
    onTargetDisconnect: vi.fn(),
    onSetFixedValue: vi.fn(),
    onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(),
    onFieldManipulatorsChange: vi.fn(),
    onUseCatalogPrice: vi.fn(),
    onAddField: vi.fn(),
  };
}

/** The order variant — the one an operator reaches from /inbox/[orderId]. */
function renderWorkbench(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapperWorkbench variant="order" orderId="ord-1" supplierId="sup-1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

/** Rendered text with JSX line-wrapping collapsed, so prose can be matched as written. */
function flat(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("MapperWorkbench — the saved mapping could not be loaded", () => {
  it("says so, rather than rendering as an order with no mapping", () => {
    model.overrideUnavailable = true;

    renderWorkbench();

    // JSX line-wraps inside the sentence, so normalise before matching prose.
    const text = flat(screen.getByTestId("mapper-override-unavailable"));
    expect(text).toContain("couldn’t load the mapping saved for this order");
    expect(text).toContain("editing is paused");
  });

  it("warns that saving would replace the saved mapping, and that nothing has changed yet", () => {
    // The two facts an operator needs to decide what to do: the risk, and the reassurance that
    // the refusal already happened. Without the second, a careful operator assumes the worst.
    model.overrideUnavailable = true;

    renderWorkbench();

    const text = flat(screen.getByTestId("mapper-override-unavailable"));
    expect(text).toContain("replace that mapping with a blank one");
    expect(text).toContain("Nothing has been changed");
  });

  it("is an alert, not a decoration that a screen reader steps past", () => {
    model.overrideUnavailable = true;

    renderWorkbench();

    expect(screen.getByTestId("mapper-override-unavailable").getAttribute("role")).toBe("alert");
  });

  it("does not render when the mapping loaded — including for an order with none saved", () => {
    // Anti-vacuity. A 404 (no mapping saved yet) is the ordinary first-edit path and resolves to
    // `null`, NOT to an error; a banner there would accuse the product of failing on every new
    // order.
    renderWorkbench();

    expect(screen.queryByTestId("mapper-override-unavailable")).toBeNull();
  });
});

describe("MapperWorkbench — the catalog hints could not be fetched", () => {
  /** The toolbar control that states the catalog verdict. */
  function catalogButton(): HTMLElement {
    return screen.getByRole("button", { name: /Fill from catalog/i });
  }

  it("does not claim the order has no catalog hints", () => {
    model.catalogUnavailable = true;

    renderWorkbench();

    expect(catalogButton().getAttribute("title")).not.toContain("No catalog hints for this order");
  });

  it("says the hints could not be loaded", () => {
    model.catalogUnavailable = true;

    renderWorkbench();

    const title = catalogButton().getAttribute("title") ?? "";
    expect(title).toContain("couldn’t load the catalog hints");
    expect(catalogButton().textContent).toContain("unavailable");
  });

  it("still says 'no hints' when the fetch succeeded and found none", () => {
    // Anti-vacuity, and the state this control is in for most orders. Replacing one confident
    // sentence with the other unconditionally would be the same defect reversed.
    renderWorkbench();

    const title = catalogButton().getAttribute("title") ?? "";
    expect(title).toContain("No catalog hints for this order");
    expect(catalogButton().textContent).not.toContain("unavailable");
  });

  it("still counts and offers the hints when there are some", () => {
    model.catalogHintByLine = new Map([["Quantity", { lineKey: "Quantity", catalogPrice: 4 }]]);
    model.catalogUnavailable = false;

    renderWorkbench();

    expect(catalogButton().textContent).toContain("Fill from catalog · 1");
    expect(catalogButton().getAttribute("title")).toContain("Jump to the lines");
  });
});
