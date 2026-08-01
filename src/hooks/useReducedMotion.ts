"use client";

// useReducedMotion — the ONE reduced-motion signal.
//
// Extracted verbatim from WireTopology.tsx, where it was file-private. It is the
// app's SMIL answer and the app's SMIL answer is CORRECT: `globals.css` neutralises
// CSS animation-duration under `prefers-reduced-motion: reduce`, but SVG SMIL
// (`<animate>`, `<animateMotion>`, `<animateTransform>`) is NOT CSS and no media
// query can stop it. The only reliable fix is to not render the SMIL element at
// all — which needs a JS read of the media query, i.e. this hook.
//
// It was private, so the marketing hero (`BridgeIllustration`) could not reuse it
// and shipped eight `repeatCount="indefinite"` SMIL animations with no guard.
// Moving the hook here is the whole fix: one mechanism, two call sites.

import { useEffect, useState } from "react";

/**
 * Tracks the OS-level `prefers-reduced-motion: reduce` setting.
 *
 * Starts `false` on the server and on first client paint (there is no way to read
 * a media query during SSR), then flips on the first effect. That is the same
 * one-frame behaviour WireTopology has always had; a SMIL element that mounts for
 * one frame and is then removed is not perceptible motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default useReducedMotion;
