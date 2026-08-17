// The direction `dialog-a11y.test.tsx` cannot look in.
//
// That gate derives its dialog inventory from a grep for
// `role="dialog" | role="alertdialog" | aria-modal`, so it catches an UNREGISTERED
// dialog and is structurally blind to an UNMARKED one — a modal that carries no
// dialog marking never enters the grep at all. `LaneDrawer.tsx` lived in that blind
// spot for its whole life: a scrimmed 400px panel with no role, no aria-modal, no
// focus trap, no focus restore and no scroll lock, invisible to the dialog gate and
// unflaggable by axe (a plain <div> breaks no rule).
//
// This gate asks the SHAPE question instead. See `unmarkedOverlays.ts` for the
// mechanics and for the two blind spots it has of its own.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import {
  UNMARKED_OVERLAY_BASELINE,
  announcesALayer,
  buildsFullViewportOverlay,
  unmarkedOverlays,
  type ScannedFile,
} from "./unmarkedOverlays";

/**
 * The pre-fix `LaneDrawer` scrim + panel, verbatim from `9fedca0`.
 *
 * Kept as a fixture so the anti-vacuity control is PERMANENT rather than something
 * that was true once, on the afternoon the guard was written. Without it this whole
 * gate could later be narrowed to match nothing and stay green forever, which is the
 * failure mode every source-scan guard in this repo has to answer for.
 */
const LANE_DRAWER_BEFORE_FIX = `
      {/* Dim overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,26,47,0.3)",
          zIndex: 8998,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          background: "#FFFFFF",
          boxShadow: "-8px 0 32px rgba(11,26,47,0.14)",
          zIndex: 8999,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
`;

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * The corpus, read once at COLLECT time.
 *
 * Reading it inside a test body costs ~4s against a 5s budget on Windows and has
 * already been the cause of flaky whole-tree guards here.
 */
const CORPUS: ScannedFile[] = (() => {
  const out: ScannedFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      // Tests and helpers describe overlays; they do not ship them. This file and
      // its scanner both quote the pattern verbatim.
      if (/\.test\.tsx?$/.test(name)) continue;
      const rel = relative(ROOT, full).split(sep).join("/");
      if (rel.startsWith("src/test/")) continue;
      out.push({ file: rel, source: readFileSync(full, "utf8") });
    }
  };
  walk(SRC);
  return out;
})();

describe("the scanner recognises the shape it was built for", () => {
  // ANTI-VACUITY. Everything below this line is worthless if the scanner matches
  // nothing, and a whole-tree guard that has gone silent looks exactly like a clean
  // tree. These four cases pin both directions on inputs that do not move.

  it("flags the LaneDrawer scrim + panel exactly as it shipped at 9fedca0", () => {
    expect(buildsFullViewportOverlay(LANE_DRAWER_BEFORE_FIX)).toBe(true);
    expect(announcesALayer(LANE_DRAWER_BEFORE_FIX)).toBe(false);
    expect(unmarkedOverlays([{ file: "src/components/bridge/LaneDrawer.tsx", source: LANE_DRAWER_BEFORE_FIX }])).toEqual(
      ["src/components/bridge/LaneDrawer.tsx"],
    );
  });

  it("clears the same overlay once it is marked up", () => {
    const fixed = LANE_DRAWER_BEFORE_FIX.replace(
      "      <div\n        style={{\n          position: \"fixed\",\n          top: 0,",
      "      <div\n        role=\"dialog\"\n        aria-modal=\"true\"\n        style={{\n          position: \"fixed\",\n          top: 0,",
    );
    expect(fixed, "the substitution must actually have applied").toContain('role="dialog"');
    expect(unmarkedOverlays([{ file: "x.tsx", source: fixed }])).toEqual([]);
  });

  it("does not flag an anchored popover that uses menu/listbox semantics", () => {
    const menu = `<div className="fixed inset-0" onClick={close} /><ul role="menu">…</ul>`;
    expect(buildsFullViewportOverlay(menu)).toBe(true);
    expect(unmarkedOverlays([{ file: "x.tsx", source: menu }])).toEqual([]);
  });

  it("does not flag a commented-out overlay, and does not count a role in a comment", () => {
    const commented = `// <div style={{ position: "fixed", inset: 0 }} />\nexport const x = 1;`;
    expect(buildsFullViewportOverlay(commented)).toBe(false);

    const roleOnlyInComment = `{/* role="dialog" one day */}\n<div className="fixed inset-0" />`;
    expect(announcesALayer(roleOnlyInComment)).toBe(false);
    expect(unmarkedOverlays([{ file: "x.tsx", source: roleOnlyInComment }])).toEqual(["x.tsx"]);
  });
});

describe("no full-viewport overlay in src/ hides from assistive tech", () => {
  it("the corpus is real", () => {
    // A walk that silently stopped finding files would make every assertion below
    // pass. 19 overlay files were measured at 9fedca0.
    expect(CORPUS.length).toBeGreaterThan(300);
    expect(CORPUS.filter((f) => buildsFullViewportOverlay(f.source)).length).toBeGreaterThanOrEqual(15);
  });

  it("every unmarked overlay is a known, named baseline entry", () => {
    const baseline = new Set(UNMARKED_OVERLAY_BASELINE.map((b) => b.file));
    const offenders = unmarkedOverlays(CORPUS).filter((f) => !baseline.has(f));
    expect(
      offenders,
      "A full-viewport fixed overlay landed with no dialog/menu/listbox semantics. If it is a modal, " +
        "give it role=\"dialog\" + aria-modal and route it through useDialogA11y (and register it in " +
        "src/test/dialogRegistry.ts). If it is an anchored menu, role=\"menu\"/\"listbox\" is the right " +
        "marking. If it is genuinely neither, add it to UNMARKED_OVERLAY_BASELINE with a reason.",
    ).toEqual([]);
  });

  it("the baseline holds no entry that has already been fixed", () => {
    const offenders = new Set(unmarkedOverlays(CORPUS));
    const stale = UNMARKED_OVERLAY_BASELINE.filter((b) => !offenders.has(b.file)).map((b) => b.file);
    expect(
      stale,
      "These files no longer build an unmarked overlay. Delete their baseline rows — a permanent " +
        "exemption is how the next instance gets waved through.",
    ).toEqual([]);
  });

  it("LaneDrawer is no longer among them", () => {
    // The specific regression this packet fixed, pinned by name rather than left to
    // the aggregate assertion above, which would also pass if the walk broke.
    const lane = CORPUS.find((f) => f.file === "src/components/bridge/LaneDrawer.tsx");
    expect(lane, "LaneDrawer.tsx is not in the corpus — the walk is wrong").toBeDefined();
    expect(buildsFullViewportOverlay(lane!.source)).toBe(true);
    expect(announcesALayer(lane!.source)).toBe(true);
  });
});
