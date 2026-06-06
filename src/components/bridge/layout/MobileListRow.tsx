"use client";

import * as React from "react";

/* =====================================================================
   MobileListRow — the canonical "table-row-on-desktop becomes a stacked
   card on mobile" row.

   Use this for the mobile view of every list that ships a desktop table
   (upload / operations health / exceptions / settings / etc.). Full-width
   surface card with a >=44px (--tap-min) hit area, card border/shadow, and
   active-press feedback. When `onClick` is provided the row is keyboard-
   operable (Enter / Space) and exposed as a button to assistive tech.

   Source of truth: docs/design-system/11-unified-page-rules.md

   Needs 'use client' — defines inline keyboard/press handlers.
   ===================================================================== */

type MobileListRowProps = {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
};

export function MobileListRow({ onClick, children, className }: MobileListRowProps) {
  const interactive = typeof onClick === "function";

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={[
        "flex w-full flex-col gap-2",
        interactive ? "cursor-pointer active:bg-surface-2" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-card)",
        padding: 14,
        minHeight: "var(--tap-min)",
        WebkitTapHighlightColor: "transparent",
        transition: "background 120ms, box-shadow 120ms, border-color 120ms",
      }}
    >
      {children}
    </div>
  );
}

export default MobileListRow;
