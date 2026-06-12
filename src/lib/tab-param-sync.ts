"use client";

// tab-param-sync — make `?tab=` deep links work while the page is MOUNTED.
//
// Tab pages initialize their tab state from useSearchParams() in the useState
// initializer, which only runs once: navigating from /settings to
// /settings?tab=billing (same route, new query) changed the URL but not the
// UI. This hook reacts to query changes without clobbering manual tab clicks:
// manual clicks do NOT write the URL back, so the sync fires ONLY when the
// `?tab=` VALUE itself changes (previous value tracked in a ref) — never on
// re-renders where the param is unchanged.

import { useEffect, useRef } from "react";

/**
 * Pure decision: which tab (if any) should the state sync to, given the new
 * and previous `?tab=` values. Returns null when no sync should happen —
 * either the param did not change (e.g. a re-render after a manual tab click)
 * or the new value is not a valid tab for this page.
 */
export function resolveTabParamChange<T extends string>(
  param: string | null | undefined,
  prevParam: string | null | undefined,
  isValid: (v: string | null | undefined) => v is T,
): T | null {
  if (param === prevParam) return null;
  return isValid(param) ? param : null;
}

/**
 * React to `?tab=` changes while mounted (slideover/guide links, checklist
 * CTAs, back/forward) by syncing them into local tab state. The initial value
 * is the caller's useState initializer's job — this hook never fires on mount
 * (the ref starts at the current param).
 */
export function useTabParamSync<T extends string>(
  param: string | null | undefined,
  isValid: (v: string | null | undefined) => v is T,
  setTab: (tab: T) => void,
): void {
  const prev = useRef(param);
  useEffect(() => {
    const next = resolveTabParamChange(param, prev.current, isValid);
    prev.current = param;
    if (next !== null) setTab(next);
    // isValid/setTab may be unstable across renders; the prev-param guard makes
    // extra invocations no-ops, so including them keeps exhaustive-deps honest.
  }, [param, isValid, setTab]);
}
