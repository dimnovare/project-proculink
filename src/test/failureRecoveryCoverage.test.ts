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
} from "@/lib/orderStatusManifest";
import { ROOT } from "./appRoutes";

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
//
// 2026-11-13, plan 13b task 8b: the panel walk ("every stopped status has a panel", "what each
// stopped status offers is something that can succeed", "a status with nothing to click says so
// out loud") went with the problem panel it walked — no screen renders it any more. What is left
// is the partition the manifest must keep and the one-copy check below.
// ─────────────────────────────────────────────────────────────────────────────

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
