import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-11 follow-through — the connection mapper.
//
// Saving field mappings on a connection PUTs the WHOLE draft bundle, protocol and output
// format included, so a revision that already selects a gated channel is refused with
// `webhook_delivery_requires_growth` / `erp_delivery_requires_enterprise` /
// `cxml_output_requires_operations` on every mapping save. The workbench printed that token
// verbatim into a 10.5px toolbar span — unreadable and unactionable. A plan refusal gets a
// real banner; every other failure keeps the small inline message.

const model: Record<string, unknown> = {};

vi.mock("./useMapperModel", () => ({ useMapperModel: () => model }));

vi.mock("./MapperWireLayer", () => ({
  useMapperWireLayer: () => ({
    svg: null,
    dragging: null,
    hoverTarget: null,
    sourcePortProps: () => ({}),
  }),
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

/** The shape MapperWorkbench reads off useMapperModel — resting, nothing mapped, no error. */
function restingModel() {
  return {
    loading: false,
    saving: false,
    error: null as string | null,
    override: { customFields: [] },
    sourceFields: [],
    sourceFileKey: null,
    canonicalNodes: [],
    customFields: [],
    targetFields: [],
    sourceConnections: {},
    outputConnections: {},
    fixedValues: {},
    knownSourceTokenIds: new Set<string>(),
    suggestions: [],
    aiUnavailable: false,
    validationByKey: new Map(),
    catalogHintByLine: new Map(),
    blockingCount: 0,
    tokenValueById: new Map(),
    canonicalValueByKey: new Map(),
    labelForCanonical: (k: string) => k,
    signature: "sig",
    lastTouched: null,
    previewOrderId: null,
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
      <MapperWorkbench variant="connection" connectionId="conn-1" revisionId="rev-1" supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

describe("MapperWorkbench — plan-gated draft save", () => {
  it("shows the plan sentence and an upgrade link instead of the raw code", () => {
    model.error = JSON.stringify({ error: "cxml_output_requires_operations", upgradeUrl: "/settings" });

    renderWorkbench();

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/Operations/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|upgradeUrl/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
  });

  it("keeps the small inline message for an ordinary save failure", () => {
    model.error = "Couldn’t save the mapping.";

    renderWorkbench();

    expect(screen.getByText("Couldn’t save the mapping.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /plans/i })).toBeNull();
  });
});
