"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scrollRegionProps } from "@/components/bridge/document/scrollRegion";

/**
 * TableScroller — the horizontal scroller a wide legal table needs on a phone.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────
 * `/privacy` and `/subprocessors` each print a data table straight into the page
 * flow with `width: "100%"`. `width: 100%` is a MAXIMUM, not a floor: a table
 * still expands to its min-content width and spills out of its container. At a
 * 375px viewport (iPhone SE, and every older iPhone) the /subprocessors table
 * needs 465px against a 311px content box and pushed the whole document to
 * 497px — the page scrolled sideways, and the last column was off-screen. The
 * /privacy table needs 350px and pushed the document to 382px.
 *
 * Neither break was visible to the visual suite, whose narrow viewport is 390.
 * At 390 the /privacy table lands at x=382 — inside the viewport by 8px, purely
 * because the page's 32px side padding absorbed the spill. It was never healthy;
 * it was 8px from the same failure. /subprocessors overflowed at 390 too and was
 * simply never asserted on.
 *
 * ── WHY A SCROLLER AND NOT A NARROWER TABLE ───────────────────────────────────
 * These are GDPR Art. 28 disclosures. Every cell is load-bearing — which
 * subprocessor, for what purpose, in which jurisdiction, under which contract —
 * so nothing may be dropped or truncated at a breakpoint. Four columns of prose
 * do not fit 311px at a readable size by any arrangement, so the honest answer is
 * to let the table keep its own width and scroll it.
 *
 * ── WHY THIS IS A CLIENT COMPONENT ────────────────────────────────────────────
 * A box with `overflow-x: auto` and no focusable content inside cannot be
 * scrolled by keyboard at all: there is nothing to Tab to (axe
 * `scrollable-region-focusable`, serious, WCAG 2.1.1). The fix is `tabIndex={0}`
 * plus a name — but ONLY while it actually scrolls. On a desktop, where the table
 * fits, a permanent tab stop is a dead stop the reader tabs through for nothing.
 * That is the exact `scrolls` semantic `scrollRegionProps` was written for, and it
 * is a measurement, so it happens after mount and is re-measured on resize.
 *
 * Server-rendered output therefore carries the scroller but no tab stop; the tab
 * stop appears on hydration only where it is needed.
 */
export function TableScroller({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // +1 absorbs sub-pixel layout rounding, which would otherwise flip this on and
    // off across a resize and add or remove a tab stop under the reader.
    setScrolls(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div
      ref={ref}
      data-testid="table-scroller"
      data-scrolls={scrolls ? "true" : "false"}
      style={{ overflowX: "auto", maxWidth: "100%" }}
      {...scrollRegionProps(label, scrolls)}
    >
      {children}
    </div>
  );
}
