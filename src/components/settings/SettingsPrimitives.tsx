import type { ReactNode } from "react";
import { Card } from "@/components/bridge/layout/Card";

/**
 * Shared Settings primitives. Extracted from the Settings page so both
 * `settings/page.tsx` and `PullIngressSettings.tsx` can use the canonical card
 * shell WITHOUT a page<->component import cycle — and without illegally
 * exporting non-default symbols from a Next App Router page module
 * (which `next build` rejects).
 *
 * 2026-07-02: rebuilt on the canonical layout primitive
 * (src/components/bridge/layout/Card.tsx) + Tailwind design tokens instead of
 * raw CSSProperties. The full-bleed divider header is Settings-specific, so it
 * renders inside the Card via negative margins (Card owns surface / border /
 * radius-md / shadow-card / 18px padding). The former `primaryGreenButton`
 * style object is gone — use <Button variant="primary" size="lg"> from
 * src/components/bridge/DSPrimitives.tsx instead.
 */

/** Canonical Settings card: title/sub header (full-bleed divider) + body. */
export function SettingsGroup({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      {/* Header — bleeds to the Card edges (negative margins against Card's
          18px padding) so the divider runs full width, as before. */}
      <div className="-mx-[18px] -mt-[18px] mb-4 border-b border-border px-[18px] py-3.5">
        <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
        {sub && <div className="mt-0.5 text-[12px] leading-[1.45] text-ink-muted">{sub}</div>}
      </div>
      {children}
    </Card>
  );
}
