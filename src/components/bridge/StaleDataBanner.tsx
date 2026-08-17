"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "./DSPrimitives";

/**
 * The banner a screen shows when a refresh FAILED but the previous answer is
 * still in hand.
 *
 * It exists because the alternative shipped twice on the operations pages: a
 * bare `isError` branch that replaced the entire screen with an error card,
 * throwing away cached data that was seconds old. On /operations/health that
 * card also took the dead-letter requeue buttons with it — the only escalation
 * path on the page — and told the operator "we just can't show you the current
 * picture" while a 45-second-old picture sat in the query cache.
 *
 * The rule this encodes: a failed refresh downgrades CONFIDENCE, it does not
 * erase KNOWLEDGE. Blocking cards are for `data === undefined`. Everything else
 * gets this banner, which says three things and no more — the refresh failed,
 * how old what you are reading is, and how to try again.
 */

/**
 * How old the data on screen is, as a phrase that slots after "last successful
 * check".
 *
 * `dataUpdatedAt` is TanStack's timestamp in ms. It is 0 for a query that has
 * never resolved — that case must never reach this banner (a query with no data
 * gets the blocking card instead), but it is handled rather than trusted,
 * because printing "from 56 years ago" would be a worse failure than vagueness.
 */
export function staleAgeSentence(dataUpdatedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(dataUpdatedAt) || dataUpdatedAt <= 0) return "from an earlier check";
  const seconds = Math.floor((now - dataUpdatedAt) / 1000);
  if (seconds < 0) return "from an earlier check";
  if (seconds < 45) return "from a few seconds ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "from 1 minute ago" : `from ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "from 1 hour ago" : `from ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "from 1 day ago" : `from ${days} days ago`;
}

export function StaleDataBanner({
  what,
  dataUpdatedAt,
  onRetry,
  now,
}: {
  /** What failed to refresh, in the words the page uses. E.g. "system status". */
  what: string;
  /** TanStack `dataUpdatedAt` for the query whose refresh failed. */
  dataUpdatedAt: number;
  onRetry: () => void;
  /** Injectable clock — the age sentence is otherwise untestable. */
  now?: number;
}) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 12,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        background: "var(--amber-soft)",
        border: "1px solid var(--amber)",
        borderRadius: "var(--radius-md)",
        padding: "9px 12px",
        fontSize: 12.5,
        color: "var(--amber-text)",
      }}
    >
      <span style={{ flex: "1 1 240px", minWidth: 0 }}>
        We couldn&apos;t refresh {what}. What you&apos;re reading is the last successful check,{" "}
        {staleAgeSentence(dataUpdatedAt, now)}, so it may be out of date.
      </span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden />
        Try again
      </Button>
    </div>
  );
}
