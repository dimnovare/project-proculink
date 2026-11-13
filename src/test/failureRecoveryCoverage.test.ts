import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  FAILURE_STATUSES,
  ORDER_STATUSES,
  ORDER_STATUS_FACTS,
  PARKED_STATUSES,
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  statusFact,
} from "@/lib/orderStatusManifest";
import { PROBLEM_COPY, problemFor, type ProblemCtx, type ProblemStatus } from "@/components/bridge/problem/problemCopy";
import { ROOT, isInternalPageLink, listAppRoutes, matchesAny, normalizePath } from "./appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// WP-36 — every failure has an obvious action.
//
// THE ACCEPTANCE CRITERION IS THE POINT: "100% of failure statuses covered,
// measured by a test that iterates the machine, not a checklist."
//
// Every existing guard in this repo iterates PROBLEM_STATUSES — the frontend's
// own list of eight. That proves the eight are well-formed and proves nothing
// about a ninth. If the backend adds a failure status tomorrow, PROBLEM_STATUSES
// does not grow, so every `test.each(PROBLEM_STATUSES)` in the suite keeps
// passing while an operator stares at a status with no panel, no action and a
// green dot.
//
// So this file walks `ORDER_STATUS_FACTS` — the manifest of all sixteen statuses
// OrderStatusMachine.Transitions keys, with each one's bucket — and asks of every
// stopped status: does the product give this person something to do, and does the
// thing it offers actually work?
//
// "Actually work" is not a figure of speech here. A post action is checked
// against the backend's ENDPOINT admission guard, not against whether a button
// renders; a link is checked against the routes that exist on this commit. The
// defect this packet inherited was a screen telling an operator to click a button
// the API answers 400 to, so "a control exists" is not the bar.
//
// WHAT THIS FILE CANNOT DO. It cannot read C#. The manifest is a hand-kept copy,
// and `src/test/backendMirror.test.ts` is the half that checks the copy against
// the real source when a backend checkout is reachable. This file checks that
// every status IN the copy is covered — which is the half that runs everywhere.
// ─────────────────────────────────────────────────────────────────────────────

const APP_ROUTES = listAppRoutes();

/**
 * Context variants a problem panel must survive. The status axis below is derived
 * from the manifest; this axis is not, and cannot be — these are the shapes of the
 * world, not a list the backend owns. Kept small on purpose: each one exists
 * because it changes which actions a panel offers.
 */
const CTX_VARIANTS: ReadonlyArray<readonly [string, Partial<ProblemCtx>]> = [
  ["plain", {}],
  ["no supplier id", { supplierId: null }],
  ["processing paused", { processingPaused: true }],
  ["delivery config missing", { serverMessage: "Supplier delivery config is missing." }],
  ["named cause: auth", { failureCause: "supplier_auth_rejected" }],
  ["named cause: rate limit", { failureCause: "supplier_rate_limited", retryAfterSeconds: 120 }],
];

function ctx(over: Partial<ProblemCtx> = {}): ProblemCtx {
  return {
    supplier: "BoltWorks BV",
    po: "PO 4091678643",
    supplierId: "sup-1",
    orderId: "ord-1",
    serverMessage: null,
    failureCause: null,
    retryAfterSeconds: null,
    processingPaused: false,
    ...over,
  };
}

/**
 * A link target exists as a real page on this commit (query string ignored).
 *
 * `matchesAny`, not `includes`: half these routes are dynamic segments
 * (`/inbox/[orderId]`, `/library/suppliers/[id]`), so an exact string compare
 * marks every working deep link dead — and a guard that fires on correct code is
 * one that gets deleted.
 */
function resolvesToLivePage(href: string): boolean {
  return matchesAny(normalizePath(href), APP_ROUTES);
}

describe("the manifest is a partition, so 'every failure' can mean something", () => {
  test("the walk is not empty and covers the whole machine", () => {
    // Without this, a typo emptying ORDER_STATUS_FACTS would turn every
    // test.each below into a green no-op — the exact failure mode this file
    // exists to end.
    expect(ORDER_STATUS_FACTS.length).toBe(16);
    expect(new Set(ORDER_STATUSES).size).toBe(16);
    expect(PROBLEM_BUCKET_STATUSES.length).toBeGreaterThanOrEqual(8);
  });

  test("failure ∪ parked ∪ healthy is exhaustive and disjoint", () => {
    const buckets = ORDER_STATUS_FACTS.map((f) => f.bucket);
    expect(buckets.every((b) => b === "failure" || b === "parked" || b === "healthy")).toBe(true);
    const stopped = new Set(PROBLEM_BUCKET_STATUSES);
    expect(stopped.size).toBe(FAILURE_STATUSES.length + PARKED_STATUSES.length);
    for (const s of FAILURE_STATUSES) expect(PARKED_STATUSES).not.toContain(s);
  });

  test("the failure bucket is exactly OrderStatusConstants.FailureBucket", () => {
    expect([...FAILURE_STATUSES].sort()).toEqual(
      ["delivery_dead_letter", "delivery_failed", "failed", "rejected_by_supplier", "transform_failed"].sort(),
    );
  });

  // 2026-11-13, plan 13b task 7a: "`failed` is the only status the product declares finished" went
  // with DECLARED_TERMINAL, which mirrored OrderStatusMachine.DeclaredTerminal (deleted with the order
  // pipeline).

  test("only pending_parse is marked unreachable, and it is marked", () => {
    const unreachable = ORDER_STATUS_FACTS.filter((f) => !f.reachable).map((f) => f.status);
    expect(unreachable).toEqual(["pending_parse"]);
    expect(REACHABLE_STATUSES).toHaveLength(15);
  });

  test("the OrderStatus union admits every REACHABLE status", () => {
    // The union is fifteen and the machine is sixteen. That difference is allowed
    // to be exactly the unreachable one — any other gap means the API can return a
    // status no `status === "…"` branch in the app is even able to be written for,
    // which is how `delivering` was missing from the union while the API returned it.
    const src = readFileSync(join(ROOT, "src/types/procurement.ts"), "utf8");
    const union = src.slice(src.indexOf("export type OrderStatus"), src.indexOf("export interface OrderLine"));
    const declared = new Set([...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]));
    expect(declared.size).toBeGreaterThanOrEqual(15);
    for (const status of REACHABLE_STATUSES) {
      expect(declared.has(status), `OrderStatus has no "${status}" member`).toBe(true);
    }
  });
});

describe("every stopped status has a panel — derived from the machine, not from PROBLEM_STATUSES", () => {
  test.each(PROBLEM_BUCKET_STATUSES)("%s has a problem-copy entry", (status) => {
    expect(
      problemFor(status),
      `${status} is a ${statusFact(status)?.bucket} status with no PROBLEM_COPY entry — the order screen renders the ordinary mapper, with a Send button, for an order that is stuck`,
    ).not.toBeNull();
  });

  test("and no HEALTHY status has one", () => {
    // The other direction. A panel on a moving order is a gate over a screen that
    // was working — the same defect pointed the other way.
    const healthy = ORDER_STATUS_FACTS.filter((f) => f.bucket === "healthy").map((f) => f.status);
    for (const status of healthy) {
      expect(problemFor(status), `${status} is healthy but PROBLEM_COPY claims it as a problem`).toBeNull();
    }
  });

  test("the two lists are the same list", () => {
    expect([...PROBLEM_BUCKET_STATUSES].sort()).toEqual(Object.keys(PROBLEM_COPY).sort());
  });
});

describe("what each stopped status offers is something that can succeed", () => {
  test.each(PROBLEM_BUCKET_STATUSES)("%s: offers at least one control in every context", (status) => {
    for (const [variant, over] of CTX_VARIANTS) {
      const actions = PROBLEM_COPY[status as ProblemStatus].actions(ctx(over));
      expect(actions.length, `${status} offers nothing at all when ${variant}`).toBeGreaterThan(0);
    }
  });

  // 2026-11-13, plan 13b task 7a: "every POST it offers is admitted by the backend" went with
  // OP_GUARDS — the endpoint guards it mirrored were deleted with OrderStatusMachine.

  test.each(PROBLEM_BUCKET_STATUSES)("%s: every link it offers lands on a page that exists", (status) => {
    for (const [variant, over] of CTX_VARIANTS) {
      for (const action of PROBLEM_COPY[status as ProblemStatus].actions(ctx(over))) {
        if (action.kind !== "link") continue;
        expect(isInternalPageLink(action.href), `${status} (${variant}) links off-app: ${action.href}`).toBe(true);
        expect(
          resolvesToLivePage(action.href),
          `${status} (${variant}) offers "${action.label}" → ${action.href}, which is not a route on this commit`,
        ).toBe(true);
      }
    }
  });

  test("the link walk is not vacuous", () => {
    // If `actions` ever stopped returning links, the assertion above would iterate
    // nothing and pass. Count them.
    const links = PROBLEM_BUCKET_STATUSES.flatMap((s) =>
      CTX_VARIANTS.flatMap(([, over]) => PROBLEM_COPY[s as ProblemStatus].actions(ctx(over)).filter((a) => a.kind === "link")),
    );
    expect(links.length).toBeGreaterThan(30);
    expect(APP_ROUTES.length).toBeGreaterThan(40);
  });

});

describe("a status with nothing to click says so out loud", () => {
  test.each(PROBLEM_BUCKET_STATUSES)("%s: states what happens on its own, either way", (status) => {
    // Silence where "we're retrying" would go reads as "someone is handling it".
    // Exactly one of the two must be present, so neither can be dropped by an edit
    // that assumed the other was there.
    const copy = PROBLEM_COPY[status as ProblemStatus];
    const said = copy.automatic ?? copy.nothingAutomatic;
    expect(said, `${status} says nothing about what happens automatically`).toBeTruthy();
    expect((said ?? "").length).toBeGreaterThan(15);
    expect(
      copy.automatic === null || copy.nothingAutomatic === null,
      `${status} sets BOTH automatic and nothingAutomatic — the panel prints one, so the other is dead copy nobody will re-read`,
    ).toBe(true);
  });

  test.each(PROBLEM_BUCKET_STATUSES)("%s: states the cost of doing nothing", (status) => {
    expect(PROBLEM_COPY[status as ProblemStatus].consequence(ctx()).length).toBeGreaterThan(20);
  });

  test.each(PROBLEM_BUCKET_STATUSES)("%s: a status offering no POST anywhere still routes somewhere", (status) => {
    const everyAction = CTX_VARIANTS.flatMap(([, over]) => PROBLEM_COPY[status as ProblemStatus].actions(ctx(over)));
    // No POST at all, and for five of the eight that is correct rather than a gap:
    //   failed                 the exit is a NEW order row, not a transition on this one
    //   rejected_by_supplier   re-sending refused bytes cannot un-refuse them
    //   delivery_held          the release is automatic; a button would be theatre
    //   unrouted               the recovery is a supplier picker (`slot`), not a POST
    //   delivery_unconfirmed   the recovery is the deliberate-friction resolver
    // What none of them may do is offer nothing. "Honest nothing to do, here is why"
    // still owes a route — to the supplier's settings, to billing, to a new upload.
    expect(
      everyAction.some((a) => a.kind === "link" || a.kind === "slot" || a.kind === "resolver"),
      `${status} offers no POST and no route either — that is a dead end`,
    ).toBe(true);
  });

});

describe("the guard tables are one copy, not nine", () => {
  /**
   * The structural half. Everything above checks behaviour for the statuses the
   * manifest already knows; this checks that a NEW hand-written status list cannot
   * quietly appear beside it, which is how there came to be nine.
   *
   * A source-text check, and therefore a floor rather than a proof — a file can
   * import the manifest and still hard-code a set two lines later. It catches the
   * common case: someone adds a guard set by copying the C# again.
   */
  // 2026-11-13, plan 13b task 7a: MUST_DERIVE, "every op guard names the C# symbol and site it
  // mirrors" and "delivery_held is admitted by no send endpoint" went with OP_GUARDS. Its last
  // entry, problemActions.ts, no longer derives from the manifest because there is no backend
  // guard left to derive (see the note on OP_ALLOWED_FROM); CommandPalette left the list earlier
  // the same day when its order rows went with the order screens.

  /**
   * A recovery that names its destination in WORDS must name it in the words the
   * product uses, or the next step is unreachable in practice.
   *
   * `useSendFlow`'s in-flight notice is plain text — `setFlow` takes a string and
   * the workshop renders it into a div, so there is no link to click. It therefore
   * says "Open System status" and "the Deliveries page", and the command palette
   * is how an operator turns those words into a page. The palette called the same
   * two pages "System health" and "Delivery log", so searching the exact words the
   * product had just told them to look for returned nothing.
   *
   * `breadcrumb.ts`'s segment labels are the source of truth — they are what the
   * operator reads at the top of the page they land on, so a palette entry that
   * disagrees is wrong by definition.
   */
  test("a page a recovery notice names in words is findable by those words", () => {
    const crumbs = readFileSync(join(ROOT, "src/components/bridge/breadcrumb.ts"), "utf8");
    const palette = readFileSync(join(ROOT, "src/components/bridge/CommandPalette.tsx"), "utf8");

    for (const segment of ["log"]) {
      const canonical = new RegExp(`^\\s*${segment}:\\s*"([^"]+)"`, "m").exec(crumbs)?.[1];
      expect(canonical, `breadcrumb.ts has no label for the "${segment}" segment`).toBeTruthy();
      // The palette entry that routes to this page must carry that exact label.
      const entry = new RegExp(`label:\\s*"([^"]+)",[^\\n]*?/operations/${segment}"`).exec(palette)?.[1];
      expect(entry, `no command-palette entry routes to /operations/${segment}`).toBeTruthy();
      expect(
        entry,
        `the palette calls /operations/${segment} "${entry}" while the page itself calls it "${canonical}" — an operator searching the name they were told will not find it`,
      ).toBe(canonical);
    }
  });

  // 2026-11-13, plan 13b task 7a: "the resolve deny-list and the terminal declaration do not
  // overlap" went with RESOLVE_HELD_FROM and DECLARED_TERMINAL (OrderStatusMachine, deleted).
});
