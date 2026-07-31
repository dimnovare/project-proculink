import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join, relative } from "path";
import {
  PROBLEM_COPY,
  PROBLEM_STATUSES,
  problemFor,
  isDeliveryConfigMissing,
  type ProblemAction,
  type ProblemCtx,
  type ProblemStatus,
} from "../problemCopy";
import { OP_ALLOWED_FROM, opIsAllowedFrom, type ProblemOp } from "../problemActions";
import { ROOT, listAppRoutes, matchesAny, normalizePath, isInternalPageLink } from "@/test/appRoutes";
import { queryKeysOf, unconsumedParams } from "@/test/routeQueryParams";
import { extractLinks, syntaxFor } from "@/test/linkExtract";
import { RETIRED_ROUTES } from "@/lib/retired-routes";

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
    failureCause: null,
    retryAfterSeconds: null,
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

/**
 * Every context shape a panel can be rendered with. `actions()` branches on four of
 * these fields, so walking only the default ctx checks roughly half the controls a
 * real operator can be shown — the config-missing arm of `delivery_failed` and every
 * `supplierId === null` fallback href are only reachable from a variant.
 */
const CTX_VARIANTS: Array<readonly [string, ProblemCtx]> = [
  ["default", ctx()],
  ["supplier not known yet", ctx({ supplierId: null, supplier: "this supplier" })],
  ["delivery config missing", ctx({ serverMessage: "Supplier delivery config is missing." })],
  ["read-only plan", ctx({ readOnly: true })],
  ["at the plan's order limit", ctx({ atOrderLimit: true })],
  ["order processing paused", ctx({ processingPaused: true })],
  // WP-19 — the named delivery causes. Each is its own arm of `delivery_failed`,
  // and the three `settingsFirst` ones re-order the action row, so a walk that
  // stopped at the default ctx would never see the controls an operator actually
  // gets for an expired key or a moved address.
  ["supplier refused our credentials", ctx({ failureCause: "supplier_auth_rejected" })],
  ["supplier refused the account", ctx({ failureCause: "supplier_permission_denied" })],
  ["supplier endpoint is gone", ctx({ failureCause: "supplier_endpoint_not_found" })],
  ["supplier rate limited us", ctx({ failureCause: "supplier_rate_limited", retryAfterSeconds: 120 })],
  ["supplier rate limited us, no wait named", ctx({ failureCause: "supplier_rate_limited" })],
  ["supplier timed out", ctx({ failureCause: "supplier_timeout" })],
  // An API that predates the field, and a cause this build has never heard of:
  // both must fall back to the generic copy rather than render a blank.
  ["a cause we do not recognise", ctx({ failureCause: "supplier_invented_by_the_future" })],
];

/** Every control the eight states can put on a screen, across every ctx variant. */
function everyAction(): Array<{ status: ProblemStatus; variant: string; action: ProblemAction }> {
  return PROBLEM_STATUSES.flatMap((status) =>
    CTX_VARIANTS.flatMap(([variant, c]) =>
      PROBLEM_COPY[status].actions(c).map((action) => ({ status, variant, action })),
    ),
  );
}

describe("no state offers a control the backend will reject", () => {
  test.each(PROBLEM_STATUSES)("%s: every post action is allowed from this status", (status) => {
    for (const [, variant] of CTX_VARIANTS) {
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
    // OrderStatusMachine.TransformableFrom = {ready, transform_failed, rejected_by_supplier}.
    // `rejected_by_supplier` really is in it — OrdersController claims on that set and
    // answers 202 — and `pending_review` really is not. The mirror asserted the
    // opposite of both for the life of the file, and this assertion is what let it:
    // it used to enforce the PRODUCT rule ("we never offer a refused order a button")
    // by writing a false BACKEND fact, which made the mirror unable to catch drift in
    // either direction. The product rule is now asserted below, over PROBLEM_COPY.
    expect([...OP_ALLOWED_FROM.transformOrder].sort()).toEqual(
      ["ready", "rejected_by_supplier", "transform_failed"].sort(),
    );
    // ClaimableForRetryFrom = {ready_to_deliver, delivery_failed}
    expect([...OP_ALLOWED_FROM.retryDelivery].sort()).toEqual(
      ["delivery_failed", "ready_to_deliver"],
    );
    // Dead-letter's rescue is the ops requeue, NOT redeliver — this is D2.
    expect(OP_ALLOWED_FROM.redeliverOrder.has("delivery_dead_letter")).toBe(false);
    expect(OP_ALLOWED_FROM.requeueDelivery.has("delivery_dead_letter")).toBe(true);
    // delivery_held: the release is automatic and every send endpoint 400s while held.
    for (const op of Object.keys(OP_ALLOWED_FROM) as ProblemOp[]) {
      expect(OP_ALLOWED_FROM[op].has("delivery_held")).toBe(false);
    }
  });

  // The product rule the mirror used to carry, stated where it is actually true:
  // over the copy table. A refused order can be re-built by the backend; rebuilding
  // it cannot un-refuse it, so this UI offers no button that tries. `failed` is the
  // same — it holds no parsed order to act on. The old version of this claimed to
  // check both and checked only one.
  test.each(["rejected_by_supplier", "failed"] as const)(
    "%s offers no post action — its way out is a new order, not a retry of this one",
    (status) => {
      const posts = CTX_VARIANTS.flatMap(([variant, c]) =>
        PROBLEM_COPY[status].actions(c)
          .filter((a) => a.kind === "post")
          .map((a) => `[${variant}] ${(a as Extract<ProblemAction, { kind: "post" }>).label}`),
      );
      expect(posts, `${status} offers a post action: ${posts.join(", ")}`).toEqual([]);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The OTHER half of the same rule. The walk above validated `kind: "post"` and
// skipped everything else — but 10 of the 15 controls these eight states put on a
// screen are LINKS, and a link can be just as doomed as a post: `transform_failed`
// shipped a primary CTA to /library/templates, a page FE #47 deleted. It does not
// 404 (a 308 catches it) so the outbound link crawl stays green, and it lands on
// /library/suppliers — a list, with the supplierId dropped — which is the OPPOSITE
// of what the button promised. "Resolves" is not the bar; "is the page that took
// over the job" is.
//
// The crawl in src/test/link-crawl.test.ts cannot cover these two ways over:
//   • it accepts a redirect SOURCE as a live destination (correct for a bookmark,
//     wrong for a button we are shipping today);
//   • it skips any href containing `${`, which is every supplier-scoped href here.
// So the contract owns it, with the hrefs EVALUATED rather than read as text.
// ─────────────────────────────────────────────────────────────────────────────

const APP_ROUTES = listAppRoutes();
const RETIRED_SOURCES = RETIRED_ROUTES.map((r) => r.source);

/** True when `href` lands on a page that exists on this commit — redirects don't count. */
function resolvesToLivePage(href: string): boolean {
  return matchesAny(normalizePath(href), APP_ROUTES);
}

/** The retirement, if this href points at a page that was deleted behind a redirect. */
function retirementFor(href: string) {
  const path = normalizePath(href);
  return RETIRED_ROUTES.find((r) => matchesAny(path, [r.source])) ?? null;
}

describe("no failure state points a control at a page that is gone", () => {
  const links = everyAction().filter(
    (e): e is { status: ProblemStatus; variant: string; action: Extract<ProblemAction, { kind: "link" }> } =>
      e.action.kind === "link",
  );

  // Anti-vacuity floors. If `actions()` is ever refactored into a shape this walk
  // cannot see, the walk goes empty and every assertion below passes trivially —
  // which is exactly how the post-only version of this guard hid three dead links.
  test("the walk actually sees the links it claims to check", () => {
    expect(links.length).toBeGreaterThanOrEqual(30);
    expect(new Set(links.map((l) => l.status)).size).toBeGreaterThanOrEqual(6);
    expect(APP_ROUTES.length).toBeGreaterThan(40);
  });

  test.each(PROBLEM_STATUSES)("%s: every link lands on a page that exists", (status) => {
    const dead = links
      .filter((l) => l.status === status)
      .filter((l) => isInternalPageLink(l.action.href))
      .filter((l) => !resolvesToLivePage(l.action.href))
      .map((l) => {
        const retired = retirementFor(l.action.href);
        return retired
          ? `[${l.variant}] "${l.action.label}" → ${l.action.href} — RETIRED, now 308s to `
            + `${retired.destination}. ${retired.why}`
          : `[${l.variant}] "${l.action.label}" → ${l.action.href} — no such page`;
      });
    expect(dead, `${status} offers a control that goes nowhere useful:\n  ${dead.join("\n  ")}`).toEqual([]);
  });

  test("every link is an in-app page link, not an asset or an API path", () => {
    for (const { status, action } of links) {
      expect(isInternalPageLink(action.href), `${status}: "${action.label}" → ${action.href}`).toBe(true);
    }
  });

  // The panel renders two links of its own — the `us`-tier support link and the
  // outage link on the paused-processing note — which never pass through
  // `actions()`. Read them out of the source so they are covered by the same rule.
  test("the panel's own links resolve too", () => {
    const files = [
      "src/components/bridge/problem/OrderProblemPanel.tsx",
      "src/components/bridge/problem/UnconfirmedResolver.tsx",
    ];
    const found: string[] = [];
    const dead: string[] = [];
    for (const rel of files) {
      const full = join(ROOT, rel);
      for (const href of extractLinks(readFileSync(full, "utf8"), syntaxFor(full))) {
        if (!isInternalPageLink(href)) continue;
        // A template literal is checkable when its PATH is static — "/support?order=${po}"
        // resolves as "/support". Only an interpolated SEGMENT is unknowable here.
        if (normalizePath(href).includes("${")) continue;
        found.push(`${relative(ROOT, full).split("\\").join("/")} → ${href}`);
        if (!resolvesToLivePage(href)) dead.push(`${rel} → ${href}`);
      }
    }
    expect(found.length, "the extractor read no links out of the panel").toBeGreaterThanOrEqual(2);
    expect(dead, `panel links that go nowhere:\n  ${dead.join("\n  ")}`).toEqual([]);
  });

  // Proof the predicate discriminates. Without this the two walks above are one
  // over-permissive helper away from being green on anything at all.
  test("the check rejects a dead target and a retired one — it is not vacuously green", () => {
    expect(resolvesToLivePage("/library/suppliers/sup-1?tab=delivery")).toBe(true);
    // Deliberately NOT `?details=response` any more. That href was this test's
    // positive control while it was the product's worst dead end — the page was
    // live, the parameter was read by nothing, and citing it here taught the next
    // reader that the pair had been checked. `resolvesToLivePage` answers a
    // narrower question than its use here implied; the query half is below.
    expect(resolvesToLivePage("/inbox/ord-1?tab=response")).toBe(true);
    expect(resolvesToLivePage("/totally-dead-route-xyz")).toBe(false);
    // The exact link this test was written for: deleted by FE #47, still 308s.
    expect(resolvesToLivePage("/library/templates?supplierId=sup-1")).toBe(false);
    expect(retirementFor("/library/templates")?.destination).toBe("/library/suppliers");
    expect(matchesAny("/library/templates", RETIRED_SOURCES)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A live PAGE is not a live LINK.
//
// Every route gate in this repo compares hrefs through `appRoutes.normalizePath`,
// which strips `?` before matching. So a control can carry a parameter that
// nothing in the app reads and score green on all of them. Four shipped that way,
// and the worst of them sent a refused order's primary CTA to
// `/inbox/{id}?details=response` — a banner already rendered at that very route,
// so "See their reply" navigated the operator to the screen they were on and
// changed nothing. `src/test/routeQueryParams.ts` carries the contracts and
// verifies each one against the reader's source.
// ─────────────────────────────────────────────────────────────────────────────
describe("no failure state points a control at a parameter nothing reads", () => {
  const links = everyAction().filter(
    (e): e is { status: ProblemStatus; variant: string; action: Extract<ProblemAction, { kind: "link" }> } =>
      e.action.kind === "link",
  );

  // Anti-vacuity. If every href lost its query — or `actions()` changed shape —
  // the walk below has nothing to judge and passes on an empty set.
  test("the walk actually sees query-bearing links", () => {
    const withQuery = links.filter((l) => queryKeysOf(l.action.href).length > 0);
    expect(withQuery.length).toBeGreaterThanOrEqual(10);
    expect(new Set(withQuery.map((l) => l.status)).size).toBeGreaterThanOrEqual(4);
  });

  test.each(PROBLEM_STATUSES)("%s: every parameter it sends is read where it lands", (status) => {
    const inert = links
      .filter((l) => l.status === status)
      .filter((l) => isInternalPageLink(l.action.href))
      .map((l) => ({ l, unread: unconsumedParams(l.action.href) }))
      .filter((e) => e.unread.length > 0)
      .map(
        ({ l, unread }) =>
          `[${l.variant}] "${l.action.label}" → ${l.action.href} — `
          + `${unread.map((p) => `?${p}=`).join(", ")} read by nothing at that route`,
      );
    expect(
      inert,
      `${status} sends a parameter its destination ignores, so the control lands `
        + `somewhere that looks unchanged:\n  ${inert.join("\n  ")}`,
    ).toEqual([]);
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
