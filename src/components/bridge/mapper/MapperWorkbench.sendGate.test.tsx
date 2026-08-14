import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The "Send to supplier" gate had two terms and neither could be non-zero.
//
//   canDeliver = !readOnly && blockingCount === 0 && summary.requiredUnmapped === 0 && !deliverDisabled
//
//   • `requiredUnmapped` counted `required && !mapped`. Every required canonical name is a
//     member of CANONICAL_SPINE, so computeOutgoingStatus resolved all four through its
//     implicit 1:1 "auto" branch with a hard-coded `mapped: true`. The count was pinned to 0.
//   • `blockingCount` came from a TanStack query whose `isError` nothing read. A failed
//     validation fetch left `data` undefined, which became `[]`, which counted 0 — the same
//     number a clean order produces.
//
// So the gate was open in every state, including the two states it exists for. These tests
// drive the real component with a mocked model, and assert on what reaches the DOM — a
// disabled button and a rendered sentence — never on the intermediate booleans, because
// booleans set to a confident value and faithfully drawn were the entire defect.

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

/** The four the supplier dispatcher requires, as declared outputs. */
const REQUIRED_TARGETS: TargetField[] = [
  { outputPath: "PoNumber", label: "PO number", scope: "header" },
  { outputPath: "Quantity", label: "Quantity", scope: "line" },
  { outputPath: "UnitPrice", label: "Unit price", scope: "line" },
  { outputPath: "SupplierItemCode", label: "Supplier item code", scope: "line" },
];

/** Every required field resolved — the clean order. */
const ALL_RESOLVED = new Map([
  ["PoNumber", "PO-1"], ["Quantity", "3"], ["UnitPrice", "9.50"], ["SupplierItemCode", "SKU-9"],
]);

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
    targetFields: REQUIRED_TARGETS,
    sourceConnections: {},
    outputConnections: {},
    fixedValues: {},
    knownSourceTokenIds: new Set<string>(),
    suggestions: [],
    aiUnavailable: false,
    validationUnavailable: false,
    validationByKey: new Map(),
    catalogHintByLine: new Map(),
    blockingCount: 0,
    tokenValueById: new Map(),
    canonicalValueByKey: ALL_RESOLVED,
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

function renderWorkbench() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapperWorkbench
        variant="connection"
        connectionId="conn-1"
        revisionId="rev-1"
        supplierId="sup-1"
        onDeliver={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/**
 * Every rendered "Send to supplier". jsdom has no Tailwind, so the `lg:hidden` mobile block
 * and the desktop toolbar BOTH mount — asserting on all of them is stronger than picking one,
 * and it means a fix applied to a single breakpoint cannot pass.
 */
function sendButtons(): HTMLElement[] {
  return screen.getAllByRole("button", { name: "Send to supplier" });
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

describe("MapperWorkbench — Send is blocked when a required field has no value", () => {
  it("blocks the send and names the count when a required output resolves to nothing", () => {
    // The ordinary unmapped order: the supplier item code is exactly what review resolves.
    model.canonicalValueByKey = new Map([["PoNumber", "PO-1"], ["Quantity", "3"], ["UnitPrice", "9.50"]]);

    renderWorkbench();

    expect(sendButtons().length).toBeGreaterThan(0);
    for (const b of sendButtons()) expect(b).toBeDisabled();
    expect(document.body.textContent).toContain("1 field needs a source");
  });

  it("still allows the send once every required field resolves", () => {
    // Anti-vacuity. A gate that refused everything would satisfy every other assertion here
    // and would be a worse defect than the one being fixed.
    renderWorkbench();

    for (const b of sendButtons()) expect(b).toBeEnabled();
    expect(document.body.textContent).not.toContain("needs a source");
    expect(document.body.textContent).not.toContain("need a source");
  });
});

describe("MapperWorkbench — a failed validation fetch is not an all-clear", () => {
  it("blocks the send when the field checks could not be run", () => {
    model.validationUnavailable = true;

    renderWorkbench();

    for (const b of sendButtons()) expect(b).toBeDisabled();
  });

  it("says on screen why, rather than disabling the button silently", () => {
    // A Send that is greyed out with no explanation is its own defect: the operator cannot
    // tell a blocked order from a broken page.
    model.validationUnavailable = true;

    renderWorkbench();

    expect(document.body.textContent).toContain("Validation checks unavailable");
  });

  it("does not claim the checks failed when they ran and passed", () => {
    renderWorkbench();

    expect(document.body.textContent).not.toContain("Validation checks unavailable");
  });
});

describe("MapperWorkbench — nothing loaded is UNKNOWN, not an accusation", () => {
  // The same defect rotated. `canonicalValueByKey` is empty in the shipped connection editor
  // whenever there is no sample order to preview against. Reading that as "four required
  // fields have no source" would be a verdict drawn from evidence nobody produced — which is
  // what a naive `mapped: value != null` flip would have shipped.
  beforeEach(() => {
    model.hasIncomingSource = false;
    model.canonicalValueByKey = new Map();
    model.tokenValueById = new Map();
    model.previewOrderId = null;
  });

  it("does not accuse the four required fields of having no source", () => {
    renderWorkbench();

    expect(document.body.textContent).not.toContain("4 fields need a source");
    expect(document.body.textContent).not.toContain("fields need a source");
  });

  it("does not offer the send as if it had checked, either", () => {
    renderWorkbench();

    for (const b of sendButtons()) expect(b).toBeDisabled();
    expect(document.body.textContent).toContain("Required fields not checked yet");
  });

  it("reports the required count as unknown rather than as zero", () => {
    // The mobile summary printed a literal "0" under "Required without a source" — a measured
    // number, from a measurement that never happened.
    renderWorkbench();

    const row = screen.getByTestId("mobile-summary-required");
    expect(row.textContent).not.toContain("0");
    expect(row.textContent).toContain("—");
  });
});
