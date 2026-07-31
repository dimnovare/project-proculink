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

export type DependencyStatus = "pending" | "ready" | "unavailable";

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
}: UseDependencyReadyOptions): UseDependencyReadyResult {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // Nothing to time: already there, not waiting, or the verdict is already in
    // (re-running the timer after expiry would fire it again on every render).
    if (ready || !armed || expired) return;
    const timer = setTimeout(() => setExpired(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [ready, armed, timeoutMs, expired]);

  const restart = useCallback(() => setExpired(false), []);

  const status: DependencyStatus =
    ready || !armed ? "ready" : expired ? "unavailable" : "pending";

  return { status, restart };
}
