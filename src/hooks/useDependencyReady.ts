"use client";

// useDependencyReady — the bounded wait behind ProcuLink's degraded-state
// pattern (WP-32).
//
// The problem it solves is generic: a hard external dependency (a hosted auth
// script, a payment SDK, anything whose absence makes a screen unusable) exposes
// a boolean "have I finished loading?" and nothing else. Code that only ever
// checks that boolean cannot tell "still coming" from "never coming", so it
// waits forever and the user sees a permanent spinner. An ad blocker, a
// corporate proxy, and a provider outage all look identical to a hang.
//
// This hook adds the missing third state. After `timeoutMs` with no `ready`,
// the status becomes "unavailable" and the caller can stop waiting and say so.
//
// `armed` is the escape hatch and is load-bearing, not decoration: some builds
// deliberately never load the dependency (ProcuLink's mock and QA-bypass builds
// hand Clerk an empty publishable key on purpose), and in those builds `ready`
// is legitimately false forever. Arming a deadline there would put a failure
// card in front of a perfectly healthy app. Pass `armed: false` whenever the
// caller already has a working path that does not need the dependency.

import { useCallback, useEffect, useState } from "react";
import { msSinceNavigationStart } from "@/lib/navigationClock";

export type DependencyStatus = "pending" | "ready" | "unavailable";

/**
 * The shortest wait this hook will ever run under `since: "navigation"`.
 *
 * Anchoring to navigation can compute a remaining budget of zero — a slow
 * device or link where hydration alone outran the deadline, or a client-side
 * entry into a gated area late in a session. Firing on the next tick in that
 * case would put a failure card on screen in the same frame the component
 * mounted, which reads as a hard error page rather than a bounded wait, and it
 * would pre-empt a dependency whose script has arrived but whose own handshake
 * is still in flight (loading the script and reporting `ready` are two
 * different round trips). 1.5s is about one such round trip on a poor
 * connection. It only ever binds once the anchored budget is nearly spent, so
 * it costs nothing on a normal load.
 */
export const MIN_WAIT_AFTER_MOUNT_MS = 1_500;

export interface UseDependencyReadyOptions {
  /** The dependency's own "I have loaded" signal. */
  ready: boolean;
  /**
   * Whether to run the deadline at all. False = this build/context does not
   * need the dependency, so never report it unavailable. Defaults to true.
   */
  armed?: boolean;
  /** How long to wait before giving up, in milliseconds. */
  timeoutMs: number;
  /**
   * Where the clock starts.
   *
   * "mount" (default) — the wait begins when this component mounts. Right for
   * a dependency whose load this component itself triggers.
   *
   * "navigation" — the wait began at navigation start. Right for a dependency
   * the DOCUMENT requested: its `<script>` is in the HTML, so the browser
   * started fetching it while the page was still parsing, and the document
   * fetch + bundle download + hydrate that happened before React ran were
   * spent out of the same budget. Measuring from mount silently hands all of
   * that time back, so the wall-clock wait grows with page load time.
   */
  since?: "mount" | "navigation";
}

export interface UseDependencyReadyResult {
  status: DependencyStatus;
  /** Clear the verdict and start the wait over (used by a retry action). */
  restart: () => void;
}

export function useDependencyReady({
  ready,
  armed = true,
  timeoutMs,
  since = "mount",
}: UseDependencyReadyOptions): UseDependencyReadyResult {
  const [expired, setExpired] = useState(false);

  // Frozen at the first render, deliberately. The navigation clock keeps
  // moving, so recomputing this every render would feed the effect below a new
  // dependency value each time — the timer would be cleared and restarted on
  // every render and would never fire at all. The consequence of freezing is
  // that `timeoutMs` and `since` are read once; both are constants at every
  // call site.
  const [budgetMs] = useState(() =>
    since === "navigation"
      ? Math.max(MIN_WAIT_AFTER_MOUNT_MS, timeoutMs - msSinceNavigationStart())
      : timeoutMs,
  );

  useEffect(() => {
    // Nothing to time: already there, not waiting, or the verdict is already in
    // (re-running the timer after expiry would fire it again on every render).
    if (ready || !armed || expired) return;
    const timer = setTimeout(() => setExpired(true), budgetMs);
    return () => clearTimeout(timer);
  }, [ready, armed, budgetMs, expired]);

  const restart = useCallback(() => setExpired(false), []);

  const status: DependencyStatus =
    ready || !armed ? "ready" : expired ? "unavailable" : "pending";

  return { status, restart };
}
