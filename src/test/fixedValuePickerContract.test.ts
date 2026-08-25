import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE FIXED-VALUE CONTROL, THREE SCREENS, THREE DIFFERENT CONTRACTS.
 *
 * A user can set a literal value on an output field in three places: the order review screen
 * (`OutgoingPane`), the output mapping editor, and the output structure designer. It is the same
 * idea and the same result every time — a value the supplier receives that came from nobody's
 * document — but the three implementations grew apart:
 *
 *   • the review screen named its input `Fixed value for {path}`, the other two just `Fixed value`;
 *   • none of the three carried a shared hook, so nothing could address "the fixed-value control"
 *     without knowing which screen it was on.
 *
 * The 2026-07-10 report (docs/reports/2026-07-10-perf-and-fixed-value-picker.md §2) called this out
 * and proposed exactly the two things below. The aria-label half landed; the `pick-fixed-value`
 * hook did not, and the divergence sat there until 2026-08-25.
 *
 * Divergence like this is invisible to every other kind of test: each screen passes its own suite
 * while naming the same control three different things, and it costs a screen-reader user the same
 * thing it costs an automation script — the control stops being recognisable as one control.
 *
 * ── WHY A SOURCE SCAN ────────────────────────────────────────────────────────────────────────
 *
 * The DOM behaviour of the review screen's control is covered where it belongs, by
 * `src/components/bridge/mapper/OutgoingPane.fixedValueScope.test.tsx`. What that test cannot see
 * is the OTHER two screens agreeing with it — the question here is a cross-file one, and the two
 * output editors are heavy panels whose mounting cost buys nothing for a naming contract.
 *
 * ── BOTH DIRECTIONS ──────────────────────────────────────────────────────────────────────────
 *
 * Each file is asserted to CARRY the shared shapes, not merely to lack the old ones. A one-
 * directional "no bare `Fixed value` label anywhere" guard goes green the moment someone deletes
 * the label entirely, which is a worse outcome than the drift it was written to stop.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The shared name every fixed-value INPUT announces, followed by the field it writes. */
const INPUT_LABEL_PREFIX = "aria-label={`Fixed value for ";
/** The pre-2026-07 spelling, which announced no field and matched nothing else. */
const DIVERGENT_INPUT_LABEL = 'aria-label="Fixed value"';
/**
 * The shared hook on the control that OPENS the editor, on every surface. The VALUE is the
 * contract; the two pickers write it straight onto the button as `data-testid`, while the review
 * screen's row chip passes it through `RowChipButton`'s `testId` prop — which
 * `OutgoingPane.fixedValueScope.test.tsx` proves really reaches the DOM.
 */
const SHARED_TEST_ID_VALUE = '"pick-fixed-value"';

/** The three hosts that render a fixed-value input. */
const INPUT_HOSTS = [
  "src/components/bridge/mapper/OutgoingPane.tsx",
  "src/components/bridge/OutputMappingEditor.tsx",
  "src/components/bridge/OutputStructureDesigner.tsx",
] as const;

/**
 * The controls that OPEN a fixed-value editor. Three entries, two of them shared components:
 * `OutputSourcePicker` is the picker both output editors render, so tagging it covers both.
 */
const ENTRY_CONTROLS = [
  // The row chip on the order review screen — "wires" mode, which is what /inbox/[orderId] ships.
  "src/components/bridge/mapper/OutgoingPane.tsx",
  // The same screen's "picker" mode reaches the editor through this footer entry instead.
  "src/components/bridge/mapper/SourcePickerChip.tsx",
  // The output mapping editor and the output structure designer both render this one.
  "src/components/bridge/OutputSourcePicker.tsx",
] as const;

describe("the fixed-value input announces the same thing on every screen", () => {
  it.each(INPUT_HOSTS)("%s names the field it writes", (rel) => {
    expect(read(rel)).toContain(INPUT_LABEL_PREFIX);
  });

  it.each(INPUT_HOSTS)("%s no longer ships the field-less label", (rel) => {
    expect(read(rel)).not.toContain(DIVERGENT_INPUT_LABEL);
  });
});

describe("one locator reaches the fixed-value control on every screen", () => {
  it.each(ENTRY_CONTROLS)("%s tags its entry point", (rel) => {
    expect(read(rel)).toContain(SHARED_TEST_ID_VALUE);
  });

  it.each(["src/components/bridge/mapper/SourcePickerChip.tsx", "src/components/bridge/OutputSourcePicker.tsx"])(
    "%s writes it as a real data-testid attribute",
    (rel) => {
      expect(read(rel)).toContain(`data-testid=${SHARED_TEST_ID_VALUE}`);
    },
  );
});

describe("anti-vacuity", () => {
  it("is reading real files, and the divergent label is a string these files could contain", () => {
    // Without this, a renamed constant or an empty read would let every assertion above pass by
    // matching nothing. `toContain("")` is true of any string, so the positive assertions alone
    // do not prove the corpus is real.
    for (const rel of [...new Set([...INPUT_HOSTS, ...ENTRY_CONTROLS])]) {
      expect(read(rel).length, `${rel} is empty`).toBeGreaterThan(500);
    }
    expect(INPUT_LABEL_PREFIX.length).toBeGreaterThan(0);
    expect(DIVERGENT_INPUT_LABEL.length).toBeGreaterThan(0);
    expect(SHARED_TEST_ID_VALUE.length).toBeGreaterThan(0);

    // And prove the "no divergent label" assertion can actually fail: the exact string it forbids
    // is a substring of the shape these files DO carry, minus the field. If the two shapes were
    // unrelated the negative assertion would be free.
    expect(DIVERGENT_INPUT_LABEL).toContain("Fixed value");
    expect(INPUT_LABEL_PREFIX).toContain("Fixed value for ");
  });
});
