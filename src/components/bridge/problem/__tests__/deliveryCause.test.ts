import { describe, test, expect } from "vitest";
import {
  PROBLEM_COPY,
  deliveryCauseFor,
  waitPhrase,
  type ProblemAction,
  type ProblemCtx,
} from "../problemCopy";

// ─────────────────────────────────────────────────────────────────────────────
// WP-19 → WP-24, the seam between the two packets.
//
// The backend has always told 401, 403, 404, 408 and 429 apart on the delivery
// path — SupplierResponseClassification writes a distinct operator sentence for
// each. All five still landed on ONE screen with ONE control: "We couldn't reach
// this supplier" + "Try sending now". For three of the five, clicking that is
// guaranteed to fail identically, because the fix is in the supplier's delivery
// settings and no amount of retrying changes a rotated API key.
//
// So the panel now reads `order.failureCause` — the machine-readable half of the
// classification the backend already computes — and the tests below pin the two
// things that matter: the operator is pointed at the fix, and the product never
// states a wait nobody sent it.
// ─────────────────────────────────────────────────────────────────────────────

function ctx(over: Partial<ProblemCtx> = {}): ProblemCtx {
  return {
    supplier: "BoltWorks BV",
    po: "PO 4091678643",
    supplierId: "sup-1",
    orderId: "ord-1",
    serverMessage: null,
    failureCause: null,
    retryAfterSeconds: null,
    readOnly: false,
    atOrderLimit: false,
    processingPaused: false,
    ...over,
  };
}

const actionsFor = (over: Partial<ProblemCtx> = {}) => PROBLEM_COPY.delivery_failed.actions(ctx(over));
const primary = (over: Partial<ProblemCtx> = {}) => actionsFor(over)[0];
const labels = (over: Partial<ProblemCtx> = {}) => actionsFor(over).map((a) => label(a));

function label(a: ProblemAction): string {
  return a.kind === "link" || a.kind === "post" ? a.label : a.kind;
}

describe("a failure the operator must fix leads with the fix", () => {
  test.each([
    ["supplier_auth_rejected", "credentials"],
    ["supplier_permission_denied", "refused the request"],
    ["supplier_endpoint_not_found", "doesn't exist any more"],
  ] as const)("%s points at the delivery settings first", (cause, attributionFragment) => {
    const over = { failureCause: cause };
    const first = primary(over);

    expect(first.kind).toBe("link");
    expect(label(first)).toBe("Check the delivery settings");
    expect((first as Extract<ProblemAction, { kind: "link" }>).href).toBe(
      "/library/suppliers/sup-1?tab=delivery",
    );
    expect((first as Extract<ProblemAction, { kind: "link" }>).variant).toBe("primary");

    // The retry is still THERE — the path must not vanish — but demoted, because
    // it cannot succeed until the settings change.
    const retry = actionsFor(over).find((a) => a.kind === "post");
    expect(retry).toBeTruthy();
    expect(label(retry!)).toBe("Try sending now");
    expect((retry as Extract<ProblemAction, { kind: "post" }>).variant).toBe("secondary");

    // And the panel says whose problem it is, in plain words.
    expect(PROBLEM_COPY.delivery_failed.attribution(ctx(over))).toContain(attributionFragment);
    // "This is yours to fix" — not "we're on it".
    expect(PROBLEM_COPY.delivery_failed.tier(ctx(over))).toBe("self");
  });

  test("a cause nothing can be done about keeps the retry as the primary", () => {
    for (const cause of ["supplier_rate_limited", "supplier_timeout"]) {
      const over = { failureCause: cause };
      expect(primary(over).kind).toBe("post");
      expect((primary(over) as Extract<ProblemAction, { kind: "post" }>).variant).toBe("primary");
      // Genuinely ours: the backoff queue is already handling it.
      expect(PROBLEM_COPY.delivery_failed.tier(ctx(over))).toBe("wait");
    }
  });
});

describe("the wait is only ever the supplier's own number", () => {
  test("a named wait is stated in words the operator can act on", () => {
    const helper = PROBLEM_COPY.delivery_failed.helper!(
      ctx({ failureCause: "supplier_rate_limited", retryAfterSeconds: 120 }),
    );
    expect(helper).toContain("about 2 minutes");
    expect(helper).toContain("Sending now will most likely be refused again");
  });

  test("no named wait means NO number is shown — not a guessed one", () => {
    const helper = PROBLEM_COPY.delivery_failed.helper!(
      ctx({ failureCause: "supplier_rate_limited", retryAfterSeconds: null }),
    );
    expect(helper).toBeTruthy();
    // The defect this forbids is the same one as "attempt 2 of 3": a number the
    // product invented, presented as something the supplier said.
    expect(helper).not.toMatch(/\d/);
  });

  test("waitPhrase reads as an estimate at both ends of the range", () => {
    expect(waitPhrase(1)).toBe("about 1 second");
    expect(waitPhrase(45)).toBe("about 45 seconds");
    expect(waitPhrase(89)).toBe("about 89 seconds");
    expect(waitPhrase(90)).toBe("about 2 minutes");
    expect(waitPhrase(60)).toBe("about 60 seconds");
    expect(waitPhrase(600)).toBe("about 10 minutes");
    // Never zero, never negative — an instant retry is exactly what the limiter
    // is refusing.
    expect(waitPhrase(0)).toBe("about 1 second");
  });
});

describe("an unknown or absent cause degrades to what shipped before", () => {
  test("no cause at all keeps the generic copy and the generic order", () => {
    expect(deliveryCauseFor(ctx())).toBeNull();
    expect(PROBLEM_COPY.delivery_failed.attribution(ctx())).toBe(
      "BoltWorks BV's system didn't accept the connection. There's nothing wrong with the order itself.",
    );
    expect(labels()).toEqual(["Try sending now", "See every attempt"]);
    expect(PROBLEM_COPY.delivery_failed.tier(ctx())).toBe("wait");
  });

  test("a cause this build has never heard of is not a blank panel", () => {
    // Deploys are not atomic and the backend's cause list will grow. An unknown
    // slug must read as the old generic failure, never as an empty string.
    const over = { failureCause: "supplier_invented_by_the_future" };
    expect(deliveryCauseFor(ctx(over))).toBeNull();
    expect(PROBLEM_COPY.delivery_failed.attribution(ctx(over)).length).toBeGreaterThan(20);
    expect(PROBLEM_COPY.delivery_failed.consequence(ctx(over)).length).toBeGreaterThan(20);
    expect(labels(over)).toEqual(["Try sending now", "See every attempt"]);
  });

  test("the missing-delivery-config cliff still outranks any named cause", () => {
    // Config-missing is decided from the server message and means there is
    // nowhere to send at all — it must win even if a cause is also present.
    const over = {
      serverMessage: "Supplier delivery config is missing.",
      failureCause: "supplier_auth_rejected",
    };
    expect(label(primary(over))).toBe("Set up delivery");
    const retry = actionsFor(over).find((a) => a.kind === "post");
    expect((retry as Extract<ProblemAction, { kind: "post" }>).disabledReason).toBe(
      "This will work once delivery is set up.",
    );
  });
});
