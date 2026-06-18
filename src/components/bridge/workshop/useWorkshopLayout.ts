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

/** Which zone the operator is focusing. `all` = the balanced three-zone view. */
export type WorkshopFocus = "all" | "mapping" | "output";

/** One zone's grid track: a thin collapsed rail, its natural width, or the flex hero. */
export type ZoneTrack = "rail" | "auto" | "1fr";

export interface WorkshopLayoutState {
  focus: WorkshopFocus;
  /** Manual per-zone collapse (only honored when focus === "all"). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
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
export function computeGrid(state: WorkshopLayoutState): WorkshopGrid {
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
    setState((s) => ({ ...s, focus }));
  }, []);
  const toggleLeft = useCallback(() => {
    setState((s) => ({ ...s, leftCollapsed: !s.leftCollapsed }));
  }, []);
  const toggleRight = useCallback(() => {
    setState((s) => ({ ...s, rightCollapsed: !s.rightCollapsed }));
  }, []);

  const grid = useMemo(() => computeGrid(state), [state]);

  return { ...state, grid, setFocus, toggleLeft, toggleRight };
}
