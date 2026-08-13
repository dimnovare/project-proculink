// Reading a delivery connection test the way the operator has to act on it.
//
// The API answers with `DeliveryTestResult { success, errorMessage?, responseCode? }` and the
// editor used to render exactly two outcomes: a green box or a red one. A rejected sign-in, a
// hostname that does not resolve, and a path that is not there all produced the same red box
// with whatever sentence the backend happened to send — three different jobs (fix the
// credential / fix the address / fix the path) presented as one.
//
// The distinction is not invented; it is already in the answer. `responseCode` is the HTTP status
// the supplier's server returned, so a NULL code means no HTTP response arrived at all — the
// request never got far enough to be refused. That single fact separates "we could not reach
// them" from "they answered and said no", which is the split that decides what to go and fix.
//
// Everything here is derived. Nothing claims to know why a request failed beyond what the status
// code supports, and the backend's own sentence is always shown alongside, never replaced.

export type DeliveryTestTone = "pass" | "unreachable" | "refused" | "rejected" | "their-side";

export interface DeliveryTestOutcome {
  tone: DeliveryTestTone;
  /** Headline: what happened, in the operator's terms. */
  title: string;
  /** What to check next. Empty for a pass — the honesty note carries that state instead. */
  guidance: string;
}

export interface DescribeTestArgs {
  success: boolean;
  responseCode?: number | null;
}

export function describeDeliveryTestOutcome({
  success,
  responseCode,
}: DescribeTestArgs): DeliveryTestOutcome {
  if (success) {
    return {
      tone: "pass",
      title: "The supplier's system answered",
      guidance: "",
    };
  }

  // No HTTP status came back, so nothing at the other end ever replied. The address itself is
  // the thing to check: hostname, port, and whether the server is reachable from outside.
  if (responseCode == null) {
    return {
      tone: "unreachable",
      title: "We could not reach the supplier's system",
      guidance:
        "Nothing answered at that address, so this is not a sign-in problem. Check the address " +
        "for a typo, confirm the supplier expects traffic from us, and check whether the request " +
        "ran out of time before a reply arrived.",
    };
  }

  if (responseCode === 401 || responseCode === 403) {
    return {
      tone: "refused",
      title: `They answered and refused the sign-in (${responseCode})`,
      guidance:
        "The address is right and their system is up — it did not accept our credentials. Check " +
        "the auth type, and re-enter the credential the supplier issued. For an API key, confirm " +
        "the header name matches the one they asked for.",
    };
  }

  if (responseCode === 404 || responseCode === 405) {
    return {
      tone: "rejected",
      title: `They answered, but not at that address (${responseCode})`,
      guidance:
        "Their system is up and accepted the connection, then said nothing is there to receive " +
        "orders. Check the path at the end of the address, and the request method.",
    };
  }

  if (responseCode === 408 || responseCode === 429 || responseCode >= 500) {
    return {
      tone: "their-side",
      title: `Their system reported a problem on its side (${responseCode})`,
      guidance:
        "Nothing here needs changing yet. This is usually temporary — try again shortly, and " +
        "tell the supplier if it keeps happening.",
    };
  }

  return {
    tone: "rejected",
    title: `They answered and rejected the request (${responseCode})`,
    guidance:
      "Their system is reachable and accepted our sign-in, then turned the order down. The " +
      "reason they gave is below — it usually points at the output format or a field they " +
      "require.",
  };
}
