/**
 * The one line under "Poll inbox for orders" on Settings ▸ Email intake.
 *
 * WHAT WAS WRONG. That line read `form.enabled ? "Checking every 5 minutes" : "Disabled"`.
 * `enabled` is a SAVED SETTING — a boolean the operator typed — so the sentence was a claim about
 * a live IMAP connection derived from nothing but the user's own intent. A wrong password, an
 * unreachable host, a Worker that stopped consuming jobs: every one of those leaves the line
 * reading "Checking every 5 minutes", forever. It was in fact worse than "derived from a saved
 * setting", because `form` is the DIRTY form state: flipping the switch and not saving already
 * changed the sentence.
 *
 * WHAT ANSWERS IT. `EmailSettings.lastPolledAt` is a genuine success stamp. The backend
 * (`ProcuLink.Worker` → `EmailPollOrgJob`) writes it only after connect + authenticate + fetch +
 * clean disconnect; every failure path returns or throws first. So a fresh stamp is evidence the
 * mailbox really was read, a stale one is evidence it was not, and its absence is evidence of
 * neither. Those are three different states and none of them is "Checking every 5 minutes".
 *
 * THE HONESTY RULES (same contract as `src/components/settings/InboundAddressSection.tsx` and
 * `src/components/bridge/catalogSourceHelpers.ts`):
 *   • the cadence sentence — "Checking every 5 minutes" — may only be printed NEXT TO a recent
 *     success. On its own it is the original defect.
 *   • `lastPolledAt === null` is "no successful check on record", NOT "never ran". The Worker
 *     writes nothing on failure, so a mailbox that has been failing every 5 minutes for a week
 *     looks identical to one that has never been tried. The line must not pick one.
 *   • a present-but-unparseable stamp renders as unreadable, never as "never" and never as a
 *     success. An unknown value falling through to the favourable reading is the defect class.
 *   • an unsaved toggle says so, because until Save is pressed the switch describes an intention
 *     and the server is still doing whatever it was doing before.
 */

import { relativeTime } from "@/components/bridge/catalogSourceHelpers";

/** How the line reads, and therefore what colour it takes. Never a spare slot. */
export type PollingHealthTone = "unsaved" | "off" | "unverified" | "healthy" | "stale";

export interface PollingHealthLine {
  tone: PollingHealthTone;
  text: string;
}

/** The Worker's schedule. Stated once so the sentence and the threshold cannot drift apart. */
export const POLL_INTERVAL_MINUTES = 5;

/**
 * How old a success stamp may get before the line stops vouching for the connection.
 *
 * Three missed cycles. Deliberately not one: a single skipped run is ordinary (job queue latency,
 * a slow mailbox, a redeploy) and flagging it would train operators to ignore the warning. Three
 * in a row is not ordinary.
 */
export const POLL_STALE_AFTER_MS = POLL_INTERVAL_MINUTES * 3 * 60 * 1000;

type StampReading =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "at"; ageMs: number; relative: string };

/**
 * Absent, unreadable, or a real instant — kept apart on purpose.
 *
 * `relativeTime` collapses the first two into `null`, which is fine for its own callers but not
 * here: "we have no record" and "we have a record we cannot read" are different admissions, and
 * folding either into a success is what this file exists to prevent.
 */
function readStamp(iso: string | null | undefined, now: number): StampReading {
  if (!iso || !iso.trim()) return { kind: "absent" };
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { kind: "unreadable" };
  const relative = relativeTime(iso, now);
  if (!relative) return { kind: "unreadable" };
  return { kind: "at", ageMs: now - then, relative };
}

export interface PollingHealthInput {
  /** `enabled` as the server last confirmed it. */
  savedEnabled: boolean;
  /** `enabled` as the switch currently shows it — may be an unsaved edit. */
  pendingEnabled: boolean;
  /** `EmailSettings.lastPolledAt` — written only after a poll fully succeeded. */
  lastPolledAt: string | null | undefined;
}

export function pollingHealthLine(
  { savedEnabled, pendingEnabled, lastPolledAt }: PollingHealthInput,
  now: number = Date.now(),
): PollingHealthLine {
  // An unsaved switch describes nobody's behaviour yet. Say that before saying anything else,
  // because every reading below is about what the server is actually doing.
  if (pendingEnabled !== savedEnabled) {
    return {
      tone: "unsaved",
      text: pendingEnabled
        ? "Not saved yet — this mailbox is not being checked until you save."
        : "Not saved yet — this mailbox is still being checked until you save.",
    };
  }

  const stamp = readStamp(lastPolledAt, now);

  if (!savedEnabled) {
    // Off is the one state the saved setting really does settle. A past success is still a fact
    // worth printing; an unreadable stamp is not, so it is simply left out.
    return {
      tone: "off",
      text:
        stamp.kind === "at"
          ? `Off — this mailbox is not being checked. Last successful check ${stamp.relative}.`
          : "Off — this mailbox is not being checked.",
    };
  }

  if (stamp.kind === "absent") {
    return {
      tone: "unverified",
      text: "Polling is on, but no check has succeeded yet — ProcuLink cannot confirm this mailbox is being read.",
    };
  }

  if (stamp.kind === "unreadable") {
    return {
      tone: "unverified",
      text: "Polling is on, but ProcuLink cannot read when this mailbox was last checked.",
    };
  }

  if (stamp.ageMs > POLL_STALE_AFTER_MS) {
    return {
      tone: "stale",
      text: `Last successful check ${stamp.relative} — polling may not be working.`,
    };
  }

  // The ONLY place the cadence is allowed to be stated, and it never travels without the evidence.
  return {
    tone: "healthy",
    text: `Checking every ${POLL_INTERVAL_MINUTES} minutes — last successful check ${stamp.relative}.`,
  };
}
