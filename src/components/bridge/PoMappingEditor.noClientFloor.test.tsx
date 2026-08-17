import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

// This editor used to hold a confidence floor of its own:
//
//     const ADOPT_THRESHOLD = 0.50;
//     ... && (sug.confidence ?? 0) >= ADOPT_THRESHOLD
//
// while the backend's accept floor (HeuristicFieldMappingSuggester.MinAcceptScore)
// said 0.45. Two floors, neither aware of the other. The lower one was therefore
// dead — anything the API scored between them was computed, serialized, sent over
// the wire, and dropped here without ever being drawn or explained. On screen,
// "the backend had a weak candidate for this field" and "the backend had nothing"
// were the same picture.
//
// The floor now lives once, in the backend, which no longer emits below it. The
// contract this file pins is that the editor adds no floor back: whatever the API
// returns with a score, the operator gets to see and decide on.
//
// Both directions are pinned, because either alone is passable by a cheat:
//   - a low-scored suggestion must SURFACE, be countable, and be adoptable
//     (a component that dropped it silently would fail), and
//   - an UNSCORED suggestion must still not be offered for one-click adoption
//     (a component that surfaced everything unconditionally would fail).
// Absence of a score is not a low score, and the removal of the floor must not
// quietly turn one into the other.

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/standards/catalog", () => ({ fieldRefList: () => [] }));
vi.mock("./StandardsFieldPopover", () => ({ StandardsFieldPopover: () => null }));
vi.mock("@/lib/api/mapping", () => ({
  getMappingSourceColumns: vi.fn(),
  suggestMappingFields: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  getPoMappingTemplates: vi.fn(),
  applyPoMappingTemplate: vi.fn(),
  ApiHttpError: class ApiHttpError extends Error {
    status = 0;
  },
}));

import type { FieldSuggestion } from "@/lib/api/mapping";
import type { PoMappingConfig } from "@/lib/api/types";

/** The floor this file used to apply, kept only to aim the assertions at it. */
const RETIRED_CLIENT_FLOOR = 0.5;

/** The backend's floor — the only one left. Nothing below this reaches the wire. */
const BACKEND_FLOOR = 0.5;

// Scores chosen to sit in the two places the old client floor mattered:
//   - 0.45 was the backend constant while this file said 0.50: the exact band
//     that was scored and then silently discarded.
//   - 0.50 is the boundary itself, kept as the control that the >= end of the
//     old comparison was never the problem.
const BELOW_RETIRED_FLOOR = 0.45;

const SUGGESTIONS: FieldSuggestion[] = [
  { canonicalField: "PoNumber",      suggestedColumn: "po_number", confidence: 0.97,                reason: "exact name match",         source: "heuristic" },
  { canonicalField: "BuyerItemCode", suggestedColumn: "item_code", confidence: BELOW_RETIRED_FLOOR, reason: "matched 1 signal token",   source: "heuristic" },
  { canonicalField: "Quantity",      suggestedColumn: "qty",       confidence: RETIRED_CLIENT_FLOOR, reason: "matched 2 signal tokens", source: "heuristic" },
];

/** The one the old floor threw away, by name. */
const DISCARDED = SUGGESTIONS.find((s) => s.confidence === BELOW_RETIRED_FLOOR)!;

const COLUMNS = ["po_number", "item_code", "qty", "buyer_name"];

let suggestions: FieldSuggestion[] = SUGGESTIONS;

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === "po-mapping-source-columns") {
      return {
        data: { format: "csv", columns: COLUMNS, sourceOrderId: "ord-1", sample: {} },
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
    }
    if (key === "po-mapping-suggest") {
      return { data: suggestions, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));

import { PoMappingEditor, isSurfaceable } from "./PoMappingEditor";

const row = (canonical: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${canonical}"]`);
  if (!el) throw new Error(`no row rendered for ${canonical}`);
  return el as HTMLElement;
};

const mappedFields = (cfg: PoMappingConfig): string[] => [
  ...Object.keys(cfg.header ?? {}),
  ...Object.keys(cfg.lines ?? {}),
];

let onSave: ReturnType<typeof vi.fn>;

function renderEditor(initialConfig: PoMappingConfig | null = null) {
  onSave = vi.fn().mockResolvedValue(undefined);
  render(<PoMappingEditor supplierId="sup-1" initialConfig={initialConfig} onSave={onSave} />);
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

/**
 * `Save mapping` refuses a mapping that is missing a required canonical field
 * (PoMappingEditor.saveGate.test.tsx) — a product rule, not a fixture detail. These tests are
 * about the retired CONFIDENCE FLOOR, so the required fields this three-suggestion corpus does not
 * cover arrive already mapped, to columns no suggestion here names. Anything the suggester adds on
 * top is therefore visibly its own doing.
 */
function preMapped(fields: Record<string, string>): PoMappingConfig {
  const header: PoMappingConfig["header"] = {};
  const lines: PoMappingConfig["lines"] = {};
  // Mirrors the editor's own header/lines split for these canonical fields.
  for (const [canonical, column] of Object.entries(fields)) {
    if (canonical === "PoNumber" || canonical === "OrderDate") header[canonical] = { externalField: column };
    else lines[canonical] = { externalField: column };
  }
  return { hasHeaderRecord: true, separator: ",", header, lines };
}
const savedConfig = (): PoMappingConfig => {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as PoMappingConfig;
};

/**
 * Anti-vacuity floor. "The low-scored suggestion is on screen" is a positive
 * assertion and cannot pass against a dead component, but the fixture itself can
 * still rot: this runs first and fails loudly if the corpus stops containing a
 * score in the band the old client floor discarded.
 */
function fixtureIsLive() {
  expect(SUGGESTIONS).toHaveLength(3);
  expect(DISCARDED.confidence).toBeLessThan(RETIRED_CLIENT_FLOOR);
  expect(DISCARDED.confidence).toBeGreaterThan(0);
  expect(DISCARDED.suggestedColumn).toBeTruthy();
}

beforeEach(() => { suggestions = SUGGESTIONS; });
afterEach(cleanup);

describe("PoMappingEditor — the editor applies no confidence floor of its own", () => {
  it("draws a suggestion the retired client floor would have discarded", () => {
    fixtureIsLive();
    renderEditor();

    // The whole defect in one assertion: this row exists, names its column, and
    // shows its real score. It used to render as if nothing had been suggested.
    const r = row(DISCARDED.canonicalField);
    expect(r.textContent).toContain(DISCARDED.suggestedColumn!);
    expect(within(r).getByText("pending")).toBeTruthy();
    expect(within(r).getByText("MATCH · 45%")).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("counts it among the pending suggestions rather than hiding it from the total", () => {
    fixtureIsLive();
    renderEditor();

    // All three, not the two that cleared the old floor. A suggestion the
    // operator cannot see in the count is one they cannot know to look for.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Accept all 3/ })).toBeTruthy();
  });

  it("lets the operator adopt it", () => {
    fixtureIsLive();
    // Every required field except the low-scored one arrives mapped, so the save is reachable and
    // the only thing the operator does here is accept the suggestion under test.
    renderEditor(preMapped({ PoNumber: "seeded_po", OrderDate: "seeded_date", Quantity: "seeded_qty" }));

    fireEvent.click(within(row(DISCARDED.canonicalField)).getByRole("button", { name: "Accept" }));
    save();

    const cfg = savedConfig();
    expect(cfg.lines?.[DISCARDED.canonicalField]?.externalField).toBe(DISCARDED.suggestedColumn);
    // and only that one — the neighbours kept the columns they came in with.
    expect(cfg.header?.PoNumber?.externalField).toBe("seeded_po");
    expect(cfg.lines?.Quantity?.externalField).toBe("seeded_qty");
  });

  it("takes it in a bulk accept too", () => {
    fixtureIsLive();
    // OrderDate is required and this corpus does not suggest it, so it arrives mapped.
    renderEditor(preMapped({ OrderDate: "seeded_date" }));

    fireEvent.click(screen.getByRole("button", { name: /Accept all 3/ }));
    expect(screen.getByText("Accepted 3 suggestions.")).toBeTruthy();

    save();
    expect(mappedFields(savedConfig()).sort()).toEqual(
      [...SUGGESTIONS.map((s) => s.canonicalField), "OrderDate"].sort(),
    );
  });

  it("still refuses to offer a suggestion nothing scored", () => {
    // Not a low score — no score. `confidence` is nullable because a payload can
    // omit the number, and removing the floor must not turn that silence into an
    // implicit zero that is now "above the floor" and therefore adoptable.
    suggestions = [{ ...DISCARDED, confidence: null }];
    // Fully mapped on arrival — including the field the unscored suggestion is about, pointed
    // somewhere else. So the save is reachable AND adoption would be visible as a changed column.
    renderEditor(
      preMapped({
        PoNumber: "seeded_po",
        OrderDate: "seeded_date",
        Quantity: "seeded_qty",
        [DISCARDED.canonicalField]: "seeded_item",
      }),
    );

    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept all/ })).toBeNull();

    save();
    expect(savedConfig().lines?.[DISCARDED.canonicalField]?.externalField).toBe("seeded_item");
  });
});

describe("isSurfaceable", () => {
  const base: FieldSuggestion = {
    canonicalField: "BuyerItemCode",
    suggestedColumn: "item_code",
    confidence: 0.86,
    reason: "close match",
    source: "heuristic",
  };

  it("surfaces any scored suggestion, however low, including under the retired floor", () => {
    expect(isSurfaceable(base)).toBe(true);
    expect(isSurfaceable({ ...base, confidence: BELOW_RETIRED_FLOOR })).toBe(true);
    expect(isSurfaceable({ ...base, confidence: 0.01 })).toBe(true);
    expect(isSurfaceable({ ...base, confidence: 0 })).toBe(true);
  });

  it("does not surface a suggestion that matched nothing, or that nothing scored", () => {
    expect(isSurfaceable({ ...base, suggestedColumn: null })).toBe(false);
    expect(isSurfaceable({ ...base, confidence: null })).toBe(false);
    expect(isSurfaceable(undefined)).toBe(false);
    expect(isSurfaceable(null)).toBe(false);
  });

  it("is the only gate — the backend's floor is what decides what arrives", () => {
    // Pinned deliberately as a comparison, not a copy of a constant this file
    // owns: the number lives in ProcuLink.Transform/Mapping/
    // HeuristicFieldMappingSuggester.cs (MinAcceptScore), which is asserted at
    // 0.50 by HeuristicFieldMappingSuggesterTests. If that floor is lowered
    // without a look at this file, this editor will simply render the weaker
    // suggestions — which is the intended behaviour, not a regression. What must
    // never come back is a SECOND floor here, silently disagreeing with it.
    expect(isSurfaceable({ ...base, confidence: BACKEND_FLOOR })).toBe(true);
    expect(isSurfaceable({ ...base, confidence: BACKEND_FLOOR - 0.05 })).toBe(true);
  });
});
