// The scanner behind `unmarked-modal.test.ts`.
//
// NOT a test file (no `.test.` in the name), so vitest treats it as a helper — the
// same arrangement as `dialogRegistry.ts` and `sourceScan.ts`.
//
// WHY A SECOND DIALOG GUARD EXISTS
//
// `dialog-a11y.test.tsx` derives its inventory by grepping src/ for
// `role="dialog" | role="alertdialog" | aria-modal`. That is exactly the right
// question for the failure it was built against — a dialog landing on main without
// being registered — and it is structurally blind to the opposite one. A modal that
// carries NO dialog marking at all never enters the grep, so it is not
// unregistered; it is invisible. `LaneDrawer.tsx` sat in that blind spot: a scrimmed
// 400px panel with no role, no `aria-modal`, no focus trap, no focus restore and no
// scroll lock. Axe does not flag it either, because a plain `<div>` violates no rule
// — it simply is not a dialog, and nothing can prove it was meant to be one from the
// markup alone.
//
// So this guard asks a SHAPE question instead of a MARKING question: does this file
// build a full-viewport fixed overlay? If it does, it is either a layer that
// announces itself (dialog / alertdialog / menu / listbox) or it is on the baseline
// below with a reason. Nothing else passes.
//
// TWO STATED BLIND SPOTS, both inherent to reading source as text:
//
//   1. FILE-LEVEL, not element-level. A file that renders one properly marked dialog
//      and one unmarked overlay passes. Narrowing to the element would mean parsing
//      JSX, and a proximity heuristic would be a coin toss on files this size.
//   2. It only sees overlays written as an inline `position: fixed` + `inset: 0`
//      style object or as Tailwind `fixed … inset-0`. An overlay assembled from a
//      CSS class in globals.css, or from `top/right/bottom/left: 0`, is not seen.
//
// Both are recorded here rather than left for the next reader to discover, because a
// guard whose reach is unstated gets trusted for reach it does not have.

import { stripComments } from "./sourceScan";

/** A file's source, addressed the way the registry addresses files. */
export interface ScannedFile {
  /** Path relative to the repo root, POSIX separators. */
  file: string;
  source: string;
}

/**
 * Roles that make an overlay legible to assistive tech.
 *
 * `menu` and `listbox` are here beside the two dialog roles on purpose: an anchored
 * menu over a scrim is a real, correct pattern (OrgSwitcher, UserChipMenu and
 * OutputSourcePicker all use it), and demanding `role="dialog"` there would be
 * pushing a modal contract onto a layer the user can click straight past — the
 * keyboard trap WCAG 2.1.2 forbids, which `useDialogA11y` exists to avoid.
 */
const ANNOUNCED_LAYER = /role="(?:dialog|alertdialog|menu|listbox)"|aria-modal/;

/** An inline style object that pins an element to the whole viewport. */
const INLINE_SCRIM =
  /position:\s*["']fixed["'][\s\S]{0,200}?inset:\s*0|inset:\s*0[\s\S]{0,200}?position:\s*["']fixed["']/;

/** The Tailwind spelling of the same thing, in either order. */
const TAILWIND_SCRIM =
  /className=["'`][^"'`]*\bfixed\b[^"'`]*\binset-0\b|className=["'`][^"'`]*\binset-0\b[^"'`]*\bfixed\b/;

/** Does this source build a full-viewport fixed overlay at all? */
export function buildsFullViewportOverlay(source: string): boolean {
  // Comments are stripped first: a commented-out overlay covers nothing, and this
  // file's own header describes the pattern it hunts for.
  const code = stripComments(source, "js");
  return INLINE_SCRIM.test(code) || TAILWIND_SCRIM.test(code);
}

/** Does this source mark at least one layer for assistive tech? */
export function announcesALayer(source: string): boolean {
  return ANNOUNCED_LAYER.test(stripComments(source, "js"));
}

/**
 * The files that cover the viewport and tell nobody.
 *
 * `baseline` is subtracted, not consulted: an entry that no longer offends is not
 * silently tolerated — `unmarked-modal.test.ts` fails on a stale baseline row too,
 * so a fix cannot leave a permanent exemption behind it.
 */
export function unmarkedOverlays(files: ScannedFile[]): string[] {
  return files
    .filter((f) => buildsFullViewportOverlay(f.source) && !announcesALayer(f.source))
    .map((f) => f.file)
    .sort();
}

/**
 * Known offenders, as of 2026-08-17, that this packet did not fix.
 *
 * A real instance of the same defect LaneDrawer had, baselined rather than fixed
 * because it belongs to a file in flight and a drive-by edit would collide. A
 * baseline row is a debt with a name on it, NOT a verdict that the file is fine —
 * and it is subtracted, not consulted, so the row for SupplierDockProfile.tsx had
 * to come out the moment that dialog was marked up.
 */
export const UNMARKED_OVERLAY_BASELINE: { file: string; why: string }[] = [
  {
    file: "src/components/marketing/MarketingNav.tsx",
    why:
      "The mobile menu (line ~100) is a full-screen navy overlay with no role and no Escape. It is " +
      "navigation rather than a dialog, so the right marking is probably a labelled <nav> plus " +
      "Escape and focus restore — a decision about marketing chrome, not this packet.",
  },
];
