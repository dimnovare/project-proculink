import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";

/**
 * Shared Settings primitives. Kept out of the Settings page because a Next App Router page module may not
 * export non-default symbols (which `next build` rejects).
 */

/** A white panel (radius 12, padding 24, 20/16 under 560px, gap 16) labelled by its own h2 (16px, 600). */
export function SettingsPanel({ id, title, as = "section", sub, side, className, "data-testid": testId, children }: {
  id: string; title: ReactNode; as?: "section" | "aside"; sub?: string; side?: ReactNode;
  className?: string; "data-testid"?: string; children?: ReactNode;
}) {
  return (
    <Card as={as} flush radius={12} aria-labelledby={id} className={className} data-testid={testId}>
      {/* Card pads inline, so the padding lives on an inner box to stay responsive. */}
      <div className="flex flex-col gap-4 p-6 max-[560px]:px-4 max-[560px]:py-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
            <h2 id={id} className="m-0 text-[16px] font-semibold leading-[1.3] text-ink">{title}</h2>
            {sub && <p className="m-0 text-[14px] text-ink-muted">{sub}</p>}
          </div>
          {side && <div className="ml-auto">{side}</div>}
        </div>
        {children}
      </div>
    </Card>
  );
}

/** "Saved" with a green tick, 13px muted, `role="status"`. */
export function SavedMark() {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
      <Check aria-hidden size={14} strokeWidth={2.5} className="text-brand-green-deep" />
      Saved
    </span>
  );
}
