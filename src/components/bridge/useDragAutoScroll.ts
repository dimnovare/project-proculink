"use client";

// useDragAutoScroll — while a wire drag is in progress, scroll the review's
// scroll container when the pointer nears its top/bottom edge. This is what makes
// "dragging from the bottom" usable: the canonical / output drop targets scroll
// into view as you drag toward an edge, instead of forcing the user to scroll the
// page first and then drag. It changes NO layout geometry — the wire overlays
// already re-measure on every scroll (capture-phase scroll listener), so the wires
// stay attached while the container auto-scrolls.
//
// Native pointer-capture drags do not auto-scroll and only deliver pointermove when
// the pointer actually moves, so we drive a rAF loop off the last known pointer Y:
// the loop keeps scrolling while the pointer sits in the edge band even if it is held
// still. The loop runs ONLY between onDragPointer() and stopAutoScroll().

import { useCallback, useEffect, useRef } from "react";

// px band at the top/bottom of the scroller within which auto-scroll kicks in.
const EDGE = 90;
// px per frame at the very edge (ramps down linearly to 0 at the band's inner edge).
const MAX_SPEED = 20;

export function useDragAutoScroll(gridRef: React.RefObject<HTMLElement | null>) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pointerY = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Nearest actually-scrollable ancestor of the grid; falls back to the page root.
  const findScroller = useCallback((): HTMLElement => {
    let el: HTMLElement | null = gridRef.current?.parentElement ?? null;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  }, [gridRef]);

  const tick = useCallback(() => {
    const sc = scrollerRef.current;
    const y = pointerY.current;
    if (!sc || y == null) { rafRef.current = null; return; }

    // Viewport-space top/bottom of the scroll region.
    const isRoot = sc === document.scrollingElement || sc === document.documentElement;
    const top = isRoot ? 0 : sc.getBoundingClientRect().top;
    const bottom = isRoot ? window.innerHeight : sc.getBoundingClientRect().bottom;

    let dv = 0;
    if (y < top + EDGE)         dv = -MAX_SPEED * Math.min(1, (top + EDGE - y) / EDGE);
    else if (y > bottom - EDGE) dv =  MAX_SPEED * Math.min(1, (y - (bottom - EDGE)) / EDGE);
    if (dv !== 0) sc.scrollBy(0, dv);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Call on every drag pointer-move with the pointer's viewport clientY.
  const onDragPointer = useCallback((clientY: number) => {
    pointerY.current = clientY;
    if (rafRef.current == null) {
      scrollerRef.current = findScroller();
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [findScroller, tick]);

  // Call on drag end / cancel.
  const stopAutoScroll = useCallback(() => {
    pointerY.current = null;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  // Safety: stop the loop if the component unmounts mid-drag.
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  return { onDragPointer, stopAutoScroll };
}
