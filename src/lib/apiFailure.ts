// ─────────────────────────────────────────────────────────────────────────────
// apiFailure — what a failed request MEANS, in one place.
//
// WP-19. `ApiHttpError` carried a raw status number and nothing else, and the
// query client retried every failure exactly once:
//
//     queries: { staleTime: 60 * 1000, retry: 1, networkMode: "always" }
//
// One policy for every cause, so all three of the codes that need different
// treatment got the same wrong one:
//
//   401  Retried once. The cold-mount race this app really has (a query can fire
//        before Clerk has a token — observed on production 2026-06-16, same
//        request 200 with a token and 401 without) needs MORE than one retry to
//        ride out; `/admin` already hard-codes three for exactly this. One retry
//        under-serves the race, and when the session really has expired the user
//        is shown a generic error with no way back to sign-in.
//   404  Retried once, pointlessly — the second answer is the first answer — and
//        then rendered through the same "couldn't load / check your connection"
//        copy as a network fault, so a deleted order reads like a broken app.
//   429  Retried once, IMMEDIATELY, against a limiter that rejects precisely
//        because it is being called too often. The retry is spent while the
//        window is still closed, and what the operator sees is a permanent
//        failure for the one condition here that is guaranteed to clear on its
//        own. The wait was never read because nothing sent it.
//
// So this module answers "what kind of failure is this, and does waiting help?"
// and the query client asks it instead of guessing. Copy lives with the screens;
// what lives here is the classification they all branch on.
//
// Every function is total and accepts `unknown` — a query error is `unknown` at
// the boundary and half of them are not `ApiHttpError` at all.
// ─────────────────────────────────────────────────────────────────────────────

import { ApiHttpError } from "./api/core";
import { isPlanGateError } from "./planGate";

export type ApiFailureKind =
  /** 401 — no valid session reached the API. May still be the cold-auth race. */
  | "auth_expired"
  /** 403 carrying a plan-gate code. The feature exists; this plan lacks it. */
  | "plan_gate"
  /** 403 otherwise — a real permission boundary. */
  | "forbidden"
  /** 404 — it is not there. Deterministic, and not a malfunction. */
  | "not_found"
  /** 429 — too many requests. The one 4xx that clears by itself. */
  | "rate_limited"
  /** 409 — a state conflict. Someone or something moved first. */
  | "conflict"
  /** Any other 4xx — we asked wrongly; asking again identically will fail again. */
  | "invalid"
  /** 5xx — their side. Waiting plausibly helps. */
  | "server"
  /** The request did not complete: timeout, DNS, offline, aborted. */
  | "unreachable";

export interface ApiFailure {
  kind: ApiFailureKind;
  /** The HTTP status, or null when no response arrived at all. */
  status: number | null;
  /** True when trying the SAME request again could plausibly succeed. */
  retryable: boolean;
  /**
   * How many attempts after the first are worth making. 0 for anything
   * deterministic — a retry the user pays for in latency and learns nothing from.
   */
  maxRetries: number;
  /** The server's requested wait in seconds, when it named one. Null = unknown. */
  retryAfterSeconds: number | null;
}

/**
 * Attempts allowed for a 401 before we stop calling it a race and call it a
 * signed-out session. Matches the policy `/admin` arrived at independently after
 * the 2026-06-16 incident; `authHeader()` also waits up to 5s for Clerk, so by
 * the third failure the token genuinely is not coming.
 */
export const AUTH_RACE_RETRIES = 3;

/** One retry for anything transient-but-unquantified. This is today's behaviour, kept. */
const TRANSIENT_RETRIES = 1;

/** Attempts for a 429. The wait, not the count, is what makes this one work. */
const RATE_LIMIT_RETRIES = 2;

/** Longest we will sit on a server-named wait before giving the user back control. */
export const MAX_HONOURED_WAIT_SECONDS = 120;

/**
 * Flat, short gap between 401 attempts. Three of these is ~1.2s, against the ~7s
 * exponential backoff would cost — and the thing we are waiting for (a Clerk
 * token) either arrives almost immediately or is not coming at all.
 */
export const AUTH_RETRY_DELAY_MS = 400;

/**
 * A timeout from `fetchWithTimeout`, which re-throws as a plain Error by design
 * and so loses the `ApiHttpError` type. Policy treats it the same as a dropped
 * connection — both are "the request did not complete" — but a screen may want
 * to word "the API didn't answer in time" differently from "you appear offline",
 * so the distinction is exported rather than flattened away here.
 */
export function isRequestTimeout(err: unknown): boolean {
  return err instanceof Error && /^Request timed out after \d+ms$/.test(err.message);
}

/** The plan-gate 403 test, run against whichever of body/message carries the code. */
function looksLikePlanGate(err: ApiHttpError): boolean {
  const fromBody =
    err.body && typeof err.body === "object" && "error" in err.body
      ? String((err.body as { error?: unknown }).error)
      : null;
  return isPlanGateError(fromBody) || isPlanGateError(err.message);
}

/**
 * Classify any thrown value from the api layer.
 *
 * Anything that is not an `ApiHttpError` never reached the API — a timeout, an
 * aborted fetch, an offline browser — so it classifies as `unreachable`, which
 * is retryable. That is deliberately the lenient default: mislabelling a network
 * blip as permanent strands a working app, while one extra retry costs a second.
 */
export function classifyApiFailure(err: unknown): ApiFailure {
  if (!(err instanceof ApiHttpError)) {
    return {
      kind: "unreachable",
      status: null,
      retryable: true,
      maxRetries: TRANSIENT_RETRIES,
      retryAfterSeconds: null,
    };
  }

  const status = err.status;
  const retryAfterSeconds = err.retryAfterSeconds;

  if (status === 401) {
    return { kind: "auth_expired", status, retryable: true, maxRetries: AUTH_RACE_RETRIES, retryAfterSeconds };
  }
  if (status === 403) {
    const kind = looksLikePlanGate(err) ? "plan_gate" : "forbidden";
    return { kind, status, retryable: false, maxRetries: 0, retryAfterSeconds };
  }
  if (status === 404) {
    return { kind: "not_found", status, retryable: false, maxRetries: 0, retryAfterSeconds };
  }
  if (status === 408) {
    // A server-side timeout is the request not completing, not a bad request.
    return { kind: "unreachable", status, retryable: true, maxRetries: TRANSIENT_RETRIES, retryAfterSeconds };
  }
  if (status === 409) {
    return { kind: "conflict", status, retryable: false, maxRetries: 0, retryAfterSeconds };
  }
  if (status === 429) {
    return { kind: "rate_limited", status, retryable: true, maxRetries: RATE_LIMIT_RETRIES, retryAfterSeconds };
  }
  if (status >= 500) {
    return { kind: "server", status, retryable: true, maxRetries: TRANSIENT_RETRIES, retryAfterSeconds };
  }
  if (status >= 400) {
    return { kind: "invalid", status, retryable: false, maxRetries: 0, retryAfterSeconds };
  }
  // A non-error status that still threw: treat as unreachable rather than assert.
  return { kind: "unreachable", status, retryable: true, maxRetries: TRANSIENT_RETRIES, retryAfterSeconds };
}

/**
 * Should TanStack Query try again?
 *
 * `failureCount` is the number of retries ALREADY made, so it is 0 the first
 * time this is asked — measured, not assumed: written as `<= maxRetries` this
 * ran a 401 five times instead of four, and the QueryClient test below is what
 * caught it. Keep that test; the predicate alone cannot tell you which way the
 * library counts.
 */
export function shouldRetryApiFailure(failureCount: number, err: unknown): boolean {
  const f = classifyApiFailure(err);
  return f.retryable && failureCount < f.maxRetries;
}

/**
 * How long to wait before the next attempt, in milliseconds.
 *
 * A server-named wait wins outright — that is the whole point of asking. It is
 * capped, because a limiter that asks for an hour must not turn into an hour of
 * a spinner: past the cap the user is better served by an error they can act on.
 * Everything else keeps the exponential backoff TanStack Query would have used.
 */
export function apiRetryDelayMs(attemptIndex: number, err: unknown): number {
  const { kind, retryAfterSeconds } = classifyApiFailure(err);
  if (retryAfterSeconds !== null) {
    return Math.min(retryAfterSeconds, MAX_HONOURED_WAIT_SECONDS) * 1000;
  }
  // A 401 is waiting for a TOKEN, not for a server to recover, so exponential
  // backoff is the wrong curve: three attempts at 1s/2s/4s would make a genuinely
  // signed-out person stare at a spinner for seven seconds before being told to
  // sign in. Clerk resolves in well under a second once it has loaded — poll
  // quickly, give up quickly.
  if (kind === "auth_expired") return AUTH_RETRY_DELAY_MS;
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
}

/**
 * True when the failure means the person needs to sign in again, rather than
 * that anything is broken. Read AFTER retries are exhausted — during the
 * cold-auth race a 401 is not yet this.
 */
export function isSignedOutFailure(err: unknown): boolean {
  return classifyApiFailure(err).kind === "auth_expired";
}
