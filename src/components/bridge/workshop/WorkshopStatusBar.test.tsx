import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WorkshopStatusBar, dedupeBlockerChips, UNKNOWN_CHIP_STYLE } from "./WorkshopStatusBar";
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

/**
 * The two UNKNOWN states, re-hosted from the mapper's toolbar.
 *
 * THE DEFECT. `MapperToolbarState` gained `requiredUnknown` and
 * `validationUnavailable` so a host could tell "we checked and it's fine" from "we
 * could not check". This bar read neither. The mapper's own toolbar renders both,
 * but the workshop passes `hideToolbar`, so on the order review screen the two
 * states had no surface at all: at `requiredUnmapped: 0` the bar printed nothing,
 * which reads as a clean order, and the amber count beside it was a partial number
 * presented as a whole one.
 */
describe("WorkshopStatusBar — 'we could not check' is not 'we checked'", () => {
  test("requiredUnknown > 0 → the neutral chip appears, in the mapper's own words", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnmapped: 0, requiredUnknown: 3 })}
      />,
    );
    const chip = screen.getByTestId("status-bar-required-unknown");
    expect(chip.textContent).toBe("Required fields not checked yet");
    // The amber "N fields need a source" chip is absent at requiredUnmapped 0 — so
    // before this chip existed, the bar's whole answer to an unevaluated order was
    // silence. That silence is the regression; assert it is gone.
    expect(screen.queryByText(/fields? needs? a source/)).toBeNull();
  });

  test("validationUnavailable → the neutral chip appears, in the mapper's own words", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ validationUnavailable: true })}
      />,
    );
    expect(screen.getByTestId("status-bar-validation-unavailable").textContent)
      .toBe("Validation checks unavailable");
  });

  // ANTI-VACUITY. Without this the two tests above would still pass if the chips
  // rendered unconditionally, which would be a worse defect than the one being fixed.
  test("checked-and-clean → NEITHER chip renders", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnmapped: 0, requiredUnknown: 0, validationUnavailable: false })}
      />,
    );
    expect(screen.queryByTestId("status-bar-required-unknown")).toBeNull();
    expect(screen.queryByTestId("status-bar-validation-unavailable")).toBeNull();
  });

  // The fields are OPTIONAL on MapperToolbarState, so every host that predates them
  // publishes a state with both absent. Absent must behave exactly like clean, not
  // like unknown — an undefined that rendered the chip would put "not checked yet"
  // on every order in every other host of this bar.
  test("a toolbar state that omits both fields renders neither chip", () => {
    render(<WorkshopStatusBar blockers={[]} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.queryByTestId("status-bar-required-unknown")).toBeNull();
    expect(screen.queryByTestId("status-bar-validation-unavailable")).toBeNull();
  });

  test("a partly-evaluated order shows BOTH the amber count and the unknown chip", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnmapped: 2, requiredUnknown: 5 })}
      />,
    );
    // The amber chip still states what IS known…
    expect(screen.getByText(/2 fields need a source/)).toBeTruthy();
    // …and the neutral chip beside it is what says the 2 is not the whole answer.
    expect(screen.getByTestId("status-bar-required-unknown")).toBeTruthy();
  });

  /**
   * Amber is a FINDING. These two are the ABSENCE of one, and the moment they are
   * drawn amber they read as "we checked and it's bad" — the same conflation the
   * fields were added to break.
   *
   * Asserted on the exported style OBJECT, not on the rendered node. jsdom's
   * cssstyle drops every `var()` value from a typed property, so both chips report
   * `style.color === ""` in this environment and a DOM-level colour assertion would
   * pass no matter what colour was written. This one can fail.
   */
  test("the shared chip face is neutral tokens, with no amber anywhere in it", () => {
    expect(UNKNOWN_CHIP_STYLE.color).toBe("var(--ink-muted)");
    expect(UNKNOWN_CHIP_STYLE.background).toBe("var(--surface-2)");
    expect(UNKNOWN_CHIP_STYLE.border).toBe("1px solid var(--border)");
    // Catches a re-tint written any of the three ways this repo writes amber.
    const written = JSON.stringify(UNKNOWN_CHIP_STYLE).toLowerCase();
    for (const amberish of ["amber", "#fff7e6", "#faefd6", "#f1e2be", "#8a5310", "#c97a14"]) {
      expect(written).not.toContain(amberish);
    }
  });

  // …and both chips really wear that one face, rather than a private copy that the
  // test above would never see.
  test("both chips render the SAME face, and it is not the amber chip's", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnmapped: 1, requiredUnknown: 4, validationUnavailable: true })}
      />,
    );
    const unknown = screen.getByTestId("status-bar-required-unknown").getAttribute("style");
    const unavailable = screen.getByTestId("status-bar-validation-unavailable").getAttribute("style");
    expect(unknown).toBe(unavailable);

    // The amber chip's soft background is a literal hex, so it survives jsdom and
    // stays a real discriminator: the neutral chips must not carry it.
    const amber = screen.getByText(/1 field needs a source/).getAttribute("style") ?? "";
    expect(amber).toContain("rgb(255, 247, 230)");
    expect(unknown).not.toContain("rgb(255, 247, 230)");
  });

  /**
   * COPY PARITY. Both hosts render these two states, and an operator who sees the
   * mapper's toolbar on one screen and this bar on another must read the same words.
   * Derived from MapperWorkbench's source rather than restated here, because a
   * second hand-typed copy of a string is how the two hosts drift apart in the first
   * place. One file read — deliberately not a tree walk.
   */
  test("the chip labels are byte-identical to the mapper's own", () => {
    const mapperSrc = readFileSync(
      join(process.cwd(), "src/components/bridge/mapper/MapperWorkbench.tsx"),
      "utf8",
    );
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnknown: 1, validationUnavailable: true })}
      />,
    );
    for (const id of ["status-bar-required-unknown", "status-bar-validation-unavailable"]) {
      const label = screen.getByTestId(id).textContent ?? "";
      expect(label.length).toBeGreaterThan(0);
      expect(mapperSrc).toContain(label);
    }
  });

  /**
   * The tooltips deliberately do NOT match the mapper's, and this pins why.
   *
   * The mapper's two tooltips both end "Sending is paused until…", which is true in
   * that host — MapperWorkbench's `canDeliver` reads both fields. `OrderWorkshop`'s
   * `canSend` is `blockingIssues === 0 && exceptionCount === 0` and reads neither,
   * so this bar cannot promise a pause its host does not perform. If the workshop's
   * send gate is ever taught to read these fields, delete this test and take the
   * mapper's sentence.
   */
  test("neither tooltip claims sending is paused — this host's gate does not read these fields", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        mapper={mapperState({ requiredUnknown: 1, validationUnavailable: true })}
      />,
    );
    const unknown = screen.getByTestId("status-bar-required-unknown").getAttribute("title") ?? "";
    const unavailable = screen.getByTestId("status-bar-validation-unavailable").getAttribute("title") ?? "";
    // The true half is kept word-for-word from the mapper…
    expect(unknown).toContain("we can't tell whether the required fields have a source");
    expect(unavailable).toContain("we can't confirm it's ready");
    // …and the claim this host cannot support is not made.
    expect(unknown).not.toMatch(/sending is paused/i);
    expect(unavailable).not.toMatch(/sending is paused/i);
  });
});
