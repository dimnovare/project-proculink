import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WorkshopStatusBar, dedupeBlockerChips } from "./WorkshopStatusBar";
import type { MapperToolbarState } from "../mapper/MapperWorkbench";

// Radix DropdownMenu (the ⋯ overflow) positions its content with a
// ResizeObserver, which jsdom does not implement — stub it for these tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

function mapperState(over: Partial<MapperToolbarState> = {}): MapperToolbarState {
  return {
    mapped: 5,
    total: 8,
    requiredUnmapped: 0,
    saving: false,
    justSaved: false,
    error: null,
    aiUnavailable: false,
    showConnections: true,
    toggleConnections: vi.fn(),
    openLayoutDesigner: vi.fn(),
    openTemplateEditor: vi.fn(),
    catalogHintCount: 0,
    fillFromCatalog: null,
    ...over,
  };
}

afterEach(cleanup);

describe("dedupeBlockerChips", () => {
  test("identical titles collapse into one chip with a count; the FIRST id is kept", () => {
    const chips = dedupeBlockerChips([
      { id: "line:l1", name: "Needs a supplier code" },
      { id: "line:l2", name: "Needs a supplier code" },
      { id: "line:l3", name: "AI suggestion to review" },
    ]);
    expect(chips).toEqual([
      { id: "line:l1", name: "Needs a supplier code", count: 2 },
      { id: "line:l3", name: "AI suggestion to review", count: 1 },
    ]);
  });
});

describe("WorkshopStatusBar", () => {
  test("zero blockers → the red segment is absent entirely (single white row)", () => {
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.getByTestId("workshop-status-bar")).toBeTruthy();
    expect(screen.queryByTestId("status-bar-blockers")).toBeNull();
    expect(screen.queryByText(/blocker/)).toBeNull();
  });

  test("duplicate blocker titles dedupe into '<title> ×k'; clicking jumps to the FIRST issue", () => {
    const onJump = vi.fn();
    render(
      <WorkshopStatusBar
        blockers={[
          { id: "line:l1", name: "Needs a supplier code" },
          { id: "line:l2", name: "Needs a supplier code" },
        ]}
        onJump={onJump}
        mapper={null}
      />,
    );
    expect(screen.getByText(/2 blockers/)).toBeTruthy();
    const chip = screen.getByTitle("Jump to Needs a supplier code");
    expect(chip.textContent).toContain("Needs a supplier code ×2");
    fireEvent.click(chip);
    expect(onJump).toHaveBeenCalledWith("line:l1");
  });

  test("'Resolve suggested (n)' fires the resolve-all handler; absent at count 0", () => {
    const onResolveAll = vi.fn();
    const { rerender } = render(
      <WorkshopStatusBar
        blockers={[{ id: "a", name: "AI suggestion to review" }]}
        onJump={vi.fn()}
        onResolveAll={onResolveAll}
        resolveAllCount={2}
        mapper={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /resolve suggested \(2\)/i });
    fireEvent.click(btn);
    expect(onResolveAll).toHaveBeenCalled();

    rerender(
      <WorkshopStatusBar
        blockers={[{ id: "a", name: "AI suggestion to review" }]}
        onJump={vi.fn()}
        onResolveAll={onResolveAll}
        resolveAllCount={0}
        mapper={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /resolve suggested/i })).toBeNull();
  });

  test("the mapped chip shows M/T from the re-hosted mapper state; absent until it registers", () => {
    const { rerender } = render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={null} />);
    expect(screen.queryByText(/mapped/)).toBeNull();
    rerender(
      <WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState({ mapped: 13, total: 13 })} />,
    );
    expect(screen.getByText(/13\/13 mapped/)).toBeTruthy();
  });

  test("the ⋯ overflow contains the four relocated tools; no-hints catalog is disabled with its reason", async () => {
    const st = mapperState();
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={st} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More order tools" }), { key: "Enter" });
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(4);
    const text = items.map((i) => i.textContent ?? "");
    expect(text.some((t) => t.includes("Customize output layout"))).toBe(true);
    expect(text.some((t) => t.includes("Edit as template"))).toBe(true);
    expect(text.some((t) => t.includes("Fill from catalog"))).toBe(true);
    expect(text.some((t) => t.includes("Hide connections"))).toBe(true);
    const catalog = items.find((i) => (i.textContent ?? "").includes("Fill from catalog"))!;
    expect(catalog.getAttribute("aria-disabled")).toBe("true");
    expect(catalog.textContent).toContain("No catalog hints for this order");
    fireEvent.click(screen.getByRole("menuitem", { name: /edit as template/i }));
    expect(st.openTemplateEditor).toHaveBeenCalled();
  });

  test("'Review issues' joins the overflow only while blockers exist", async () => {
    const onReviewIssues = vi.fn();
    render(
      <WorkshopStatusBar
        blockers={[{ id: "x", name: "Needs a supplier code" }]}
        onJump={vi.fn()}
        onReviewIssues={onReviewIssues}
        mapper={mapperState()}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More order tools" }), { key: "Enter" });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toContain("Review issues");
    fireEvent.click(screen.getByRole("menuitem", { name: "Review issues" }));
    expect(onReviewIssues).toHaveBeenCalled();
  });
});

/**
 * WP-28 — the issue COUNT must be readable without a click, in EVERY layout
 * state. The issue list itself is promoted to an always-rendered region in the
 * third column, but `useWorkshopLayout` can rail that whole column
 * (Focus = Mapping) and it persists that choice in sessionStorage — so the
 * status bar carries the count too. Belt and braces, deliberately.
 *
 * The shipped contract is preserved exactly: at zero blockers the red segment is
 * still absent and the word "blocker" still never appears.
 */
describe("WorkshopStatusBar — the issue summary is always present", () => {
  test("no issues at all → a calm 'No issues' chip (never '0 blockers')", () => {
    render(<WorkshopStatusBar blockers={[]} notes={0} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.getByTestId("status-bar-issue-summary").textContent).toBe("No issues");
    expect(screen.queryByTestId("status-bar-blockers")).toBeNull();
    expect(screen.queryByText(/blocker/)).toBeNull();
  });

  test("warnings only → the count is stated as optional, and the row stays non-red", () => {
    render(<WorkshopStatusBar blockers={[]} notes={2} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.getByTestId("status-bar-issue-summary").textContent).toBe("2 optional");
    expect(screen.queryByTestId("status-bar-blockers")).toBeNull();
  });

  test("one warning uses singular grammar", () => {
    render(<WorkshopStatusBar blockers={[]} notes={1} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.getByTestId("status-bar-issue-summary").textContent).toBe("1 optional");
  });

  // ── the tooltip on that chip ───────────────────────────────────────────────
  // It said "Every required field is filled and every rule passed." — a claim
  // STRONGER than the one acceptanceGateModel.readyBarLabel had already retired
  // on this same screen, off these same two numbers. No rule-level check runs
  // here at all (POST /api/orders/{id}/validate has no caller in src/), and the
  // gate decision cannot tell "the supplier has no rules" from "every rule
  // passed". Read off the rendered DOM, never off the prop: an assertion on what
  // the component was HANDED passes while the attribute says something else.

  test("no issues → the tooltip bounds the claim instead of asserting every rule passed", () => {
    render(<WorkshopStatusBar blockers={[]} notes={0} onJump={vi.fn()} mapper={mapperState()} />);
    const title = screen.getByTestId("status-bar-issue-summary").getAttribute("title") ?? "";
    expect(title).toBe(
      "Nothing is blocking this order. This is everything ProcuLink can check before sending.",
    );
    // The false sentence is nowhere in the rendered document, attributes included.
    expect(document.body.innerHTML).not.toMatch(/every rule passed/i);
    expect(document.body.innerHTML).not.toMatch(/filled and check/i);
  });

  test("warnings only → the already-true wording survives untouched", () => {
    render(<WorkshopStatusBar blockers={[]} notes={2} onJump={vi.fn()} mapper={mapperState()} />);
    const chip = screen.getByTestId("status-bar-issue-summary");
    expect(chip.getAttribute("title")).toBe(
      "Nothing is blocking this order. These are worth a look before you send.",
    );
    // Anti-vacuity: the chip is really rendering, and the two states really differ.
    expect(chip.textContent).toBe("2 optional");
    expect(document.body.innerHTML).not.toMatch(/every rule passed/i);
  });

  test("blockers present → the red segment owns the count; no duplicate summary chip", () => {
    render(
      <WorkshopStatusBar
        blockers={[{ id: "a", name: "Needs a supplier code" }]}
        notes={2}
        onJump={vi.fn()}
        mapper={mapperState()}
      />,
    );
    expect(screen.getByTestId("status-bar-blockers")).toBeTruthy();
    expect(screen.queryByTestId("status-bar-issue-summary")).toBeNull();
  });
});

/**
 * WP-28 — the two banners that used to stack ABOVE the three columns are
 * re-hosted here, the same way the 2026-07 wave re-hosted the mapper toolbar.
 */
describe("WorkshopStatusBar — re-hosted bands", () => {
  test("the send flow notice renders inside the one status row, not as its own band", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState()}
        notice="Sent to ElectroSupply Co."
        noticeSeverity="success"
      />,
    );
    const notice = screen.getByTestId("status-bar-notice");
    expect(notice.textContent).toBe("Sent to ElectroSupply Co.");
    // Inside the bar — not a sibling band above the columns.
    expect(screen.getByTestId("workshop-status-bar").contains(notice)).toBe(true);
  });

  test("no notice → no notice element at all", () => {
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.queryByTestId("status-bar-notice")).toBeNull();
  });

  test("AI mapping suggestions become a chip here, and dismiss-all moves to the overflow", async () => {
    const dismissAllSuggestions = vi.fn();
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ suggestionCount: 2, dismissAllSuggestions })}
      />,
    );
    const chip = screen.getByTestId("status-bar-ai-suggestions");
    expect(chip.textContent).toContain("2 AI suggestions");
    // The visible-accept-step guarantee survives the move.
    expect(chip.getAttribute("title")).toMatch(/nothing is applied automatically/i);

    fireEvent.keyDown(screen.getByRole("button", { name: "More order tools" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /dismiss all ai suggestions/i }));
    expect(dismissAllSuggestions).toHaveBeenCalled();
  });

  test("no suggestions → no chip and no dismiss-all item", async () => {
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.queryByTestId("status-bar-ai-suggestions")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "More order tools" }), { key: "Enter" });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent ?? "").some((t) => /dismiss all ai/i.test(t))).toBe(false);
  });
});

// ── WP-13 · the promote control ──────────────────────────────────────────────
// The bar is the ONLY place this control can live in the workshop: the mapper's
// own "Save mappings" button sits inside the `!hideToolbar` block, and the
// workshop passes `hideToolbar`. Hosts that do NOT pass a handler (the mapping
// panel, the connection editor) must be unaffected — hence the absence test.
describe("save mappings", () => {
  test("no handler → no control at all (other hosts are untouched)", () => {
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.queryByRole("button", { name: /save mappings/i })).toBeNull();
  });

  test("a handler renders the control, and clicking it calls back", () => {
    const onSaveMappings = vi.fn();
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState()}
        onSaveMappings={onSaveMappings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save mappings/i }));
    expect(onSaveMappings).toHaveBeenCalledTimes(1);
  });

  test("in flight: label changes and the control is disabled", () => {
    const onSaveMappings = vi.fn();
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState()}
        onSaveMappings={onSaveMappings}
        savingMappings
      />,
    );
    const btn = screen.getByRole("button", { name: /saving/i });
    expect(btn).toHaveProperty("disabled", true);
    fireEvent.click(btn);
    expect(onSaveMappings).not.toHaveBeenCalled();
  });

  test("a disabled reason disables the control AND is readable as its tooltip", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState()}
        onSaveMappings={vi.fn()}
        saveMappingsDisabledReason="Assign a supplier first — there is nowhere to save this yet."
      />,
    );
    const btn = screen.getByRole("button", { name: /save mappings/i });
    expect(btn).toHaveProperty("disabled", true);
    expect(btn.getAttribute("title")).toContain("Assign a supplier first");
  });
});
