// The dialog inventory — one row per file that renders an ARIA dialog.
//
// NOT a test file (no `.test.` in the name), so vitest treats it as a helper.
//
// WHY A REGISTRY AND WHY IT IS GUARDED. The behaviour contract in
// `src/hooks/useDialogA11y.ts` is only worth as much as its coverage, and a
// hand-maintained list of dialogs is the classic vacuous test: it silently stops
// covering the dialog somebody adds next week. This file is therefore paired
// with a DERIVED guard (`dialog-a11y.test.ts` → "every ARIA dialog in src/ is in
// the registry"), which re-scans the source tree for
// `role="dialog"` / `role="alertdialog"` / `aria-modal` and fails on any file
// that is not listed here. The list cannot go stale without CI going red.
//
// That guard is not hypothetical. In the hours this packet was being written,
// WP-32 landed three new components on main that this list — enumerated by hand
// from a grep — did not contain. That is exactly the case the guard catches.
//
// KIND is the load-bearing column, because "trap focus in every dialog" is WRONG
// as a blanket rule:
//
//   modal      — blocks the page (scrim + `aria-modal`). Gets the full contract:
//                focus-in, Tab trap, Escape, focus-restore, scroll lock.
//   popover    — anchored to a trigger, does not block the page. Escape and
//                focus-restore, and deliberately NO Tab trap: trapping Tab in a
//                layer the user can click past is the keyboard trap WCAG 2.1.2
//                forbids, so a blanket sweep would be a regression here.
//   non-modal  — a persistent region that happens to carry `role="dialog"`.
//                Neither trapped nor Escape-dismissable. The cookie banner is
//                the only one: it has no scrim, no `aria-modal`, and no
//                "dismiss without choosing" state to escape to.

export type DialogKind = "modal" | "popover" | "non-modal";

export interface DialogEntry {
  /** Path relative to the repo root, POSIX separators. */
  file: string;
  /** How many ARIA dialogs this file renders. */
  dialogs: number;
  kind: DialogKind;
  /** Short human name, used in test titles. */
  name: string;
  /** Did this file carry a Tab focus trap at 478b809 (the packet's baseline)? */
  hadTrapBefore: boolean;
  /** Did this file close on Escape at 478b809? */
  hadEscapeBefore: boolean;
  /** Why this file is exempt from the `useDialogA11y` conformance rule, if it is. */
  exemptReason?: string;
}

export const DIALOG_REGISTRY: DialogEntry[] = [
  // ── Modal dialogs — full contract ──────────────────────────────────────────
  {
    file: "src/app/(app)/admin/AdjustLimitsModal.tsx",
    name: "AdjustLimitsModal",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },
  {
    file: "src/app/(app)/admin/CreateInvoiceModal.tsx",
    name: "CreateInvoiceModal",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },
  {
    file: "src/app/(app)/layout.tsx",
    name: "mobile nav drawer",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },
  {
    file: "src/app/(app)/library/buyers/page.tsx",
    name: "New buyer modal",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/CommandPalette.tsx",
    name: "CommandPalette",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/HelpSlideover.tsx",
    name: "HelpSlideover",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/LaneDrawer.tsx",
    name: "LaneDrawer",
    dialogs: 1,
    kind: "modal",
    // It shipped as a scrimmed 400px panel of plain <div>s. The derived guard above
    // could not see it, because that guard keys on the PRESENCE of an ARIA dialog
    // marking — it catches an UNREGISTERED dialog, never an UNMARKED one.
    // `src/test/unmarked-modal.test.ts` is the layer that closes that direction.
    hadTrapBefore: false,
    // A document-level `keydown` listener that closed on Escape from anywhere,
    // including from inside a dialog opened on top of it.
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/MappingEditor.tsx",
    name: "MappingEditor panel",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/OnboardingWizard.tsx",
    name: "OnboardingWizard",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: false,
  },
  {
    file: "src/components/bridge/OutputMappingEditor.tsx",
    name: "OutputMappingEditor",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: false,
  },
  {
    file: "src/components/bridge/OutputStructureDesigner.tsx",
    name: "OutputStructureDesigner",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    // The three `Escape` hits at 478b809 were inline field editors
    // (`onKeyDown` on a rename input), never the dialog itself.
    hadEscapeBefore: false,
  },
  {
    file: "src/components/bridge/SupplierDockList.tsx",
    name: "New supplier modal",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/SupplierDockProfile.tsx",
    name: "Delete supplier confirmation",
    dialogs: 1,
    kind: "modal",
    // Same blind spot LaneDrawer sat in: a scrim + centred panel of plain <div>s,
    // so the marking-derived guard above could not see it. It was found by
    // src/test/unmarked-modal.test.ts, off that file's baseline.
    hadTrapBefore: false,
    hadEscapeBefore: false,
  },
  {
    file: "src/components/bridge/review/ConfirmDialog.tsx",
    name: "send ConfirmDialog",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/bridge/workshop/OrderDetailsDrawer.tsx",
    name: "OrderDetailsDrawer",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },
  {
    file: "src/components/connections/ConnectionLifecycleUI.tsx",
    name: "ConnectionConfirmDialog",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: false,
    hadEscapeBefore: false,
  },
  {
    file: "src/components/connections/HistoryDrawer.tsx",
    name: "HistoryDrawer",
    dialogs: 1,
    kind: "modal",
    hadTrapBefore: true,
    hadEscapeBefore: true,
  },

  // ── Anchored popovers — Escape + restore, NO Tab trap ──────────────────────
  {
    file: "src/components/bridge/mapper/OutgoingPane.tsx",
    name: "Add output field picker",
    dialogs: 1,
    kind: "popover",
    hadTrapBefore: false,
    // Escape existed only on the search input's onKeyDown, so it worked while
    // that field had focus and nowhere else.
    hadEscapeBefore: false,
  },
  {
    file: "src/components/bridge/mapper/TransformPopover.tsx",
    name: "TransformPopover",
    dialogs: 1,
    kind: "popover",
    hadTrapBefore: false,
    hadEscapeBefore: true,
  },

  // ── Non-modal ──────────────────────────────────────────────────────────────
  {
    file: "src/components/marketing/CookieConsentBanner.tsx",
    name: "CookieConsentBanner",
    dialogs: 1,
    kind: "non-modal",
    hadTrapBefore: false,
    hadEscapeBefore: false,
    exemptReason:
      "Persistent consent region: no scrim, no aria-modal, and no dismiss-without-choosing state. " +
      "A focus trap here would be a WCAG 2.1.2 keyboard trap; an Escape handler would close a banner " +
      "that immediately reappears because consent is still 'unknown'.",
  },
];

/**
 * Files that match the dialog grep but render NO dialog.
 *
 * Kept explicit rather than silently tolerated, because "the grep found 19 files"
 * is exactly the kind of number that gets reported as "19 dialogs" without the
 * step in between being checked.
 */
export const DIALOG_GREP_FALSE_POSITIVES: { file: string; why: string }[] = [
  {
    file: "src/hooks/useDialogA11y.ts",
    why:
      "The shared contract itself. Its only dialog-role mention is the selector in the " +
      "foreign-layer bail-out (`target.closest('[role=\"dialog\"], [role=\"alertdialog\"]')`). " +
      "It renders nothing.",
  },
  {
    file: "src/test/unmarkedOverlays.ts",
    why:
      "The scanner for the OTHER direction (see unmarked-modal.test.ts). Its only dialog-role " +
      "mentions are the `ANNOUNCED_LAYER` regex and prose in the baseline rows describing which " +
      "markings a file is missing. It renders nothing.",
  },
  {
    file: "src/components/bridge/InboxView.tsx",
    why:
      'Line 1026 is `document.querySelector(\'[role="dialog"], [aria-modal="true"]\')` — a guard that ' +
      "suppresses a keyboard shortcut while some OTHER dialog is open. It renders no dialog of its own.",
  },
];

export const MODAL_DIALOGS = DIALOG_REGISTRY.filter((d) => d.kind === "modal");
export const POPOVER_DIALOGS = DIALOG_REGISTRY.filter((d) => d.kind === "popover");

/** Every registered dialog, counted properly (a file may hold more than one). */
export const TOTAL_DIALOGS = DIALOG_REGISTRY.reduce((n, d) => n + d.dialogs, 0);
