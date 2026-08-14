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

import { orderProblemState } from "@/lib/orderStatusManifest";
import { MapperWorkbench, type MapperIssuesVerdict } from "./MapperWorkbench";

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

function renderWorkbench(props: { issuesOpenCount?: number; issuesVerdict?: MapperIssuesVerdict } = {}) {
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
        issuesVerdict={props.issuesVerdict}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

/** The green check badge — the strongest all-clear claim the head makes. */
function hasGreenTick(): boolean {
  const head = screen.getByTestId("issues-column-head");
  return head.querySelector('span[style*="rgb(46, 142, 58)"] svg') != null;
}

describe("MapperWorkbench — the Issues column head (WP-39 §4.3)", () => {
  it("does not say 'Nothing to fix' when the order stopped for another reason", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: "problem" });

    const head = screen.getByTestId("issues-column-head");
    expect(within(head).queryByText("Nothing to fix")).toBeNull();
    expect(within(head).getByText("Something else stopped this order")).toBeInTheDocument();
    expect(hasGreenTick()).toBe(false);
  });

  it("still says 'Nothing to fix' when there is genuinely nothing wrong", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: "clear" });

    expect(within(screen.getByTestId("issues-column-head")).getByText("Nothing to fix")).toBeInTheDocument();
    expect(hasGreenTick()).toBe(true);
  });

  it("open issues still take precedence over everything", () => {
    renderWorkbench({ issuesOpenCount: 3, issuesVerdict: "problem" });

    const head = screen.getByTestId("issues-column-head");
    expect(within(head).getByText("Fix these before you send")).toBeInTheDocument();
    expect(within(head).getByTestId("issues-column-count")).toHaveTextContent("3");
  });
});

// ── The verdict is a THIRD state, and the head must not round it to "fine" ──────
//
// `issuesAllClear` was a boolean and the order screen produced it by NEGATING
// `isProblemBucketStatus`, which answers false for a status this build has never heard
// of. Unknown therefore arrived as `true` and drew the green tick beside the words
// "Nothing to fix" — the strongest all-clear on the screen — on the one order the
// frontend understood least. Frontend and backend deploy separately, so a status this
// build cannot read is a routine event, not a hypothetical.
//
// Asserted on rendered TEXT and on the tick element, never on the prop: the whole defect
// was that the prop was set to a confident value and the DOM faithfully drew it.
describe("MapperWorkbench — an unreadable verdict never renders as an all-clear", () => {
  it("does not claim an all-clear when the caller could not tell", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: "unknown" });

    expect(document.body.textContent).not.toContain("Nothing to fix");
    expect(document.body.textContent).toContain("We can't confirm this order is clear");
    expect(hasGreenTick()).toBe(false);
  });

  it("does not claim a stoppage it never observed either", () => {
    // The safe direction is still not a licence to invent the opposite claim. Nothing
    // told us this order stopped; only that we cannot read its state.
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: "unknown" });

    expect(document.body.textContent).not.toContain("Something else stopped this order");
  });

  it("treats an omitted verdict as unknown, not as zero issues", () => {
    // This used to fall back to `issuesOpenCount === 0` — the exact substitution the prop
    // exists to prevent, restated as a default. No caller that mounts the issues column
    // omits the verdict in production; if one ever does, it gets the honest answer.
    renderWorkbench({ issuesOpenCount: 0 });

    expect(document.body.textContent).not.toContain("Nothing to fix");
    expect(hasGreenTick()).toBe(false);
  });
});

// ── The real producer, wired to the real manifest ───────────────────────────────
//
// The two halves of the defect were `orderProblemState`'s ancestor answering false for an
// unknown status and the head rendering that false as green. This drives the SHIPPED
// manifest function into the SHIPPED head, so neither half can be fixed alone and still
// pass. The status below is deliberately not in ORDER_STATUS_FACTS — a real backend
// status the frontend has not learned yet is exactly this shape.
describe("MapperWorkbench — real status through the real manifest", () => {
  it("draws no all-clear for a status this build has never heard of", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: orderProblemState("awaiting_supplier_ack") });

    expect(document.body.textContent).not.toContain("Nothing to fix");
    expect(hasGreenTick()).toBe(false);
  });

  it("still draws the all-clear for a healthy status it does know", () => {
    // The anti-vacuity half: a head that never says "Nothing to fix" would pass every
    // assertion above while being just as useless.
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: orderProblemState("delivered") });

    expect(document.body.textContent).toContain("Nothing to fix");
    expect(hasGreenTick()).toBe(true);
  });

  it("draws no all-clear for a status it knows to be a problem", () => {
    renderWorkbench({ issuesOpenCount: 0, issuesVerdict: orderProblemState("delivery_failed") });

    expect(document.body.textContent).not.toContain("Nothing to fix");
    expect(hasGreenTick()).toBe(false);
  });
});
