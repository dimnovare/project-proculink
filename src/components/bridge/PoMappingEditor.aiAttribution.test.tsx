import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

// A Levenshtein match wearing an "AI confidence" badge.
//
// `PoMappingEditor` rendered the accepted-row chip as
//
//     score != null && <ConfidenceChip value={score} label="AI confidence" />
//
// gated on the score EXISTING and nothing else. But `suggestMappingFields` falls back to
// `heuristicSuggestFields` — a client-side string-similarity pass, `source: "heuristic"` — on a
// network error, a 404, any non-OK status, an empty payload, or a parse failure. So the row
// announced `aria-label="AI confidence 89%"` for a local Levenshtein score, and it did so most
// loudly exactly when the AI was UNAVAILABLE.
//
// The file already had `isModelSuggestion` for precisely this distinction, with a docstring
// saying "a Levenshtein match must not wear it or claim an 'AI ·' score" — and used it in one
// place only, to colour the surrounding card.
//
// Both directions are pinned below, plus the anti-vacuity floor: a corpus that never rendered
// would pass every negative assertion here for free.

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

const COLUMNS = ["po_number", "order_date", "item_code", "qty", "buyer_name"];

/** What `heuristicSuggestFields` produces: a real similarity score, no model behind it. */
const HEURISTIC: FieldSuggestion[] = [
  { canonicalField: "PoNumber", suggestedColumn: "po_number", confidence: 0.89, reason: "token overlap", source: "heuristic" },
];

/** What the backend produces when the suggester really ran. */
const MODEL: FieldSuggestion[] = [
  { canonicalField: "PoNumber", suggestedColumn: "po_number", confidence: 0.89, reason: "model match", source: "ai" },
];

/** A payload that states no attribution at all — the `?? "ai"` default used to call this AI. */
const UNATTRIBUTED: FieldSuggestion[] = [
  { canonicalField: "PoNumber", suggestedColumn: "po_number", confidence: 0.89, reason: "match", source: "unknown" },
];

let suggestions: FieldSuggestion[] = HEURISTIC;

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

import { PoMappingEditor } from "./PoMappingEditor";

const row = (canonical: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${canonical}"]`);
  if (!el) throw new Error(`no row rendered for ${canonical}`);
  return el as HTMLElement;
};

function renderEditor(initialConfig: PoMappingConfig | null = null) {
  render(
    <PoMappingEditor supplierId="sup-1" initialConfig={initialConfig} onSave={vi.fn().mockResolvedValue(undefined)} />,
  );
}

/**
 * The suggestion is accepted onto the row, which is the state that renders the chip under test.
 * A pending row renders the <AiSuggestion> card instead, so the chip assertions would be vacuous.
 */
const ACCEPTED_CONFIG: PoMappingConfig = {
  hasHeaderRecord: true,
  separator: ",",
  header: { PoNumber: { externalField: "po_number" } },
  lines: {},
};

/**
 * Anti-vacuity floor: prove the row rendered, that it is in the ACCEPTED state, and that a
 * percentage really is on screen — so "no AI wording" below cannot pass against a blank render
 * or against a fix that simply deleted the chip.
 */
function floor() {
  const r = row("PoNumber");
  expect(r.textContent).toContain("po_number");
  expect(within(r).getByText("89%")).toBeInTheDocument();
}

beforeEach(() => { suggestions = HEURISTIC; });
afterEach(cleanup);

describe("PoMappingEditor — only a model score may be called AI", () => {
  it("a heuristic match shows its score WITHOUT any AI wording", () => {
    suggestions = HEURISTIC;
    renderEditor(ACCEPTED_CONFIG);
    floor();

    const r = row("PoNumber");

    // The number stays: a similarity score is a real measurement and hiding it helps nobody.
    expect(within(r).getByText("89%")).toBeInTheDocument();

    // The attribution goes. Asserted on the ACCESSIBLE NAME as well as the text, because the
    // defect lived in an aria-label — an assertion on textContent alone would sail straight past
    // the exact string it exists to stop.
    expect(within(r).queryByLabelText(/AI confidence/i)).toBeNull();
    expect(r.querySelector('[aria-label*="AI confidence"]')).toBeNull();
    expect(within(r).getByLabelText("Match 89%")).toBeInTheDocument();

    // And nowhere in the document either — the row is the only place this can appear, but the
    // sweep costs nothing and catches a copy elsewhere.
    expect(document.querySelector('[aria-label*="AI confidence"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/AI confidence/i);
  });

  it("an unattributed payload is not treated as AI either", () => {
    // `coerceSuggestions` used to default a missing `source` to "ai", so a backend response that
    // simply omitted the field switched on the violet card and the AI chip.
    suggestions = UNATTRIBUTED;
    renderEditor(ACCEPTED_CONFIG);
    floor();

    expect(document.querySelector('[aria-label*="AI confidence"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/AI confidence/i);
  });

  it("CONTROL — a real model suggestion is still labelled AI confidence", () => {
    // The same score, the same row, the only difference being who produced it. Without this the
    // guard above is satisfiable by never rendering the AI label at all.
    suggestions = MODEL;
    renderEditor(ACCEPTED_CONFIG);
    floor();

    const r = row("PoNumber");
    expect(within(r).getByLabelText("AI confidence 89%")).toBeInTheDocument();
    expect(within(r).getByText("89%")).toBeInTheDocument();
  });

  it("a pairing nothing scored shows 'Not scored', not a percentage", () => {
    suggestions = [
      { canonicalField: "PoNumber", suggestedColumn: "po_number", confidence: null, reason: "", source: "unknown" },
    ];
    renderEditor(ACCEPTED_CONFIG);

    const r = row("PoNumber");
    expect(within(r).getByText("Not scored")).toBeInTheDocument();
    expect(r.textContent).not.toMatch(/\d+%/);
    expect(r.querySelector('[aria-label*="confidence"]')).toBeNull();
  });
});
