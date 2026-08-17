import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { WorkshopStatusBar, dedupeBlockerChips, UNKNOWN_CHIP_STYLE } from "./WorkshopStatusBar";
import {
  CHECKS_UNAVAILABLE_NOTE,
  CHECK_SCOPE_SENTENCE,
  UNVERIFIED_ORDER_NOTE,
} from "./acceptanceGateModel";
import { REACHABLE_STATUSES, orderProblemState } from "@/lib/orderStatusManifest";
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

  // ── the green tick on an order that already failed ─────────────────────────
  // The bar took NO order status at all, so a clean field set drew "✓ No issues"
  // in green on an order that had stopped — delivery_failed, transform_failed,
  // rejected_by_supplier and four more. Seven of the eight problem statuses
  // render the workshop under a banner rather than gating it
  // (problemCopy.ts — only `failed` is presentation "gate"), so the tick sat
  // directly beneath a red banner saying the send had failed. IssuesPanel and
  // MobileTriage already took `orderStatus`; this bar was missed.
  //
  // The control that matters is ZERO blockers and ZERO notes: any blocker sends
  // the chip down a different branch and never reaches the green at all.

  test.each([
    "delivery_failed",
    "transform_failed",
    "rejected_by_supplier",
    "delivery_dead_letter",
    "delivery_held",
    "delivery_unconfirmed",
    "unrouted",
  ])("a stopped order (%s) with zero blockers and zero notes never goes green", (status) => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        orderStatus={status}
        onJump={vi.fn()}
        mapper={mapperState()}
      />,
    );
    const chip = screen.getByTestId("status-bar-issue-summary");
    expect(chip.textContent).toBe("Stopped");
    expect(chip.getAttribute("data-order-stopped")).toBe("true");
    // The green claim is gone from the document, tooltip included.
    expect(document.body.textContent).not.toContain("No issues");
    expect(document.body.innerHTML).not.toContain("everything ProcuLink can check before sending");
    // …and it points at the surface that owns the cause instead.
    expect(chip.getAttribute("title")).toBe(
      "No field problems, but this order stopped before it was sent. " +
      "The panel above says what happened and what to do next.",
    );
    // The green tick itself must not survive the wording change.
    expect(chip.querySelector("svg")).toBeNull();
  });

  test("a stopped order keeps its optional-note count rather than dropping it", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={2}
        orderStatus="delivery_failed"
        onJump={vi.fn()}
        mapper={mapperState()}
      />,
    );
    expect(screen.getByTestId("status-bar-issue-summary").textContent).toBe("Stopped · 2 optional");
  });

  test("a HEALTHY status still goes green — the guard is the status, not the prop", () => {
    // Anti-vacuity: if `stopped` were stuck true, or the chip had simply stopped
    // rendering its green face, every assertion above would pass for free.
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        orderStatus="ready_to_deliver"
        onJump={vi.fn()}
        mapper={mapperState()}
      />,
    );
    const chip = screen.getByTestId("status-bar-issue-summary");
    expect(chip.textContent).toBe("No issues");
    expect(chip.getAttribute("data-order-stopped")).toBeNull();
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  test("hosts that pass no status are untouched", () => {
    // The mapping panel and the connection editor mount this bar without an
    // order at all; they must keep today's behaviour exactly.
    render(<WorkshopStatusBar blockers={[]} notes={0} onJump={vi.fn()} mapper={mapperState()} />);
    expect(screen.getByTestId("status-bar-issue-summary").textContent).toBe("No issues");
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

/**
 * THE SUMMARY CHIP MAY NOT SAY "NO ISSUES" ABOUT A ZERO IT DID NOT FINISH COUNTING.
 *
 * Two holes, one chip, both shipped:
 *
 *  1. `chipAmber` read `stopped || notes > 0` and NEITHER unknown flag — so with zero
 *     blockers, zero notes, a healthy status and a failed /validation fetch the bar drew
 *     a green tick, the words "No issues", and the tooltip "Nothing is blocking this
 *     order" BESIDE ITS OWN CHIP saying "Validation checks unavailable", in the same flex
 *     row. The chips already existed; the summary simply never read them.
 *
 *  2. `stopped` came from `isProblemBucketStatus`, a TWO-answer predicate whose own doc
 *     admits an unrecognised status falls to the clean arm — while `IssuesPanel`, on this
 *     same screen, branches on the THREE-answer `orderProblemState`. So an unknown status
 *     made the panel say amber "we can't confirm this order is clear" and the bar say
 *     green "No issues".
 *
 * SCOPING. jsdom applies no Tailwind, so every breakpoint tree in a component mounts at
 * once and an unscoped `getByText` can answer from the wrong one. Every assertion about
 * the SUMMARY is therefore scoped to the summary chip node itself, and "the scoping
 * bites" below is the control proving that scope is real rather than decorative — it
 * fails if `within` is ever silently widened back to `screen`.
 */
describe("WorkshopStatusBar — the summary chip and the unknown states", () => {
  // The chip's two faces are inline literal hex, which survives jsdom (unlike `var()`),
  // so the rendered background is a real discriminator between green and amber.
  const GREEN_BG = "rgb(233, 241, 234)"; // #E9F1EA — the all-clear face
  const AMBER_BG = "rgb(250, 241, 221)"; // #FAF1DD — every non-green face

  function summary(): HTMLElement {
    return screen.getByTestId("status-bar-issue-summary");
  }

  /** The green face is the tick AND the green ground; either one alone is not it. */
  function isGreenAllClear(chip: HTMLElement): boolean {
    const style = chip.getAttribute("style") ?? "";
    return style.includes(GREEN_BG) && chip.querySelector("svg") != null;
  }

  test("validation checks unavailable → no green tick, no 'No issues', no 'Nothing is blocking'", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        onJump={vi.fn()}
        orderStatus="ready"
        mapper={mapperState({ requiredUnmapped: 0, validationUnavailable: true })}
      />,
    );
    const chip = summary();

    // The exact rendering the defect produced, named so it cannot return by another route.
    expect(isGreenAllClear(chip)).toBe(false);
    expect(within(chip).queryByText("No issues")).toBeNull();
    expect(chip.getAttribute("title")).not.toContain("Nothing is blocking this order");

    // …and what it says instead: the unfinished check, in the model's own words.
    expect(chip.textContent).toBe("Not fully checked");
    expect(chip.getAttribute("style")).toContain(AMBER_BG);
    expect(chip.getAttribute("title")).toBe(CHECKS_UNAVAILABLE_NOTE);
    expect(chip.getAttribute("data-checks-unavailable")).toBe("true");

    // The chip this summary was contradicting is still on screen, unchanged.
    expect(screen.getByTestId("status-bar-validation-unavailable").textContent)
      .toBe("Validation checks unavailable");
  });

  test("required fields not loaded → the same refusal to claim a clean order", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        onJump={vi.fn()}
        orderStatus="ready"
        mapper={mapperState({ requiredUnmapped: 0, requiredUnknown: 3 })}
      />,
    );
    const chip = summary();
    expect(isGreenAllClear(chip)).toBe(false);
    expect(chip.textContent).toBe("Not fully checked");
    expect(chip.getAttribute("title")).toBe(CHECKS_UNAVAILABLE_NOTE);
    expect(screen.getByTestId("status-bar-required-unknown")).toBeTruthy();
  });

  test("an unfinished check outranks the optional-note count, which is also partial", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={2}
        onJump={vi.fn()}
        orderStatus="ready"
        mapper={mapperState({ validationUnavailable: true })}
      />,
    );
    const chip = summary();
    // The count is still shown — it is real — but it is not presented as the whole answer.
    expect(chip.textContent).toBe("Not fully checked · 2 optional");
    expect(chip.getAttribute("title")).toBe(CHECKS_UNAVAILABLE_NOTE);
    expect(chip.getAttribute("title")).not.toContain("Nothing is blocking this order");
  });

  test("an unrecognised status → the bar gives the SAME verdict IssuesPanel gives", () => {
    // A status this build has never heard of, which is routine: frontend and backend
    // deploy separately. `orderProblemState` calls it "unknown"; `isProblemBucketStatus`
    // called it `false`, i.e. indistinguishable from healthy, and that was the defect.
    const UNKNOWN_STATUS = "delivery_quarantined";
    expect(orderProblemState(UNKNOWN_STATUS)).toBe("unknown");

    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        onJump={vi.fn()}
        orderStatus={UNKNOWN_STATUS}
        mapper={mapperState({ requiredUnmapped: 0 })}
      />,
    );
    const chip = summary();
    expect(isGreenAllClear(chip)).toBe(false);
    expect(within(chip).queryByText("No issues")).toBeNull();
    expect(chip.textContent).toBe("Status unconfirmed");
    expect(chip.getAttribute("data-order-verdict")).toBe("unknown");
    // The identical sentence the panel's amber bar renders for this state — one claim,
    // one string, so the two panes cannot drift back into contradicting each other.
    expect(chip.getAttribute("title")).toBe(UNVERIFIED_ORDER_NOTE);
  });

  test("a stopped order still reads as stopped, and still says so first", () => {
    // The arm that already worked, kept under the new four-way branch: `orderStopped`
    // outranks both unknown signals, because an observed stoppage is the most specific
    // true thing the bar can say.
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        onJump={vi.fn()}
        orderStatus="delivery_failed"
        mapper={mapperState({ validationUnavailable: true })}
      />,
    );
    const chip = summary();
    expect(chip.textContent).toBe("Stopped");
    expect(chip.getAttribute("data-order-stopped")).toBe("true");
    expect(chip.getAttribute("title")).toContain("this order stopped before it was sent");
  });

  // ── ANTI-VACUITY ───────────────────────────────────────────────────────────
  // Every assertion above is "not green". A suite of only those passes just as well when
  // the chip renders nothing at all, or when it went amber unconditionally.

  test("ANTI-VACUITY — a checked, clean, recognised order IS still green", () => {
    render(
      <WorkshopStatusBar
        blockers={[]}
        notes={0}
        onJump={vi.fn()}
        orderStatus="ready"
        mapper={mapperState({ requiredUnmapped: 0, requiredUnknown: 0, validationUnavailable: false })}
      />,
    );
    const chip = summary();
    expect(isGreenAllClear(chip)).toBe(true);
    expect(chip.textContent).toBe("No issues");
    expect(chip.getAttribute("data-order-verdict")).toBe("clear");
    expect(chip.getAttribute("data-checks-unavailable")).toBeNull();
    expect(chip.getAttribute("title")).toContain("Nothing is blocking this order");
    expect(chip.getAttribute("title")).toContain(CHECK_SCOPE_SENTENCE);
  });

  test("ANTI-VACUITY — an ABSENT status is a non-review host, not an unreadable one", () => {
    // `orderStatus` is optional precisely so the bar's other hosts are unchanged, and
    // `orderProblemState(null)` answers "unknown". Reading that as unverifiable would put
    // "Status unconfirmed" on every order in every one of those hosts.
    render(<WorkshopStatusBar blockers={[]} notes={0} onJump={vi.fn()} mapper={mapperState()} />);
    const chip = summary();
    expect(isGreenAllClear(chip)).toBe(true);
    expect(chip.textContent).toBe("No issues");
    expect(chip.getAttribute("data-order-verdict")).toBeNull();
  });

  test("the scoping bites — within(chip) really excludes the rest of the bar", () => {
    // The control for every `within(chip)` above. Both nodes are in the same DOM; only
    // the scope keeps them apart, and if the scope stopped applying this test fails while
    // the assertions it protects would silently keep passing.
    render(
      <WorkshopStatusBar
        blockers={[]}
        onJump={vi.fn()}
        orderStatus="ready"
        mapper={mapperState({ validationUnavailable: true })}
      />,
    );
    const chip = summary();
    const bar = screen.getByTestId("workshop-status-bar");
    expect(within(bar).getByText("Validation checks unavailable")).toBeTruthy();
    expect(within(chip).queryByText("Validation checks unavailable")).toBeNull();
    expect(bar.contains(chip)).toBe(true);
  });

  /**
   * The two predicates agree on every status the manifest NAMES — which is the property
   * `isProblemBucketStatus` also had, and why the swap cannot be verified by walking the
   * manifest alone. This walk is the floor; "an unrecognised status" above is the test
   * that actually bites, because the disagreement only exists off the end of this list.
   */
  test("every reachable status renders the verdict orderProblemState gives it", () => {
    // Anti-vacuity floor for the walk itself: a manifest that lost its rows would make
    // this trivially true by knowing nothing at all.
    expect(REACHABLE_STATUSES.length).toBeGreaterThanOrEqual(14);
    expect(REACHABLE_STATUSES.some((s) => orderProblemState(s) === "clear")).toBe(true);
    expect(REACHABLE_STATUSES.some((s) => orderProblemState(s) === "problem")).toBe(true);

    for (const status of REACHABLE_STATUSES) {
      cleanup();
      render(
        <WorkshopStatusBar
          blockers={[]}
          notes={0}
          onJump={vi.fn()}
          orderStatus={status}
          mapper={mapperState({ requiredUnmapped: 0 })}
        />,
      );
      const chip = summary();
      const expected = orderProblemState(status);
      expect(chip.getAttribute("data-order-verdict"), `verdict for "${status}"`).toBe(expected);
      expect(isGreenAllClear(chip), `green tick for "${status}"`).toBe(expected === "clear");
    }
  });
});
