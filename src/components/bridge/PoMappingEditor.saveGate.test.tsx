// Two ways this editor said one thing and did another.
//
// ── 1. "Map required (*) fields to continue" — and then it continued ───────────────────────────
//
// The footer printed that sentence and dimmed the Save button to 0.6 opacity, but the button was
// only ever `disabled={isSaving}`. So it was fully clickable: a mapping with no PoNumber, no
// OrderDate and no Quantity was persisted through `onSave`, and "Mapping saved" was printed over
// it. There was no `aria-disabled` either, so assistive tech announced an enabled button while
// sighted users were looking at a greyed one — the two audiences were told opposite things about
// the same control.
//
// ── 2. "Accept all N" counted one thing and changed another ───────────────────────────────────
//
//     if (!next.has(sug.canonicalField)) count++;
//     next.set(sug.canonicalField, sug.suggestedColumn);   // unconditional
//
// `count` only rose for a field that was NOT already mapped, while `set` replaced regardless. Point
// three suggestions at fields that already have a mapping and the editor reported "Nothing new to
// accept.", rewrote all three, and — because the undo snapshot is stored as
// `setBulkUndo(count > 0 ? before : null)` — threw away the only way back. The button beside it
// said "Accept all 3", because the LABEL counts with the right predicate
// (`accepted.get(f) !== suggestedColumn`, via `pendingSuggestions`) and the handler did not.
//
// PAIRED ASSERTIONS + ANTI-VACUITY FLOOR. Every refusal is paired with a positive: the save really
// works once the mapping is complete, and the bulk accept really does change the mapping it says
// it changed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

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

/** The four canonical fields the editor marks required, with the labels the footer prints. */
const REQUIRED_LABELS: Record<string, string> = {
  PoNumber: "PO Number",
  OrderDate: "Order Date",
  BuyerItemCode: "Buyer Item Code",
  Quantity: "Quantity",
};

const COLUMNS = ["po_number", "order_date", "item_code", "qty", "buyer_name", "sku", "amount"];

/** One suggestion per required field, so a single "Accept all" can complete the mapping. */
const SUGGESTIONS: FieldSuggestion[] = [
  { canonicalField: "PoNumber",      suggestedColumn: "po_number",  confidence: 0.97, reason: "exact name match", source: "ai" },
  { canonicalField: "OrderDate",     suggestedColumn: "order_date", confidence: 0.92, reason: "close match",      source: "ai" },
  { canonicalField: "BuyerItemCode", suggestedColumn: "item_code",  confidence: 0.86, reason: "close match",      source: "ai" },
  { canonicalField: "Quantity",      suggestedColumn: "qty",        confidence: 0.61, reason: "close match",      source: "ai" },
];

/**
 * A saved mapping that is COMPLETE and points every required field at a DIFFERENT column than the
 * suggester would. This is the re-point case: nothing here is missing, so the old
 * `if (!next.has(...))` counter sees zero, while `set` rewrites all four.
 */
const ALREADY_MAPPED_ELSEWHERE: PoMappingConfig = {
  hasHeaderRecord: true,
  separator: ",",
  header: {
    PoNumber:  { externalField: "sku" },
    OrderDate: { externalField: "amount" },
  },
  lines: {
    BuyerItemCode: { externalField: "buyer_name" },
    Quantity:      { externalField: "sku" },
  },
};

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

import { PoMappingEditor } from "./PoMappingEditor";

const row = (canonical: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${canonical}"]`);
  if (!el) throw new Error(`no row rendered for ${canonical}`);
  return el as HTMLElement;
};

const mappedColumn = (cfg: PoMappingConfig, field: string): string | undefined =>
  cfg.header?.[field]?.externalField ?? cfg.lines?.[field]?.externalField;

let onSave: ReturnType<typeof vi.fn>;

function renderEditor(initialConfig: PoMappingConfig | null = null) {
  onSave = vi.fn().mockResolvedValue(undefined);
  render(<PoMappingEditor supplierId="sup-1" initialConfig={initialConfig} onSave={onSave} />);
}

const saveButton = () => screen.getByRole("button", { name: "Save mapping" });
const clickSave = () => fireEvent.click(saveButton());
const savedConfig = (): PoMappingConfig => {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as PoMappingConfig;
};

/**
 * Anti-vacuity floor. The corpus really does cover every required field (so "Accept all" can
 * complete a mapping and the positive half of each test can run), and every one of those rows is
 * really on screen showing the column it is currently connected to.
 *
 * With `preMapped`, the rows are ACCEPTED rows — they show the stored column, not the suggestion —
 * and the floor additionally proves the fixture is the re-point case: not one stored column is the
 * column its suggestion names. Without that, "Accept all counted the re-points" would be a claim
 * about a fixture that had no re-points in it.
 */
function floorEveryRequiredFieldIsCovered(preMapped?: PoMappingConfig) {
  expect(SUGGESTIONS).toHaveLength(4);
  expect(SUGGESTIONS.map((s) => s.canonicalField).sort()).toEqual(
    Object.keys(REQUIRED_LABELS).sort(),
  );
  for (const s of SUGGESTIONS) {
    expect(s.suggestedColumn).toBeTruthy();
    const onScreen = preMapped ? mappedColumn(preMapped, s.canonicalField) : s.suggestedColumn;
    expect(onScreen).toBeTruthy();
    expect(row(s.canonicalField).textContent).toContain(onScreen!);
    if (preMapped) expect(onScreen).not.toBe(s.suggestedColumn);
  }
}

beforeEach(() => { suggestions = SUGGESTIONS; });
afterEach(cleanup);

describe("PoMappingEditor — Save refuses the mapping the footer already refused", () => {
  it("does not persist a mapping missing required fields, however hard it is clicked", () => {
    renderEditor();
    floorEveryRequiredFieldIsCovered();

    // The state the footer describes.
    expect(screen.getByText(/Map required \(\*\) fields to continue/)).toBeInTheDocument();

    clickSave();
    clickSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText(/Mapping saved/i)).toBeNull();
  });

  it("carries the refusal in the accessibility tree, not only in the opacity", () => {
    renderEditor();
    floorEveryRequiredFieldIsCovered();

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("names the required fields that are still missing", () => {
    // "Map required (*) fields to continue" is a rule; this is the list of rows to go to.
    renderEditor();
    floorEveryRequiredFieldIsCovered();

    fireEvent.click(within(row("PoNumber")).getByRole("button", { name: "Accept" }));

    const footerNote = screen.getByText(/Map required \(\*\) fields to continue/);
    expect(footerNote.textContent).toContain(REQUIRED_LABELS.OrderDate);
    expect(footerNote.textContent).toContain(REQUIRED_LABELS.Quantity);
    // The one just accepted has dropped off the list.
    expect(footerNote.textContent).not.toContain(REQUIRED_LABELS.PoNumber);
  });

  it("saves as soon as the mapping is complete — the gate is the rule, not a lock", () => {
    renderEditor();
    floorEveryRequiredFieldIsCovered();

    fireEvent.click(screen.getByRole("button", { name: /Accept all 4/ }));

    expect(screen.getByText(/All required fields mapped/i)).toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();
    clickSave();

    const cfg = savedConfig();
    for (const s of SUGGESTIONS) {
      expect(mappedColumn(cfg, s.canonicalField)).toBe(s.suggestedColumn);
    }
  });
});

describe("PoMappingEditor — 'Accept all' counts what it changes", () => {
  it("counts a suggestion that re-points an already-mapped field", () => {
    renderEditor(ALREADY_MAPPED_ELSEWHERE);
    // The floor proves the positive half: every required field starts mapped, and mapped to a
    // column no suggestion names.
    floorEveryRequiredFieldIsCovered(ALREADY_MAPPED_ELSEWHERE);

    // The label already counted correctly — it is the handler that did not.
    expect(screen.getByRole("button", { name: /Accept all 4/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Accept all 4/ }));

    // The defect verbatim: four mappings were rewritten under the words "Nothing new to accept."
    expect(screen.queryByText("Nothing new to accept.")).toBeNull();
    expect(screen.getByText("Accepted 4 suggestions.")).toBeInTheDocument();
  });

  it("keeps the undo for a re-point, so the rewrite is reversible", () => {
    renderEditor(ALREADY_MAPPED_ELSEWHERE);
    floorEveryRequiredFieldIsCovered(ALREADY_MAPPED_ELSEWHERE);

    fireEvent.click(screen.getByRole("button", { name: /Accept all 4/ }));

    // `setBulkUndo(count > 0 ? before : null)` — a zero count did not merely mis-report, it
    // discarded the snapshot, which is what made the rewrite unrecoverable.
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);

    // Back to the columns that were there before, not to "unmapped": the pre-existing mapping is
    // what the undo has to restore.
    clickSave();
    const cfg = savedConfig();
    expect(mappedColumn(cfg, "PoNumber")).toBe("sku");
    expect(mappedColumn(cfg, "OrderDate")).toBe("amount");
    expect(mappedColumn(cfg, "BuyerItemCode")).toBe("buyer_name");
    expect(mappedColumn(cfg, "Quantity")).toBe("sku");
  });

  it("still says nothing is new when nothing is", () => {
    // The control. The fix must not turn the count into "always non-zero" — a bulk accept run
    // twice changes nothing the second time, and has to say so.
    renderEditor();
    floorEveryRequiredFieldIsCovered();

    fireEvent.click(screen.getByRole("button", { name: /Accept all 4/ }));
    expect(screen.getByText("Accepted 4 suggestions.")).toBeInTheDocument();

    // Every suggestion is now mapped to exactly what it suggested, so the button retires itself.
    expect(screen.queryByRole("button", { name: /Accept all/ })).toBeNull();
  });
});
