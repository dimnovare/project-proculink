"use client";

import { useId } from "react";

/** The mark's link (MarkSystem), drawn once as a grey rail and once as the moving dash. */
const LINK = "M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8";

/**
 * The ProcuLink mark, moving: a blue→green dash runs the link from the blue dot to the green one
 * while the dots pulse in turn. Decorative; the words next to it are what a screen reader hears.
 * Under reduced motion it holds still as the whole mark (globals.css, `.logo-loader`).
 */
export function LogoLoader({ size = 18 }: { size?: number }) {
  // A gradient referenced by id fails when the first element with that id sits in a hidden tree,
  // so every loader carries its own. useId's punctuation is not safe inside url(#…).
  const id = `ll${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg aria-hidden="true" focusable="false" className="logo-loader shrink-0" width={size} height={size} viewBox="0 0 40 40" fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1E66C9" />
          <stop offset="100%" stopColor="#2E8E3A" />
        </linearGradient>
      </defs>
      <path className="ll-rail" d={LINK} strokeWidth={3.6} strokeLinecap="round" />
      <path className="ll-wire" d={LINK} pathLength={100} stroke={`url(#${id})`} strokeWidth={3.6} strokeLinecap="round" />
      <circle className="ll-node" cx="8" cy="10" r="3" fill="#1E66C9" />
      <circle className="ll-node ll-node-out" cx="8" cy="30" r="3" fill="#2E8E3A" />
    </svg>
  );
}

/** Something is on its way: the moving mark and the words for what is loading. */
export const Loading = ({ children, className = "" }: { children: string; className?: string }) => (
  <p role="status" className={`m-0 flex items-center gap-2 text-[13px] text-ink-muted ${className}`}>
    <LogoLoader />
    {children}
  </p>
);
