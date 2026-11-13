"use client";

// useLgViewport — is the desktop layout the visible surface? The order-source hook that shared
// this file went with the order write path (2026-11-13); the flow document screen reads this.

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `lg`, which is what separates the desktop workshop from MobileTriage. */
const LG_QUERY = "(min-width: 1024px)";
let lgMedia: MediaQueryList | null = null;

function lgMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (!lgMedia) lgMedia = window.matchMedia(LG_QUERY);
  return lgMedia;
}

/**
 * Is the desktop workshop the visible surface?
 *
 * This exists for ONE reason: `hidden lg:flex` hides the desktop mapper with CSS, but React
 * still mounts it and its hooks still run — so without this, opening an order on a phone would
 * download the whole source file for a pane that is not on screen. Below `lg` the document is
 * opt-in (MobileTriage's collapsed card), and this is what makes "opt-in" true rather than
 * decorative. The query string is Tailwind's own `lg` value, so JS and CSS agree by definition.
 */
export function useLgViewport(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = lgMediaQuery();
    if (!mql) return () => {};
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => lgMediaQuery()?.matches ?? false,
    // Server render: assume narrow, so nothing is fetched during SSR. The client corrects it on
    // the first commit, before any paint the operator could see.
    () => false,
  );
}
