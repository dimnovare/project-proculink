"use client";

// useBreakpointBand — one client-side source of truth for the Triage
// responsive compositions (batch 9 Phase C):
//   sm <768 · md 768–1023 · lg 1024–1279 · xl 1280–1919 · xxl ≥1920
//
// The INITIAL render always reports "xl" (a deterministic value, identical on
// server and client, so hydration never mismatches); the real band is applied
// in an effect on mount and tracked on resize. Exactly ONE stage instance is
// mounted per band, so band-driven composition switches can never double-mount
// an autoFocus input.

import { useEffect, useState } from "react";
import { bandForWidth, type StageBand } from "./stageModel";

export function useBreakpointBand(): StageBand {
  const [band, setBand] = useState<StageBand>("xl");
  useEffect(() => {
    const update = () => setBand(bandForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return band;
}
