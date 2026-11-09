"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Box } from "@/lib/api/documents";
import { SourceHighlight } from "./SourceHighlight";

type Pt = { x: number; y: number };
const MIN = 0.005;
const DRAG_PX = 8;
// Keyboard: arrows move the box, Shift + arrows resize it, Enter uses it. Steps are binary fractions so sums stay exact.
const STEP = 1 / 32;
const START: Box = { x: 0.375, y: 0.4375, width: 0.25, height: 0.125 };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function nudge(b: Box, [dx, dy]: [number, number], grow: boolean): Box {
  return grow
    ? { ...b, width: clamp(b.width + dx * STEP, STEP, 1 - b.x), height: clamp(b.height + dy * STEP, STEP, 1 - b.y) }
    : { ...b, x: clamp(b.x + dx * STEP, 0, 1 - b.width), y: clamp(b.y + dy * STEP, 0, 1 - b.height) };
}

/** Corner to corner, any direction; sums stay <= 1 because the backend compares them exactly. */
function boxOf(a: Pt, b: Pt): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.min(Math.abs(a.x - b.x), 1 - x);
  const height = Math.min(Math.abs(a.y - b.y), 1 - y);
  return { x, y, width, height };
}

/** Draw a box on the page: drag, click two corners, or use the keyboard. Place inside the `relative` page wrapper. */
export function RegionPicker({ page, onBox }: { page: number; onBox(box: Box): void }) {
  const anchor = useRef<Pt | null>(null);
  const down = useRef<Pt>({ x: 0, y: 0 }); // client px, to tell a click from a drag
  const [corner, setCorner] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  const pt = (e: PointerEvent<HTMLDivElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, r.width) / r.width, y: clamp(e.clientY - r.top, 0, r.height) / r.height };
  };
  const finish = (b: Box) => {
    if (b.width < MIN || b.height < MIN) return false;
    onBox(b);
    return true;
  };

  return (
    <div
      role="group"
      aria-label={`Draw a box on page ${page}`}
      tabIndex={0}
      className="absolute inset-0 cursor-crosshair touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft) {
          e.preventDefault();
          if (finish(draft)) setDraft(null);
          return;
        }
        if (!ARROWS[e.key]) return;
        e.preventDefault();
        setDraft(nudge(draft ?? START, ARROWS[e.key], e.shiftKey));
      }}
      onBlur={() => setDraft(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        anchor.current = pt(e);
        down.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        anchor.current = null;
        setDraft(null);
      }}
      onPointerMove={(e) => anchor.current && setDraft(boxOf(anchor.current, pt(e)))}
      onPointerUp={(e) => {
        const a = anchor.current;
        anchor.current = null;
        setDraft(null);
        if (!a) return;
        const p = pt(e);
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) >= DRAG_PX && finish(boxOf(a, p))) return setCorner(null);
        // Too short to be a drag: a click. The first marks a corner, the second completes the box.
        if (corner && finish(boxOf(corner, p))) return setCorner(null);
        setCorner(p);
      }}
    >
      {draft && <SourceHighlight box={draft} />}
      {corner && !draft && <SourceHighlight box={boxOf(corner, { x: Math.min(corner.x + 0.01, 1), y: Math.min(corner.y + 0.01, 1) })} />}
    </div>
  );
}
