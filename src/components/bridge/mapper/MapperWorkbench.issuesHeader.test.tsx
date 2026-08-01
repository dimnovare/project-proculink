import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-39 §4.3, third surface. The Issues COLUMN HEAD sits above the issues panel and
// carries its own all-clear: a green dot, a green check badge, and the words
// "Nothing to fix". It read them off `issuesOpenCount === 0` alone, so on the failed
// order in the QA pass it agreed with the panel below it and disagreed with the
// "Couldn't send" badge and the failure panel on the same screen.
//
// The head stays presentational — it is a generic mapper surface and has no business
// knowing the order-status machine. `issuesAllClear` is the one bit the order screen
// already knows and can hand down.

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

function renderWorkbench(props: { issuesOpenCount?: number; issuesAllClear?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapperWorkbench
        variant="connection"
        connectionId="conn-1"
        revisionId="rev-1"
        supplierId="sup-1"
        issuesSlot={<div data-testid="issues-slot" />}
        issuesOpenCount={props.issuesOpenCount ?? 0}
        issuesAllClear={props.issuesAllClear}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

describe("MapperWorkbench — the Issues column head (WP-39 §4.3)", () => {
  it("does not say 'Nothing to fix' when the order stopped for another reason", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesAllClear: false });

    const head = screen.getByTestId("issues-column-head");
    expect(within(head).queryByText("Nothing to fix")).toBeNull();
    expect(within(head).getByText("Something else stopped this order")).toBeInTheDocument();
  });

  it("still says 'Nothing to fix' when there is genuinely nothing wrong", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesAllClear: true });

    expect(within(screen.getByTestId("issues-column-head")).getByText("Nothing to fix")).toBeInTheDocument();
  });

  it("falls back to the open count for callers that pass no verdict", () => {
    // Every non-order caller of the workbench (the connection mapper) is in this branch,
    // so omitting the prop has to be byte-identical to the behaviour before this change.
    renderWorkbench({ issuesOpenCount: 0 });

    expect(within(screen.getByTestId("issues-column-head")).getByText("Nothing to fix")).toBeInTheDocument();
  });

  it("open issues still take precedence over everything", () => {
    renderWorkbench({ issuesOpenCount: 3, issuesAllClear: false });

    const head = screen.getByTestId("issues-column-head");
    expect(within(head).getByText("Fix these before you send")).toBeInTheDocument();
    expect(within(head).getByTestId("issues-column-count")).toHaveTextContent("3");
  });
});
