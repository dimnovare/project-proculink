"use client";

// Kbd — visible keyboard-shortcut hint chip (e.g. the "A" next to Accept).
// Extracted as-is from SpineReview.tsx (batch 9 Phase A) so the Fix Queue rail
// and the classic triptych render the identical element.

import type React from "react";

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      aria-hidden
      style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.22)",
        border: "1px solid rgba(255,255,255,0.35)",
        color: "inherit",
        textTransform: "uppercase",
      }}
    >
      {children}
    </kbd>
  );
}

/** Dark-on-light variant for hints rendered on white surfaces (queue header). */
export function KbdLight({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      aria-hidden
      style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        background: "#F0F2F7",
        border: "1px solid #E2E6EE",
        color: "#56627A",
        textTransform: "uppercase",
      }}
    >
      {children}
    </kbd>
  );
}
