"use client";

// useWorkshopLayout — the Order Workshop's collapse/focus state + the derived
// 3-zone grid. PURE `computeGrid` (TDD'd) + a thin hook wrapping useState with
// sessionStorage persistence.
//
// IMPORTANT (design-system "One great UX" rule, 00-agent-quick-brief.md §70):
// this persists *layout* state — which zones are focused/collapsed — NOT a
// user-mode / persona flag. The key `plk-workshop-layout` is layout-only; there
// is no "expert mode" boolean here. Per-zone collapse + a Focus control is the
// progressive-disclosure mechanism the workshop uses, applied to ONE screen.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IncomingView } from "@/lib/sourceDocument";

/** Which zone the operator is focusing. `all` = the balanced three-zone view. */
export type WorkshopFocus = "all" | "mapping" | "output";

/** One zone's grid track: a thin collapsed rail, its natural width, or the flex hero. */
export type ZoneTrack = "rail" | "auto" | "1fr";

export interface WorkshopLayoutState {
  focus: WorkshopFocus;
  /** Manual per-zone collapse (only honored when focus === "all"). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /**
   * Which body the received column shows: the original document, or the field list.
   *
   * Defaults to `document` because the document is the ground truth the field list was derived
   * from — showing only the derived values is showing the same information once, unchecked.
   * When no document exists the pane falls back to the field list on its own (see
   * `resolveIncomingView`), so this preference is never the thing that empties a pane.
   */
  incomingView: IncomingView;
}

export interface WorkshopGrid {
  left: ZoneTrack;
  center: ZoneTrack;
  right: ZoneTrack;
}

const STORAGE_KEY = "plk-workshop-layout";

const DEFAULT_STATE: WorkshopLayoutState = {
  focus: "all",
  leftCollapsed: false,
  rightCollapsed: false,
  incomingView: "document",
};

/**
 * Derive the three grid tracks from the layout state.
 *
 * `focus` OVERRIDES per-zone collapse (rail map — PIXEL-SPEC §5):
 *   • mapping → Received + Outgoing visible; only the Preview rails. (You map, so you
 *               want the source reference AND the outgoing document side by side.)
 *   • output  → Outgoing + Preview visible; the Received rails.
 *   • all     → the center is always the 1fr hero; the two sides are `auto`
 *               unless manually collapsed to a `rail`.
 */
// Takes only the three fields it reads. `incomingView` is a body choice inside the left zone,
// not a track width, so the grid must not depend on it — and its own tests keep compiling.
export function computeGrid(
  state: Pick<WorkshopLayoutState, "focus" | "leftCollapsed" | "rightCollapsed">,
): WorkshopGrid {
  switch (state.focus) {
    case "mapping":
      return { left: "auto", center: "1fr", right: "rail" };
    case "output":
      return { left: "rail", center: "1fr", right: "1fr" };
    case "all":
    default:
      return {
        left: state.leftCollapsed ? "rail" : "auto",
        center: "1fr",
        right: state.rightCollapsed ? "rail" : "auto",
      };
  }
}

function isFocus(v: unknown): v is WorkshopFocus {
  return v === "all" || v === "mapping" || v === "output";
}

function isIncomingView(v: unknown): v is IncomingView {
  return v === "document" || v === "fields";
}

/** Read + sanitize the persisted layout (SSR-safe, corrupt-value-safe). */
function readPersisted(): WorkshopLayoutState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<WorkshopLayoutState>;
    return {
      focus: isFocus(parsed.focus) ? parsed.focus : DEFAULT_STATE.focus,
      leftCollapsed: typeof parsed.leftCollapsed === "boolean" ? parsed.leftCollapsed : false,
      rightCollapsed: typeof parsed.rightCollapsed === "boolean" ? parsed.rightCollapsed : false,
      incomingView: isIncomingView(parsed.incomingView)
        ? parsed.incomingView
        : DEFAULT_STATE.incomingView,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export interface UseWorkshopLayout extends WorkshopLayoutState {
  grid: WorkshopGrid;
  setFocus: (focus: WorkshopFocus) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setIncomingView: (view: IncomingView) => void;
}

export function useWorkshopLayout(): UseWorkshopLayout {
  // Lazy initializer keeps the first render in sync with sessionStorage (no
  // post-mount flash) while staying SSR-safe.
  const [state, setState] = useState<WorkshopLayoutState>(readPersisted);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* sessionStorage unavailable (private mode / quota) — layout still works in-memory. */
    }
  }, [state]);

  const setFocus = useCallback((focus: WorkshopFocus) => {
    // Focus is the single source of truth for the 3-zone layout (All / Mapping / Output), so
    // selecting one clears any stale manual per-zone collapse — "All" always shows all three.
    //
    // Mapping focus additionally forces the received column back to its FIELD LIST. Those rows
    // are the drag-source for the connector wires: asking someone to map from a column that is
    // showing a PDF is asking them to drag from nothing. The document stays one tap away.
    setState((s) => ({
      ...s,
      focus,
      leftCollapsed: false,
      rightCollapsed: false,
      incomingView: focus === "mapping" ? "fields" : s.incomingView,
    }));
  }, []);

  const setIncomingView = useCallback((incomingView: IncomingView) => {
    setState((s) => ({ ...s, incomingView }));
  }, []);
  const toggleLeft = useCallback(() => {
    setState((s) => ({ ...s, leftCollapsed: !s.leftCollapsed }));
  }, []);
  const toggleRight = useCallback(() => {
    setState((s) => ({ ...s, rightCollapsed: !s.rightCollapsed }));
  }, []);

  const grid = useMemo(() => computeGrid(state), [state]);

  return { ...state, grid, setFocus, toggleLeft, toggleRight, setIncomingView };
}
