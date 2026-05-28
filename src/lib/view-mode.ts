"use client";

import { useEffect, useState } from "react";

/**
 * ProcuLink Dual-Persona UX (Phase 6+).
 *
 * Two view modes, sticky in localStorage:
 *
 *  - **default**  : novice-friendly. Wizard, AI suggestions visible, generous
 *                   spacing, fewer columns per table, copy-driven empty states.
 *  - **expert**   : 30-year-procurement-veteran density. Smaller paddings, more
 *                   columns, raw standard-mapping inline, keyboard hotkeys
 *                   enabled, less hand-holding copy.
 *
 * The toggle lives in BridgeTopbar; downstream components read this hook and
 * render the matching variant. Initial render is **default** to keep SSR/CSR
 * deterministic; the hook hydrates on mount and emits a custom event so any
 * other component using `useViewMode()` rerenders in the same tick.
 */

export type ViewMode = "default" | "expert";

const STORAGE_KEY = "proculink_view_mode_v1";
const EVENT_NAME  = "proculink:view-mode";

function readMode(): ViewMode {
  if (typeof window === "undefined") return "default";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "default" || raw === "expert") return raw;
    return "default";
  } catch {
    return "default";
  }
}

/** Imperative read — useful outside React (e.g. in api-client format choices). */
export function getViewMode(): ViewMode {
  return readMode();
}

export function setViewMode(value: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: value }));
  } catch {
    /* localStorage may be unavailable in private modes — fail silently */
  }
}

/** Reactive hook — components rerender on view-mode change. */
export function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("default");

  useEffect(() => {
    setMode(readMode());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ViewMode>).detail;
      if (detail === "default" || detail === "expert") setMode(detail);
    };
    window.addEventListener(EVENT_NAME, onChange);
    // Also reflect cross-tab updates.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const v = e.newValue;
      if (v === "default" || v === "expert") setMode(v);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [mode, setViewMode];
}

/** Convenience boolean — `isExpert ? <DenseTable /> : <FriendlyCards />` */
export function useIsExpert(): boolean {
  const [mode] = useViewMode();
  return mode === "expert";
}
