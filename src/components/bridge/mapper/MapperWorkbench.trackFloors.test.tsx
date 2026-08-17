// THE THREE-PANE GRID MOUNTED AT 1024px AND NEEDED 1040px.
//
// It renders under `hidden lg:grid` — Tailwind `lg` is 1024px — as a two-level grid:
//
//   OUTER  minmax(0,1.85fr)  minmax(380px,1.05fr)      ← [ canvas | live preview ]
//   INNER  minmax(300px,0.92fr)  minmax(360px,1fr)     ← [ received | outgoing ]
//
// A `minmax()` floor is a hard minimum: the outer's first track is minmax(0,…) and so yields,
// but the inner grid inside it does not — it needs 300 + 360, and the preview needs another
// 380. 1040px total, mounted at 1024. Every viewport from 1024 to 1039 — a 13" laptop, a
// landscape tablet — overflowed horizontally, and OutgoingPane.tsx even carried a comment
// asserting 1024px was "the narrowest width this column renders at".
//
// jsdom applies no CSS and computes no layout, so this reads the floors the component actually
// renders and adds them up. That is not a proxy for the bug — the floors ARE the bug; the
// browser does the same addition.

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

/** Tailwind's `lg` breakpoint — the width this grid is allowed to mount at. */
const LG_PX = 1024;

const TARGETS: TargetField[] = [
  { outputPath: "PoNumber", label: "PO number", scope: "header" },
  { outputPath: "Quantity", label: "Quantity", scope: "line" },
];

function restingModel() {
  return {
    loading: false, saving: false, error: null as string | null,
    override: { customFields: [] },
    sourceFields: [], hasIncomingSource: true, canonicalNodes: [], customFields: [],
    targetFields: TARGETS,
    sourceConnections: {}, outputConnections: {}, fixedValues: {},
    knownSourceTokenIds: new Set<string>(), suggestions: [],
    aiUnavailable: false, validationUnavailable: false,
    overrideUnavailable: false, catalogUnavailable: false,
    validationByKey: new Map(), catalogHintByLine: new Map(), blockingCount: 0,
    tokenValueById: new Map(),
    canonicalValueByKey: new Map([["PoNumber", "PO-1"], ["Quantity", "3"]]),
    labelForCanonical: (k: string) => k,
    signature: "sig", lastTouched: null, previewOrderId: "ord-1", outputFormat: null,
    readOnly: false,
    onSourceConnect: vi.fn(), onSourceDisconnect: vi.fn(), onTargetConnect: vi.fn(),
    onTargetDisconnect: vi.fn(), onSetFixedValue: vi.fn(), onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(), onFieldManipulatorsChange: vi.fn(), onUseCatalogPrice: vi.fn(),
    onAddField: vi.fn(),
  };
}

/**
 * Every hard pixel minimum in a `grid-template-columns` value: the first argument of each
 * `minmax()` when it is a px length, plus any bare px track. `1fr` / `minmax(0,…)` contribute
 * nothing — they yield — which is exactly how the browser resolves them.
 */
function trackFloors(template: string): number[] {
  const out: number[] = [];
  for (const [, floor] of template.matchAll(/minmax\(\s*(-?[\d.]+)px/g)) out.push(Number(floor));
  for (const [, bare] of template.matchAll(/(?:^|\s)(\d+)px(?![^(]*\))/g)) out.push(Number(bare));
  return out;
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

beforeEach(() => {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, restingModel());
});

afterEach(cleanup);

function renderGrid() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MapperWorkbench variant="order" orderId="ord-1" supplierId="sup-1" />
    </QueryClientProvider>,
  );
  const outer = screen.getByTestId("mapper-desktop-grid");
  const inner = outer.querySelector("[data-mapper-canvas]") as HTMLElement | null;
  expect(inner).toBeTruthy();
  return {
    outer: outer.style.gridTemplateColumns,
    inner: (inner as HTMLElement).style.gridTemplateColumns,
  };
}

describe("MapperWorkbench — the desktop grid fits the breakpoint it mounts at", () => {
  it("keeps the combined track floors within 1024px", () => {
    const { outer, inner } = renderGrid();

    // The outer's FIRST track hosts the inner grid, so the inner floors are what that track
    // really costs; the outer's remaining floors are the preview column.
    const total = sum(trackFloors(inner)) + sum(trackFloors(outer));

    expect(total).toBeLessThanOrEqual(LG_PX);
  });

  it("parsed real floors — the sum is not zero by accident", () => {
    // Anti-vacuity for the extractor. `minmax(0,1fr)` everywhere would satisfy the assertion
    // above with a total of 0 while destroying the columns, and a regex that matched nothing
    // would do the same silently.
    const { outer, inner } = renderGrid();
    const floors = [...trackFloors(inner), ...trackFloors(outer)];

    expect(floors.length).toBe(3);
    for (const f of floors) expect(f).toBeGreaterThanOrEqual(200);
  });
});

describe("MapperWorkbench — anti-vacuity: the check catches the shipped defect", () => {
  it("fails the same measurement against the floors that were there before the fix", () => {
    // The literal pre-fix values. If this check could not refuse them it could not have caught
    // the bug, and every assertion above would be decoration.
    const before = sum(trackFloors("minmax(300px,0.92fr) minmax(360px,1fr)"))
      + sum(trackFloors("minmax(0,1.85fr) minmax(380px,1.05fr)"));

    expect(before).toBe(1040);
    expect(before).toBeGreaterThan(LG_PX);
  });

  it("counts a bare px track too — the collapsed-rail layouts use one", () => {
    // `incomingCollapsed` renders "46px minmax(340px,1fr)". A floor extractor blind to bare px
    // tracks would under-count that layout and pass it however wide it grew.
    expect(trackFloors("46px minmax(340px,1fr)")).toEqual([340, 46]);
  });
});
