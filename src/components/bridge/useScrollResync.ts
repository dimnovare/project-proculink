"use client";

// useScrollResync — keep DOM-anchored SVG wire overlays glued to their endpoints
// no matter how the page scrolls.
//
// Why this exists: the wire layers used to re-measure via a capture-phase
// document "scroll" listener. In this app that listener NEVER fired reliably — the
// real scroller is a nested inline-styled <div> and programmatic/synthetic scrolls
// (and, with sticky columns, the sticky-induced position shifts) did not deliver a
// scroll event the listener caught. Result: wires stayed frozen while the user
// scrolled (the long-standing "the wire stays static when I scroll" complaint) and,
// once the source/output columns became sticky, the wires detached entirely.
//
// The fix is event-INDEPENDENT: a single requestAnimationFrame loop polls every
// scrollable ancestor's scrollTop/scrollLeft plus window scroll, and invokes
// onChange() only when something actually moved. Polling a handful of numbers per
// frame is negligible; the heavy re-measure runs ONLY when a scroll position
// changed, so idle cost is nil and there is no render loop (onChange triggers a
// guarded measure that no-ops when geometry is unchanged).

import { useEffect } from "react";

export function useScrollResync(
  gridRef: React.RefObject<HTMLElement | null>,
  onChange: () => void,
) {
  useEffect(() => {
    let raf = 0;
    // Snapshot of the last-seen scroll signature; start at NaN so the first frame
    // never spuriously fires (we compare against the same initial read).
    let last = "";

    // Collect every scrollable ancestor once (the set is stable for this screen).
    const scrollers: HTMLElement[] = [];
    let el: HTMLElement | null = gridRef.current?.parentElement ?? null;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      const ox = getComputedStyle(el).overflowX;
      if (oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll") scrollers.push(el);
      el = el.parentElement;
    }

    const signature = () => {
      let s = `${window.scrollX},${window.scrollY}`;
      for (const sc of scrollers) s += `|${sc.scrollLeft},${sc.scrollTop}`;
      return s;
    };
    last = signature();

    const tick = () => {
      const sig = signature();
      if (sig !== last) { last = sig; onChange(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gridRef, onChange]);
}
