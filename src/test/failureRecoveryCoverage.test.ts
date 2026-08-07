import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DECLARED_TERMINAL,
  FAILURE_STATUSES,
  OP_GUARDS,
  ORDER_STATUSES,
  ORDER_STATUS_FACTS,
  PARKED_STATUSES,
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  RESOLVE_HELD_FROM,
  opAllowsStatus,
  statusFact,
  type OrderOp,
} from "@/lib/orderStatusManifest";
import { PROBLEM_COPY, problemFor, type ProblemCtx, type ProblemStatus } from "@/components/bridge/problem/problemCopy";
import { orderGlyphColor } from "@/components/bridge/CommandPalette";
import { neededForOrder } from "@/components/bridge/BridgeDashboard";
import { notifKindFor } from "@/components/bridge/BridgeTopbar";
import { rowNextStep } from "@/components/bridge/InboxView";
import { STATUS_LABELS } from "@/components/bridge/UnifiedStatusBadge";
import { ROOT, isInternalPageLink, listAppRoutes, matchesAny, normalizePath } from "./appRoutes";
import { stripComments, syntaxFor } from "./sourceScan";

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
  ["read-only plan", { readOnly: true }],
  ["at order limit", { atOrderLimit: true }],
  ["processing paused", { processingPaused: true }],
  ["delivery config missing", { serverMessage: "Supplier delivery config is missing." }],
  ["named cause: auth", { failureCause: "supplier_auth_rejected" }],
  ["named cause: rate limit", { failureCause: "supplier_rate_limited", retryAfterSeconds: 120 }],
  // A transform failure has no machine-readable cause, so its arms are selected by
  // the message (BE #172). These two each replace the panel's primary control, so
  // without them this walk checks a route no operator with unconfirmed item codes
  // or a rules refusal is ever offered.
  ["lines waiting for an item code", { serverMessage: "Resolve all lines before transforming. Unresolved: 1, 3." }],
  [
    "the supplier's rules refused it",
    { serverMessage: "This order wasn't sent because it doesn't meet what the supplier accepts." },
  ],
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
    readOnly: false,
    atOrderLimit: false,
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

  test("`failed` is the only status the product declares finished", () => {
    // Declared, never derived. Deriving terminality from an empty edge set is how
    // rejected_by_supplier became a dead end no control in the product could move.
    expect(DECLARED_TERMINAL).toEqual(["failed"]);
  });

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

  test.each(PROBLEM_BUCKET_STATUSES)("%s: every POST it offers is admitted by the backend from this status", (status) => {
    for (const [variant, over] of CTX_VARIANTS) {
      for (const action of PROBLEM_COPY[status as ProblemStatus].actions(ctx(over))) {
        if (action.kind !== "post") continue;
        expect(
          opAllowsStatus(action.op as OrderOp, status),
          `${status} (${variant}) offers "${action.label}" → ${action.op}, but ${OP_GUARDS[action.op as OrderOp].backendSymbol} does not admit ${status}. That control can only answer 400.`,
        ).toBe(true);
      }
    }
  });

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

  test("the post walk is not vacuous", () => {
    const posts = PROBLEM_BUCKET_STATUSES.flatMap((s) =>
      CTX_VARIANTS.flatMap(([, over]) => PROBLEM_COPY[s as ProblemStatus].actions(ctx(over)).filter((a) => a.kind === "post")),
    );
    expect(posts.length).toBeGreaterThan(10);
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
    if (everyAction.some((a) => a.kind === "post")) return; // has a real recovery — covered above
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

  test("the no-POST branch is reached (the check is not vacuous)", () => {
    // Pinned as an exact set, so a status GAINING or LOSING its only post action is
    // a deliberate edit here rather than a silent change of what the screen offers.
    const withoutPosts = PROBLEM_BUCKET_STATUSES.filter(
      (s) => !CTX_VARIANTS.flatMap(([, over]) => PROBLEM_COPY[s as ProblemStatus].actions(ctx(over))).some((a) => a.kind === "post"),
    );
    expect(withoutPosts.sort()).toEqual(
      ["delivery_held", "delivery_unconfirmed", "failed", "rejected_by_supplier", "unrouted"].sort(),
    );
  });
});

describe("the other screens do not paint a stopped order as a healthy one", () => {
  const SUCCESS_GREEN = "#2E8E3A";

  test.each(PROBLEM_BUCKET_STATUSES)("%s: the command palette does not colour it as success", (status) => {
    // The chain this replaced ended `return "#2E8E3A"` for everything it had not
    // named, so a supplier-refused order read the same green as a delivered one in
    // the palette an operator opens to find it.
    expect(
      orderGlyphColor(status as never),
      `${status} paints the success colour in cmd-K`,
    ).not.toBe(SUCCESS_GREEN);
  });

  test("a healthy status still does read as success (the check is not inverted)", () => {
    expect(orderGlyphColor("delivered" as never)).toBe(SUCCESS_GREEN);
    expect(orderGlyphColor("ready" as never)).toBe(SUCCESS_GREEN);
  });

  test.each(PROBLEM_BUCKET_STATUSES)("%s: the dashboard's 'Needs you' line names a next step, not the state", (status) => {
    const line = neededForOrder({ status: status as never, unresolvedCount: 0 });
    const label = STATUS_LABELS[status];
    expect(line.startsWith(label), `${status}: "${line}" does not open with the registry label`).toBe(true);
    expect(
      line.length > label.length,
      `${status} renders as the bare status name "${line}" in a section titled "Needs you" — it names the state instead of the next step`,
    ).toBe(true);
    // And the second half must be the SAME sentence the order screen and the inbox
    // row use. This is the assertion that would have caught the dashboard telling
    // an operator to "try sending again" while the order screen said the retry was
    // already running and they need not act.
    expect(line.toLowerCase()).toContain(PROBLEM_COPY[status as ProblemStatus].rowAction.toLowerCase());
  });

  test.each(PROBLEM_BUCKET_STATUSES)("%s: the inbox row names the next step, not a count", (status) => {
    // `rowAction` is documented as "the inbox row's second line", its 22-character
    // budget is pinned by a test that names this screen, the order screen renders
    // it and the dashboard reads it — and the inbox, the surface it is named
    // after, printed "12 lines" for every state until now.
    const next = rowNextStep(status);
    expect(next, `${status} rows print a line count where the next step belongs`).not.toBeNull();
    // Repeated from the registry, never re-phrased here — which is what stops the
    // row, the panel and the dashboard describing one stopped order three ways.
    expect(next!.text).toBe(PROBLEM_COPY[status as ProblemStatus].rowAction);
    // `--amber`, not `--amber-text`, is 3.65:1 on this background and fails AA at
    // 11px. The distinction is invisible in review and measurable here.
    expect(next!.color).toBe(
      statusFact(status)?.bucket === "failure" ? "var(--danger)" : "var(--amber-text)",
    );
  });

  test("a healthy row keeps its count line", () => {
    // Not inverted: on a moving order the line count IS the useful fact, and there
    // is no action to name. A next-step line on every row is noise, not help.
    for (const status of ["parsing", "pending_review", "ready", "delivered"]) {
      expect(rowNextStep(status), `${status} rows lost their count line`).toBeNull();
    }
  });

  test.each(PROBLEM_BUCKET_STATUSES)("%s: the notification bell classifies it", (status) => {
    // A stopped order that earns no `NotifKind` is dropped by the bell's filter
    // entirely — not shown quietly, not shown greyed, absent. `unrouted` was, for
    // as long as the bell existed, while two sibling parked states had already been
    // rescued from exactly that with the reasoning written directly above it.
    expect(
      notifKindFor(status, 0),
      `${status} earns no notification kind, so the bell drops the row and the operator is never told`,
    ).not.toBeNull();
    // And unresolved lines must not relabel a stopped order as "Needs review" —
    // that names the wrong problem and hides the one that stopped it.
    if (status !== "pending_review") {
      expect(notifKindFor(status, 4), `${status} is masked by unresolvedCount`).not.toBe("review");
    }
  });

  test("the bell still ignores an order that is simply moving", () => {
    // Not inverted: a healthy in-flight order must NOT notify, or the bell becomes
    // a feed of every order in the workspace and stops meaning anything.
    for (const status of ["parsing", "transforming", "ready_to_deliver", "delivering"]) {
      expect(notifKindFor(status, 0), `${status} notifies, but nothing is wrong with it`).toBeNull();
    }
  });

  test("a healthy status keeps its own line rather than being forced into the shape", () => {
    expect(neededForOrder({ status: "pending_review" as never, unresolvedCount: 3 })).toBe("3 item codes to confirm");
    expect(neededForOrder({ status: "pending_review" as never, unresolvedCount: 0 })).toBe("Review before sending");
    expect(neededForOrder({ status: "delivered" as never, unresolvedCount: 0 })).toBe(STATUS_LABELS.delivered);
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
  const MUST_DERIVE = [
    "src/components/bridge/problem/problemActions.ts",
    "src/components/bridge/CommandPalette.tsx",
    "src/app/(app)/operations/health/page.tsx",
  ];

  test.each(MUST_DERIVE)("%s reads the status manifest instead of retyping it", (rel) => {
    const code = stripComments(readFileSync(join(ROOT, rel), "utf8"), syntaxFor(rel));
    expect(/from\s+["']@\/lib\/orderStatusManifest["']/.test(code)).toBe(true);
  });

  test("the ops requeue control is gated on the requeue guard, by name", () => {
    // The one control in this packet whose behaviour no render test reaches: it
    // lives in a Next.js `page.tsx`, which may not carry arbitrary named exports,
    // so the function cannot be imported and called. A structural check is
    // therefore the floor available — but "imports the manifest" is too weak on
    // its own (a file can import it and still hand-roll the guard two lines down),
    // so this asserts the CALL, with its op argument. The behaviour behind that
    // call is covered by the OP_GUARDS assertions above and by the C# diff in
    // src/test/backendMirror.test.ts.
    const rel = "src/app/(app)/operations/health/page.tsx";
    const code = stripComments(readFileSync(join(ROOT, rel), "utf8"), syntaxFor(rel));
    expect(/opAllowsStatus\(\s*["']requeueDelivery["']/.test(code)).toBe(true);
  });

  test("the dashboard's action line reads the problem registry", () => {
    const rel = "src/components/bridge/BridgeDashboard.tsx";
    const code = stripComments(readFileSync(join(ROOT, rel), "utf8"), syntaxFor(rel));
    expect(/problemFor\s*\(/.test(code)).toBe(true);
  });

  test("every op guard names the C# symbol and site it mirrors", () => {
    for (const [op, guard] of Object.entries(OP_GUARDS)) {
      expect(guard.allowedFrom.length, `${op} admits nothing`).toBeGreaterThan(0);
      expect(guard.backendSymbol.length, `${op} cites no backend symbol`).toBeGreaterThan(0);
      expect(guard.backendSite, `${op} cites no file:line`).toMatch(/^ProcuLink\.[A-Za-z.]+\/.+\.cs:\d+$/);
      // A guard may only admit statuses the machine knows. A typo'd status here is
      // a control that renders for nothing and hides for the real one.
      for (const status of guard.allowedFrom) {
        expect(ORDER_STATUSES, `${op} admits "${status}", which is not a status`).toContain(status);
      }
    }
  });

  test("delivery_held is admitted by no send endpoint", () => {
    // The release is automatic when billing settles and every send endpoint answers
    // 400 while held, so a control here would be theatre. Asserted rather than
    // commented, because "we deliberately left it out" and "we forgot" look identical.
    for (const [op, guard] of Object.entries(OP_GUARDS)) {
      expect(guard.allowedFrom, `${op} claims to admit delivery_held`).not.toContain("delivery_held");
    }
  });

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

    for (const segment of ["health", "log"]) {
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

  test("the send-flow notice names pages that exist and that the palette can reach", () => {
    // The other half: the words in the notice must BE those canonical names. A
    // guard on the palette alone would pass while the notice invented a third name.
    const notice = readFileSync(join(ROOT, "src/components/bridge/review/hooks/useSendFlow.ts"), "utf8");
    const crumbs = readFileSync(join(ROOT, "src/components/bridge/breadcrumb.ts"), "utf8");
    const body = notice.slice(notice.indexOf("function stillRunningNotice"));
    expect(body.length, "stillRunningNotice is gone — this guard is checking nothing").toBeGreaterThan(200);
    for (const segment of ["health", "log"]) {
      const canonical = new RegExp(`^\\s*${segment}:\\s*"([^"]+)"`, "m").exec(crumbs)?.[1] ?? "";
      expect(
        body.includes(canonical),
        `the in-flight notice never names "${canonical}", so its next step is a page the operator has to guess at`,
      ).toBe(true);
    }
  });

  test("the resolve deny-list and the terminal declaration do not overlap", () => {
    // The backend pins the same thing (ResolveHeldFrom_AndDeclaredTerminal_AreDisjoint):
    // a 409 hold is TEMPORARY and the 400 on a finished order is PERMANENT, so a
    // status in both would make a retryable refusal indistinguishable from a dead end.
    for (const status of RESOLVE_HELD_FROM) {
      expect(DECLARED_TERMINAL).not.toContain(status);
      expect(ORDER_STATUSES).toContain(status);
    }
    expect(RESOLVE_HELD_FROM).toHaveLength(4);
  });
});
