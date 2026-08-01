"use client";

// useDialogA11y — the ONE modal-dialog behaviour contract.
//
// WHY THIS EXISTS. At 478b809 the app shipped 18 hand-rolled dialogs and SIX
// independent focus traps (app/layout.tsx, CommandPalette, MappingEditor,
// review/ConfirmDialog, workshop/OrderDetailsDrawer, connections/HistoryDrawer),
// each with its own focusable-element selector, its own idea of where Escape is
// listened for, and its own focus-restore story. Twelve dialogs had no trap at
// all and four had no Escape handler. Six near-copies of the same 40 lines is
// how a WCAG 2.1.2 (No Keyboard Trap) / 2.4.3 (Focus Order) regression survives
// a review: fixing one copy leaves five blind.
//
// This module is the single copy. The behaviour it implements is the union of
// what the six copies did, plus the two things none of them did:
//
//   1. A LAYER STACK. Only the top-most open dialog answers Escape and Tab.
//      Without it, `OutputMappingEditor` (which can host `OutputStructureDesigner`
//      on top of itself) closed BOTH on one Escape, and any document-level
//      capture-phase listener stole Escape from a Radix `<AlertDialog>` opened
//      over it (`ui/confirm.tsx`, used by OutputStructureDesigner's dirty-close).
//   2. A FOREIGN-LAYER BAIL-OUT. Radix portals its content to <body>, so it is
//      never `panel.contains(...)`. When the keydown originates inside another
//      dialog element that is not ours, we do nothing and let that layer own it.
//
// WHAT IT DOES NOT DO. It does not render anything, it does not own `open`, and
// it does not close on outside click — every caller already had its own scrim
// click handler and those differ (some discard, some confirm-then-discard).
//
// Non-modal callers (an anchored popover, a consent banner) pass `modal: false`:
// Escape and focus-restore still apply, the Tab trap and the scroll lock do not.
// Trapping Tab inside a non-modal layer is a REGRESSION, not a fix — a popover
// that steals Tab from the page is exactly the keyboard trap WCAG 2.1.2 bans.

import { useEffect, useRef, type RefObject } from "react";

/**
 * Elements that can receive keyboard focus.
 *
 * `[tabindex]:not([tabindex="-1"])` deliberately excludes programmatic-only
 * focus targets (a panel that is focused on open but must not appear in the Tab
 * ring). `input[type="hidden"]` is excluded because jsdom and browsers disagree
 * about whether it matches `:not([disabled])`.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Is this element actually rendered, i.e. a real tab stop?
 *
 * All six original hand-rolled traps used `el.offsetParent !== null`. That test
 * is WRONG IN TWO DIRECTIONS and both of them bite here:
 *
 *   • `offsetParent` is `null` for any `position: fixed` element even when it is
 *     perfectly visible — and every dialog in this app is inside a fixed layer.
 *   • jsdom implements `offsetParent` and always returns `null` (it has no
 *     layout engine), so under test the filter removed EVERY element and the
 *     trap silently degraded to "focus the panel". A trap that sees zero tab
 *     stops cannot cycle, which is how a focus-trap test can pass vacuously.
 *
 * So `offsetParent` is used only as a POSITIVE signal ("definitely laid out"),
 * and the negative case falls through to computed style, which jsdom does
 * implement and which is the property that actually determines focusability.
 */
function isRendered(el: HTMLElement): boolean {
  if (el === document.activeElement) return true;
  if (el.hasAttribute("hidden")) return false;
  if (el.offsetParent != null) return true;
  if (typeof window === "undefined" || !window.getComputedStyle) return true;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Focusable descendants of `root`, in DOM order, excluding ones not rendered. */
export function focusablesWithin(root: HTMLElement | null | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered);
}

// ─── Layer stack ──────────────────────────────────────────────────────────────
//
// Module-level, deliberately. Dialogs are mounted from unrelated trees (a portal,
// a page, the app shell) and cannot share React context. Push on open, pop on
// close; `isTopLayer` is what makes stacked dialogs behave.

const layerStack: symbol[] = [];

function pushLayer(id: symbol) {
  layerStack.push(id);
}
function popLayer(id: symbol) {
  const i = layerStack.lastIndexOf(id);
  if (i >= 0) layerStack.splice(i, 1);
}
function isTopLayer(id: symbol) {
  return layerStack.length > 0 && layerStack[layerStack.length - 1] === id;
}

/** Test-only: the current depth of the open-dialog stack. */
export function __openLayerCount() {
  return layerStack.length;
}

// ─── Body scroll lock ─────────────────────────────────────────────────────────
//
// Reference-counted: two stacked modals must not fight over `overflow`, and the
// inner one closing must not unlock the page while the outer one is still open.

let scrollLockCount = 0;
let scrollLockPrevious = "";

function lockScroll() {
  if (scrollLockCount === 0) {
    scrollLockPrevious = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}
function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = scrollLockPrevious;
}

export interface DialogA11yOptions {
  /** Whether the dialog is currently rendered. Callers that mount only while
   *  open should pass `true` — the hook keys off mount/unmount in that case. */
  open: boolean;
  /** Called on Escape. Read through a ref, so it need not be memoised. */
  onClose: () => void;
  /** The element carrying `role="dialog"` (or the panel inside the scrim). */
  panelRef: RefObject<HTMLElement | null>;
  /** Modal (default). `false` = non-modal layer: Escape + focus restore, but no
   *  Tab trap and no scroll lock. */
  modal?: boolean;
  /** Element to focus on open. Defaults to the first focusable in the panel,
   *  else the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Move focus into the dialog on open. Default true. */
  autoFocus?: boolean;
  /** Return focus to whatever was focused when the dialog opened. Default true. */
  restoreFocus?: boolean;
  /** Escape closes. Default true. */
  closeOnEscape?: boolean;
}

/**
 * Applies the shared dialog behaviour contract:
 *
 *  • focus moves into the dialog on open
 *  • Tab cycles forwards within it, Shift+Tab backwards  (modal only)
 *  • Escape closes it
 *  • focus returns to the trigger on close
 *  • background scroll is locked while it is open        (modal only)
 */
export function useDialogA11y(options: DialogA11yOptions): void {
  const {
    open,
    onClose,
    panelRef,
    modal = true,
    initialFocusRef,
    autoFocus = true,
    restoreFocus = true,
    closeOnEscape = true,
  } = options;

  // Latest callback without re-registering listeners on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // One stable identity per hook instance, for the layer stack.
  const layerId = useRef<symbol>(undefined as unknown as symbol);
  if (layerId.current === undefined) layerId.current = Symbol("plk-dialog-layer");

  // Register on the layer stack + lock scroll.
  useEffect(() => {
    if (!open) return;
    const id = layerId.current;
    pushLayer(id);
    if (modal) lockScroll();
    return () => {
      popLayer(id);
      if (modal) unlockScroll();
    };
  }, [open, modal]);

  // Capture the trigger, move focus in, restore on close.
  useEffect(() => {
    if (!open) return;
    const previous = (document.activeElement as HTMLElement | null) ?? null;

    let raf = 0;
    if (autoFocus) {
      // rAF so the panel's children exist (a caller may render them in the same
      // commit) before we look for the first focusable.
      raf = window.requestAnimationFrame(() => {
        const explicit = initialFocusRef?.current;
        if (explicit) {
          explicit.focus();
          return;
        }
        const panel = panelRef.current;
        const first = focusablesWithin(panel)[0];
        (first ?? panel)?.focus?.();
      });
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (restoreFocus) previous?.focus?.();
    };
    // `initialFocusRef`/`panelRef` are refs — stable identities, intentionally
    // not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoFocus, restoreFocus]);

  // Escape + Tab trap, top layer only.
  useEffect(() => {
    if (!open) return;
    const id = layerId.current;

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      if (!isTopLayer(id)) return;

      const panel = panelRef.current;

      // A FOREIGN dialog layer (Radix portals to <body>, so it is never related to
      // our panel) owns its own keys. Bail rather than close two things at once.
      //
      // "Foreign" has to be tested in BOTH directions. Several dialogs put
      // `role="dialog"` on the full-screen scrim and hand `panelRef` the inner
      // panel — OrderDetailsDrawer and HistoryDrawer both do. There the nearest
      // dialog ancestor of the keydown target is an ANCESTOR of our panel, not a
      // descendant, so a one-directional `panel.contains(targetLayer)` test called
      // the dialog's own chrome foreign and switched the trap off entirely. That
      // is what the table-driven render test caught.
      const target = e.target instanceof Element ? e.target : null;
      const targetLayer = target?.closest?.('[role="dialog"], [role="alertdialog"]') ?? null;
      const related =
        !targetLayer ||
        !panel ||
        targetLayer === panel ||
        panel.contains(targetLayer) ||
        targetLayer.contains(panel);
      if (!related) return;

      if (e.key === "Escape") {
        if (!closeOnEscape) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      // Tab: modal layers only. A non-modal layer must NOT trap Tab.
      if (!modal || !panel) return;
      const focusable = focusablesWithin(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus?.();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modal, closeOnEscape]);
}
