/**
 * How a saved webhook subscription is described on Settings ▸ Notifications.
 *
 * WHAT WAS WRONG. The row rendered a green dot and the word "Active" for
 * `sub.isActive && sub.failureCount === 0`, which reads as "this URL is receiving events". It
 * cannot mean that, for two independent reasons:
 *
 *   1. `failureCount` is a CONSECUTIVE-failure streak, not a total. The backend
 *      (`FireIntegrationTriggerJob`) resets it to 0 on every 2xx and increments it only on the
 *      final attempt of a delivery. A webhook failing half the time therefore wears the green
 *      pill whenever the most recent delivery happened to land.
 *   2. `IntegrationSubscription` has no last-delivered column at all, so `failureCount === 0`
 *      cannot separate "the last delivery succeeded" from "nothing has ever been sent". A URL
 *      typo'd at creation is green from the moment it is saved and stays green forever.
 *
 * And a third, smaller hole: the row's ternary yielded `null` for `isActive && failureCount > 0`,
 * so a failing subscription showed neither "Active" nor "Paused" — the state most worth naming
 * was the one with no badge.
 *
 * WHAT THIS RENDERS INSTEAD. Two facts the data really does carry — whether the subscription is
 * switched on, and whether the most recent delivery attempt failed — and an explicit admission of
 * the one it does not: whether anything has ever got through.
 *
 * WHAT WOULD ACTUALLY ANSWER IT (backend, not this file): a `LastDeliveredAt` timestamp on
 * `IntegrationSubscription`, written on 2xx the same way `FireIntegrationTriggerJob` already
 * resets `FailureCount`. With it, "Delivered 3m ago" / "Never delivered" become observations
 * rather than guesses, and this file's `unverified` state disappears.
 */

/** How the row reads. `unverified` is the honest reading of "no failure streak", not a spare slot. */
export type WebhookHealthTone = "paused" | "failing" | "unverified";

export interface WebhookHealthReading {
  tone: WebhookHealthTone;
  /** The pill word. Describes the SETTING or the last attempt — never the health of the URL. */
  badge: string;
  /** The sentence under the row. Says what is known and, where nothing is, says that. */
  text: string;
}

export interface WebhookHealthInput {
  isActive: boolean;
  /** Consecutive failures since the last 2xx — NOT a lifetime count. */
  failureCount: number;
}

export function webhookHealth({ isActive, failureCount }: WebhookHealthInput): WebhookHealthReading {
  if (!isActive) {
    return {
      tone: "paused",
      badge: "Paused",
      text: "Paused — ProcuLink is not sending events to this URL.",
    };
  }

  // A count that is not a whole number ≥ 0 is not a state this build understands. It falls to an
  // admission, never to the favourable reading.
  const streak = Number.isFinite(failureCount) ? Math.trunc(failureCount) : null;
  if (streak === null || streak < 0) {
    return {
      tone: "unverified",
      badge: "Enabled",
      text: "Enabled. ProcuLink cannot read this URL's recent delivery result, so it cannot confirm events are arriving.",
    };
  }

  if (streak > 0) {
    return {
      tone: "failing",
      badge: "Failing",
      text:
        streak === 1
          ? "The last delivery attempt to this URL failed."
          : `The last ${streak} delivery attempts to this URL failed in a row.`,
    };
  }

  return {
    tone: "unverified",
    badge: "Enabled",
    text: "Enabled, with no recent failures. ProcuLink does not record successful deliveries, so it cannot confirm events are arriving.",
  };
}
