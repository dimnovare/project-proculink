"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "./DSPrimitives";
import { StatusNotice } from "./layout/StatusNotice";

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
 *
 * WHY <StatusNotice> AND NOT <Card>. The first draft of this file hand-rolled a
 * bordered, padded, rounded `<div>`, and the card-surface gate failed it — which
 * was the correct call twice over. CLAUDE.md §6 makes `<Card>` the one card, and
 * §12 says a card edge names which SIDE of the bridge a card is on (buyer /
 * supplier / both / neither) and is never a status colour. This banner is pure
 * TONE: it carries no side at all, so its `<Card>` edge could only ever have
 * been `edge="none"`, and reaching for an amber edge to signal staleness is
 * precisely the misuse §12 names. Tone belongs to `<StatusNotice>`, which
 * signals it with its own 3px left border.
 *
 * WHY tone="error". `StatusNotice` has three tones and none of them is amber.
 * `working` is the blue in-progress/informational tone, and painting a failed
 * request in it is the exact defect StatusNotice was extracted to prevent
 * (/operations/health once rendered a REFUSED requeue in success-adjacent blue).
 * The refresh did not happen, so it is an error, and the `role="alert"` that
 * StatusNotice derives from that tone is right: the operator is reading numbers
 * that are not current on a screen whose whole job is to be current. The ARIA is
 * derived, never passed — see that component's header.
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
    <StatusNotice
      tone="error"
      className="mb-3"
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={13} aria-hidden />
          Try again
        </Button>
      }
    >
      We couldn&apos;t refresh {what}. What you&apos;re reading is the last successful check,{" "}
      {staleAgeSentence(dataUpdatedAt, now)}, so it may be out of date.
    </StatusNotice>
  );
}
