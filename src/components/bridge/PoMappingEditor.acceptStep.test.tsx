import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

// PoMappingEditor used to seed its `accepted` map from the suggester on mount:
//
//     if (sug.confidence >= AUTO_ACCEPT_THRESHOLD && sug.suggestedColumn) {
//       next.set(sug.canonicalField, sug.suggestedColumn);
//     }
//
// with AUTO_ACCEPT_THRESHOLD = 0.85 — an AI correction applied with no accept
// step, which CLAUDE.md §12 lists among the things this product refuses to
// build. The row then printed the result as a flat 100%:
//
//     const conf = isAcc ? 100 : pendColumn ? Math.round(...) : 0;
//
// so a 0.86 guess nobody had looked at rendered as maximum confidence, in the
// one screen where a human is supposed to be the check.
//
// These tests pin BOTH directions, because either alone is passable by a
// cheat:
//   - a suggestion above the old threshold must NOT reach the saved config
//     without a human action  (the auto-apply), and
//   - the confidence displayed must be the model's — a score strictly between
//     0 and 1 renders as itself, never as 100  (the inflation), and
//   - accepting must still work, so the guard cannot be satisfied by making
//     acceptance impossible.

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

// ── The suggestion corpus under test ────────────────────────────────────────
// Three of these sit at or above the retired 0.85 auto-accept threshold, so
// under the old behaviour they arrived already in the mapping, each labelled
// 100%. One sits below it, so it was always a pending card — it is the control
// that proves the pending path itself works.
const SUGGESTIONS: FieldSuggestion[] = [
  { canonicalField: "PoNumber",      suggestedColumn: "po_number",  confidence: 0.97, reason: "exact name match", source: "ai" },
  { canonicalField: "OrderDate",     suggestedColumn: "order_date", confidence: 0.92, reason: "close match",      source: "ai" },
  { canonicalField: "BuyerItemCode", suggestedColumn: "item_code",  confidence: 0.86, reason: "close match",      source: "ai" },
  { canonicalField: "Quantity",      suggestedColumn: "qty",        confidence: 0.61, reason: "close match",      source: "ai" },
];

const OLD_AUTO_ACCEPT_THRESHOLD = 0.85;
const ABOVE_OLD_THRESHOLD = SUGGESTIONS.filter((s) => s.confidence >= OLD_AUTO_ACCEPT_THRESHOLD);

const COLUMNS = ["po_number", "order_date", "item_code", "qty", "buyer_name"];

/**
 * Anti-vacuity floor. Every negative assertion below ("this field is NOT in the
 * saved config", "no chip reads 100%") passes trivially against a component
 * that rendered nothing, so this runs FIRST and throws before any of them: the
 * corpus is the size expected, it really does contain scores above the retired
 * threshold, those scores are strictly between 0 and 1, and every suggestion
 * reached the DOM — its field has a row, and that row names the column it was
 * matched to.
 *
 * Deliberately state-agnostic. An earlier version asserted four Accept buttons
 * here, which auto-apply also breaks, so restoring the defect made the FLOOR
 * fire and the targeted assertion never ran. A floor must prove the fixture is
 * live without presupposing the fix; whether a suggestion is pending or adopted
 * is the thing under test, and belongs in the tests, not in the floor.
 */
function floor() {
  expect(SUGGESTIONS).toHaveLength(4);
  expect(ABOVE_OLD_THRESHOLD).toHaveLength(3);
  expect(ABOVE_OLD_THRESHOLD.map((s) => s.canonicalField)).toEqual([
    "PoNumber",
    "OrderDate",
    "BuyerItemCode",
  ]);
  for (const s of SUGGESTIONS) {
    expect(s.suggestedColumn).toBeTruthy();
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThan(1);
    // The suggestion reached the screen in some state. Without this the sweeps
    // below would be vacuous against a component that rendered nothing.
    expect(row(s.canonicalField).textContent).toContain(s.suggestedColumn!);
  }
}

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

import { PoMappingEditor, scoreForColumn } from "./PoMappingEditor";

const row = (canonical: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${canonical}"]`);
  if (!el) throw new Error(`no row rendered for ${canonical}`);
  return el as HTMLElement;
};

/** Every canonical field the built config maps, flattened across header/lines. */
const mappedFields = (cfg: PoMappingConfig): string[] => [
  ...Object.keys(cfg.header ?? {}),
  ...Object.keys(cfg.lines ?? {}),
];

const mappedColumn = (cfg: PoMappingConfig, field: string): string | undefined =>
  cfg.header?.[field]?.externalField ?? cfg.lines?.[field]?.externalField;

let onSave: ReturnType<typeof vi.fn>;

function renderEditor(initialConfig: PoMappingConfig | null = null) {
  onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PoMappingEditor supplierId="sup-1" initialConfig={initialConfig} onSave={onSave} />,
  );
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
const savedConfig = (): PoMappingConfig => {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as PoMappingConfig;
};

beforeEach(() => { suggestions = SUGGESTIONS; });
afterEach(cleanup);

describe("PoMappingEditor — nothing enters the mapping without a human action", () => {
  it("does not auto-apply suggestions above the retired 0.85 threshold", () => {
    renderEditor();
    floor();

    // Read off the footer rather than off a save: `Save mapping` now refuses an incomplete
    // mapping (PoMappingEditor.saveGate.test.tsx), and an empty one is incomplete by definition.
    // The footer is a stronger probe anyway — it NAMES the required fields still unmapped, and
    // every suggestion above the retired threshold is one of them. Restore the auto-apply and
    // those names disappear from this list.
    const footerNote = screen.getByText(/Map required \(\*\) fields to continue/);
    for (const label of ["PO Number", "Order Date", "Buyer Item Code"]) {
      expect(footerNote.textContent).toContain(label);
    }
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled();

    save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps an unaccepted suggestion visibly pending rather than silently absent", () => {
    renderEditor();
    floor();

    // Every suggestion is awaiting a decision — none was adopted on mount.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(4);
    for (const s of SUGGESTIONS) {
      expect(within(row(s.canonicalField)).getByText("pending")).toBeTruthy();
    }

    // The highest-scoring suggestion of all — the one the old code was surest
    // about — is present, attributed, scored, and awaiting a decision.
    const r = row("PoNumber");
    expect(within(r).getByText("pending")).toBeTruthy();
    expect(within(r).getByText("AI · 97%")).toBeTruthy();
    expect(within(r).getByText("Not mapped yet")).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Reject" })).toBeTruthy();
  });
});

describe("PoMappingEditor — the confidence shown is the confidence returned", () => {
  it("renders a score strictly between 0 and 1 as itself, not as 100%", () => {
    renderEditor();
    floor();

    // 0 < 0.86 < 1 — asserted in floor() for every member of the corpus.
    expect(within(row("BuyerItemCode")).getByText("AI · 86%")).toBeTruthy();
    expect(within(row("PoNumber")).getByText("AI · 97%")).toBeTruthy();
    expect(within(row("OrderDate")).getByText("AI · 92%")).toBeTruthy();
    expect(within(row("Quantity")).getByText("AI · 61%")).toBeTruthy();

    // Nothing anywhere claims 100% — no suggestion in the corpus scored it.
    expect(screen.queryByText(/100%/)).toBeNull();
    expect(screen.queryByLabelText("AI confidence 100%")).toBeNull();
  });

  it("still shows the model's score after the suggestion is accepted", () => {
    renderEditor();
    floor();

    fireEvent.click(within(row("BuyerItemCode")).getByRole("button", { name: "Accept" }));

    // Accepting is a statement about the human, not a new score. 0.86 stays 86.
    expect(within(row("BuyerItemCode")).getByLabelText("AI confidence 86%")).toBeTruthy();
    expect(screen.queryByLabelText("AI confidence 100%")).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it("marks a saved column nothing scored as 'Not scored' rather than 100%", () => {
    // BuyerName is mapped in the saved config but has no suggestion at all —
    // the shape that produced a green 100% both here and in c8610e4.
    renderEditor({
      hasHeaderRecord: true,
      separator: ",",
      header: { BuyerName: { externalField: "buyer_name" } },
      lines: {},
    });
    floor();

    expect(within(row("BuyerName")).getByText("Not scored")).toBeTruthy();
    expect(screen.queryByLabelText("AI confidence 100%")).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });
});

describe("PoMappingEditor — accepting still works", () => {
  it("adopts a single accepted suggestion into the saved config", () => {
    renderEditor();
    floor();

    fireEvent.click(within(row("BuyerItemCode")).getByRole("button", { name: "Accept" }));

    // Only that one — accepting one field does not adopt its neighbours. Read off the footer,
    // which names the required fields still unmapped, because a partial mapping can no longer be
    // saved (PoMappingEditor.saveGate.test.tsx).
    const footerNote = screen.getByText(/Map required \(\*\) fields to continue/);
    for (const label of ["PO Number", "Order Date", "Quantity"]) {
      expect(footerNote.textContent).toContain(label);
    }
    expect(footerNote.textContent).not.toContain("Buyer Item Code");

    // And the accepted one really does reach the saved config.
    fireEvent.click(screen.getByRole("button", { name: /Accept all 3/ }));
    save();
    expect(mappedColumn(savedConfig(), "BuyerItemCode")).toBe("item_code");
  });

  it("adopts every pending suggestion through one explicit bulk accept, reversibly", () => {
    renderEditor();
    floor();

    fireEvent.click(screen.getByRole("button", { name: /Accept all 4/ }));
    expect(screen.getByText("Accepted 4 suggestions.")).toBeTruthy();

    save();
    expect(mappedFields(savedConfig()).sort()).toEqual(
      SUGGESTIONS.map((s) => s.canonicalField).sort(),
    );

    // Reversible: Undo puts them back to pending, it does not merely hide them.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(4);
    for (const s of SUGGESTIONS) {
      expect(within(row(s.canonicalField)).getByText("pending")).toBeTruthy();
    }
  });

  it("drops a rejected suggestion from both the mapping and the pending set", () => {
    renderEditor();
    floor();

    fireEvent.click(within(row("PoNumber")).getByRole("button", { name: "Reject" }));
    expect(within(row("PoNumber")).getByText("unmapped")).toBeTruthy();

    // A bulk accept must not quietly pick it back up. PoNumber is required, so the proof that it
    // stayed out of the mapping is the footer naming it — and the save refusing because of it.
    fireEvent.click(screen.getByRole("button", { name: /Accept all 3/ }));
    const footerNote = screen.getByText(/Map required \(\*\) fields to continue/);
    expect(footerNote.textContent).toContain("PO Number");
    expect(footerNote.textContent).not.toContain("Order Date");
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled();

    save();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("PoMappingEditor — violet is reserved for model output", () => {
  it("labels a local heuristic match MATCH, not AI, at its true score", () => {
    // `suggestMappingFields` falls back to `heuristicSuggestFields` on a network
    // error, a 404, any non-OK status, a parse failure or an empty payload — and
    // that fallback is the entire mock path. Those are string-similarity scores,
    // not model output, so they must not wear the `ai` token or the "AI" tag.
    suggestions = SUGGESTIONS.map((s) => ({ ...s, source: "heuristic" }));
    renderEditor();
    floor();

    expect(within(row("BuyerItemCode")).getByText("MATCH · 86%")).toBeTruthy();
    expect(screen.queryByText(/^AI · /)).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });
});

describe("scoreForColumn", () => {
  const sug: FieldSuggestion = {
    canonicalField: "BuyerItemCode",
    suggestedColumn: "item_code",
    confidence: 0.86,
    reason: "close match",
    source: "ai",
  };

  it("returns the model's score for the column it actually suggested", () => {
    expect(scoreForColumn(sug, "item_code")).toBe(86);
  });

  it("returns null when the mapped column is not the one scored", () => {
    // The operator edited the mapping to a different column — the 0.86 was
    // never about this pairing, so it may not be shown against it.
    expect(scoreForColumn(sug, "sku")).toBeNull();
  });

  it("returns null when nothing scored the field, rather than defaulting to 100", () => {
    expect(scoreForColumn(undefined, "buyer_name")).toBeNull();
    expect(scoreForColumn(sug, null)).toBeNull();
    expect(scoreForColumn(sug, undefined)).toBeNull();
  });

  it("never invents a score for a suggestion that matched nothing", () => {
    const unmatched: FieldSuggestion = { ...sug, suggestedColumn: null, confidence: 0 };
    expect(scoreForColumn(unmatched, "item_code")).toBeNull();
  });
});
