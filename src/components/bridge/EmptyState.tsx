// EmptyState — the one empty state: a heading, one line, at most one action.

import React from "react";
import { Button, buttonClass } from "./DSPrimitives";

type ActionObject = { label: string; onClick: () => void; variant?: Parameters<typeof buttonClass>[0] };

export interface EmptyStateProps {
  title: string;
  sub?: string;
  /** Shown above the heading (the green tick on "You're all caught up."). Decorative. */
  icon?: React.ReactNode;
  /** One action: a ready-made link or button, or { label, onClick } drawn as a Button (navy unless `variant`). */
  action?: React.ReactNode | ActionObject;
  /** No minimum height (inside a smaller panel). */
  compact?: boolean;
}

const isActionObject = (a: unknown): a is ActionObject =>
  typeof a === "object" && a !== null && !React.isValidElement(a) && "onClick" in a;

export function EmptyState({ title, sub, icon, action, compact = false }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-col items-center justify-center gap-2 px-6 py-7 text-center${compact ? "" : " min-h-[208px]"}`}
    >
      {icon}
      <h2 className="m-0 text-[18px] font-semibold text-ink">{title}</h2>
      {sub && <p className="m-0 text-[14px] text-ink-muted">{sub}</p>}
      {action != null && (
        <div className="mt-2">
          {isActionObject(action) ? (
            <Button variant={action.variant ?? "primary"} size="md" onClick={action.onClick}>{action.label}</Button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}
