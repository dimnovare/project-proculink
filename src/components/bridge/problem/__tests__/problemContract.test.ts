import { describe, test, expect } from "vitest";
import {
  PROBLEM_COPY,
  PROBLEM_STATUSES,
  problemFor,
  isDeliveryConfigMissing,
  type ProblemCtx,
  type ProblemStatus,
} from "../problemCopy";
import { OP_ALLOWED_FROM, opIsAllowedFrom, type ProblemOp } from "../problemActions";

// ─────────────────────────────────────────────────────────────────────────────
// The contract, tested structurally rather than by eyeballing eight panels.
//
// The one rule that would have caught D2 on the day it shipped: no state may
// offer a post action the backend's guard set rejects from that state. It is a
// table-vs-table comparison, so it holds for states nobody has re-read since.
// ─────────────────────────────────────────────────────────────────────────────

function ctx(over: Partial<ProblemCtx> = {}): ProblemCtx {
  return {
    supplier: "BoltWorks BV",
    po: "PO 4091678643",
    supplierId: "sup-1",
    orderId: "ord-1",
    serverMessage: null,
    readOnly: false,
    atOrderLimit: false,
    processingPaused: false,
    ...over,
  };
}

describe("every problem status the backend can produce has copy", () => {
  test("all eight are covered, and nothing else is", () => {
    expect([...PROBLEM_STATUSES].sort()).toEqual(
      [
        "delivery_dead_letter",
        "delivery_failed",
        "delivery_held",
        "delivery_unconfirmed",
        "failed",
        "rejected_by_supplier",
        "transform_failed",
        "unrouted",
      ].sort(),
    );
    for (const s of PROBLEM_STATUSES) expect(PROBLEM_COPY[s]).toBeTruthy();
  });

  test("problemFor answers null for healthy statuses — it is the send gate", () => {
    for (const ok of ["pending_review", "ready", "ready_to_deliver", "delivering", "delivered", "parsing"]) {
      expect(problemFor(ok)).toBeNull();
    }
    for (const bad of PROBLEM_STATUSES) expect(problemFor(bad)).not.toBeNull();
  });
});

describe("no state offers a control the backend will reject", () => {
  test.each(PROBLEM_STATUSES)("%s: every post action is allowed from this status", (status) => {
    for (const variant of [ctx(), ctx({ serverMessage: "Supplier delivery config is missing." })]) {
      for (const a of PROBLEM_COPY[status].actions(variant)) {
        if (a.kind !== "post") continue;
        expect(
          opIsAllowedFrom(a.op, status),
          `${status} offers "${a.label}" → ${a.op}, which the backend rejects from ${status}`,
        ).toBe(true);
      }
    }
  });

  test("the guard mirror itself matches the backend's sets", () => {
    // OrderStatusMachine.RedeliverableFrom = {delivery_failed, ready_to_deliver, delivery_unconfirmed}
    expect([...OP_ALLOWED_FROM.redeliverOrder].sort()).toEqual(
      ["delivery_failed", "delivery_unconfirmed", "ready_to_deliver"],
    );
    // Dead-letter's rescue is the ops requeue, NOT redeliver — this is D2.
    expect(OP_ALLOWED_FROM.redeliverOrder.has("delivery_dead_letter")).toBe(false);
    expect(OP_ALLOWED_FROM.requeueDelivery.has("delivery_dead_letter")).toBe(true);
    // rejected_by_supplier and failed are terminal — nothing may be posted.
    for (const op of Object.keys(OP_ALLOWED_FROM) as ProblemOp[]) {
      expect(OP_ALLOWED_FROM[op].has("rejected_by_supplier")).toBe(false);
    }
  });
});

describe("silence is never allowed to read as 'it's being handled'", () => {
  test.each(PROBLEM_STATUSES)("%s: says what happens automatically, either way", (status) => {
    const copy = PROBLEM_COPY[status];
    const line = copy.automatic ?? copy.nothingAutomatic;
    expect(line, `${status} says nothing about what happens on its own`).toBeTruthy();
    expect(line!.length).toBeGreaterThan(15);
  });

  test.each(PROBLEM_STATUSES)("%s: states the cost of doing nothing", (status) => {
    expect(PROBLEM_COPY[status].consequence(ctx()).length).toBeGreaterThan(20);
  });

  test.each(PROBLEM_STATUSES)("%s: offers at least one route out", (status) => {
    expect(PROBLEM_COPY[status].actions(ctx()).length).toBeGreaterThan(0);
  });
});

describe("gate or banner — only a state with nothing underneath replaces the page", () => {
  test("failed is the only gate", () => {
    const gates = PROBLEM_STATUSES.filter((s) => PROBLEM_COPY[s].presentation === "gate");
    expect(gates).toEqual(["failed"]);
  });
});

describe("vocabulary", () => {
  const BANNED = [
    /dead[\s-]?letter/i,
    /\btransform\b/i,
    /\bcrossing\b/i,
    /\bspine\b/i,
    /\bdock\b/i,
    /\blane\b/i,
    /\bunrouted\b/i,
    /\bwebhook payload\b/i,
  ];

  test.each(PROBLEM_STATUSES)("%s: no engine vocabulary in anything a user reads", (status) => {
    const c = PROBLEM_COPY[status];
    const strings = [
      c.headline,
      c.badge,
      c.attribution(ctx()),
      c.automatic ?? "",
      c.nothingAutomatic ?? "",
      c.consequence(ctx()),
      c.helper?.(ctx()) ?? "",
      c.rowAction,
      ...c.actions(ctx()).map((a) => ("label" in a ? a.label : "")),
    ];
    for (const s of strings) {
      for (const banned of BANNED) {
        expect(banned.test(s), `"${s}" contains banned vocabulary ${banned}`).toBe(false);
      }
    }
  });

  test("the inbox row action stays inside its 22-character budget", () => {
    for (const s of PROBLEM_STATUSES) {
      expect(PROBLEM_COPY[s].rowAction.length, `${s}: "${PROBLEM_COPY[s].rowAction}"`).toBeLessThanOrEqual(22);
    }
  });
});

describe("the config-missing cliff is still recognised", () => {
  test("matches the backend's message and close variants", () => {
    expect(
      isDeliveryConfigMissing("Supplier delivery config is missing. Add a delivery endpoint before sending this order."),
    ).toBe(true);
    expect(isDeliveryConfigMissing("missing delivery configuration")).toBe(true);
    expect(isDeliveryConfigMissing("Connection reset by peer")).toBe(false);
    expect(isDeliveryConfigMissing(null)).toBe(false);
  });

  test("it flips delivery_failed from 'wait' to 'you can fix this'", () => {
    const copy = PROBLEM_COPY.delivery_failed;
    expect(copy.tier(ctx())).toBe("wait");
    expect(copy.tier(ctx({ serverMessage: "Supplier delivery config is missing." }))).toBe("self");
  });

  test("and disables the retry rather than hiding it", () => {
    const actions = PROBLEM_COPY.delivery_failed.actions(
      ctx({ serverMessage: "Supplier delivery config is missing." }),
    );
    const retry = actions.find((a) => a.kind === "post" && a.op === "retryDelivery");
    expect(retry).toBeTruthy();
    expect(retry!.kind === "post" && retry!.disabledReason).toBeTruthy();
  });
});

describe("read-only plans and the order limit never hide the explanation", () => {
  test("a read-only plan disables posts but keeps every link live", () => {
    for (const s of PROBLEM_STATUSES) {
      const actions = PROBLEM_COPY[s].actions(ctx({ readOnly: true }));
      for (const a of actions) {
        if (a.kind === "post") expect(a.disabledReason, `${s}/${a.label}`).toBeTruthy();
      }
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  test("a retry is still allowed at the plan's order limit — it consumes nothing new", () => {
    const actions = PROBLEM_COPY.delivery_failed.actions(ctx({ atOrderLimit: true }));
    const retry = actions.find((a) => a.kind === "post" && a.op === "retryDelivery");
    expect(retry!.kind === "post" && retry!.disabledReason).toBeFalsy();
  });
});

describe("the Worker outage is reachable from the panel (D9)", () => {
  test("a paused pipeline suffixes the automatic line instead of a separate strip", () => {
    for (const s of PROBLEM_STATUSES) {
      const paused = PROBLEM_COPY[s].automaticFor?.(ctx({ processingPaused: true })) ?? "";
      expect(paused, s).toMatch(/paused/i);
    }
  });
});

describe("tiers", () => {
  test("failed starts at us — a file the parser rejected is not a coordinator's bug", () => {
    expect(PROBLEM_COPY.failed.tier(ctx())).toBe("us");
  });

  test("every other state starts self-serve or waiting", () => {
    const tiers = PROBLEM_STATUSES.filter((s) => s !== "failed").map((s: ProblemStatus) =>
      PROBLEM_COPY[s].tier(ctx()),
    );
    expect(tiers).not.toContain("us");
  });
});
