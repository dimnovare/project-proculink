// orderStatusManifest — the ONE place the frontend writes down what the backend's
// order-status machine says, and the only list any coverage test is allowed to walk.
//
// WHY THIS FILE EXISTS
//
// WP-36's acceptance criterion is "100% of failure statuses covered, measured by a
// test that iterates the machine, not a checklist". Before this file there was no
// machine to iterate — there were NINE checklists, each a hand-typed copy of a
// different slice of the same C# constants, each with a comment naming the symbol
// it mirrored, and none of them checked against another:
//
//   src/test/statusVocabulary.test.ts        BACKEND_STATUSES (16)
//   src/types/procurement.ts                 OrderStatus union (15 — pending_parse missing)
//   src/components/bridge/problem/problemActions.ts   OP_ALLOWED_FROM (5 sets)
//   src/components/bridge/orderCountContract.ts       FAILED_BUCKET (5)          ← derived
//   src/components/bridge/inboxSend.ts       REDELIVERABLE_/BULK_SELECTABLE_/ROW_SENDABLE
//   src/components/bridge/inboxUrlFilter.ts  INBOX_FILTERABLE_STATUSES (15)
//   src/components/bridge/BridgeDashboard.tsx         FAILED_/EXCEPTION_         ← derived
//   src/components/bridge/BridgeDashboard.tsx         EXCEPTION_ROW_ (mirrors a
//                                            DIFFERENT backend set — OrderExceptionService
//                                            .ProblemFor — so it is not derived from here)
//   src/components/bridge/StatusJourney.tsx  FAILURE_JOURNEY_STAGE (5)
//   src/app/(app)/operations/health/healthTiles.ts    TILES
//
// `← derived` marks a copy that has since been collapsed into this file. Those were not
// collapsed as tidying: BridgeDashboard's FAILED_ set omitted `rejected_by_supplier`, so a
// supplier that had refused every order scored 100% and the topology painted its port
// green, while the wire to it went amber off the EXCEPTION_ set in the same file, which
// did contain the status. Two hand-typed lists, one screen, opposite verdicts.
//
// A hand-copy with a citation is prose. It goes stale silently, and one already had:
// `OP_ALLOWED_FROM.retryDelivery` named `ClaimableForRetryFrom` — the Worker's
// INTERNAL claim set — where the endpoint's admission guard is `RetryableFrom`, a
// strictly smaller set. The test that existed to catch mirror drift asserted the
// wrong membership as if it were the contract, so both the mirror and its guard
// were wrong together and green.
//
// This file does not fix "the frontend cannot import C#". Nothing frontend-side can.
// What it fixes is that there is now exactly ONE copy to keep true, every entry
// carries the C# symbol and file it mirrors, and `src/test/backendMirror.test.ts`
// diffs it against the real C# source whenever a backend checkout is reachable —
// so the copy is checkable rather than merely annotated.
//
// PROVENANCE — backend repo ProcuLink @ main 7aa830a, read 2026-08-01:
//   ProcuLink.Core/Constants/OrderStatusConstants.cs   the 16 status constants + FailureBucket
//   ProcuLink.Core/Constants/OrderStatusMachine.cs     Transitions, DeclaredTerminal, and the
//                                                      named per-operation guard sets
//   ProcuLink.Api/Controllers/OrdersController.cs      six endpoint admission guards
//   ProcuLink.Api/Controllers/OpsController.cs         the requeue admission guard

/**
 * How the product treats a status, and therefore what the screens owe it.
 *
 * The three buckets are exhaustive and disjoint over ORDER_STATUSES. That is the
 * property the coverage test leans on: a status added to this file lands in a
 * bucket, and its bucket decides which assertions it must satisfy.
 *
 *  healthy  the order is moving, or has arrived. Nothing is owed beyond a label.
 *  failure  something broke. OrderStatusConstants.FailureBucket exactly.
 *  parked   nothing broke, but the order stopped and only a person can restart it.
 *           Deliberately NOT part of the backend's FailureBucket (its own doc says
 *           delivery_unconfirmed and delivery_held are "deliberately absent"), and
 *           deliberately owed the same duty as a failure by this frontend: an
 *           operator cannot tell "stuck because it broke" from "stuck because it is
 *           waiting for me" by how badly it is going, only by what they must do.
 */
export type StatusBucket = "healthy" | "failure" | "parked";

export interface OrderStatusFact {
  /** The raw string the API sends. */
  status: string;
  bucket: StatusBucket;
  /**
   * False when no production writer can put an order in this status. The ONE
   * member is `pending_parse`: OrderStatusMachine.cs:44-46 records that all four
   * PurchaseOrderEntity construction sites override the C# default, so no order is
   * ever in it. Recorded rather than deleted — the constant exists, the API type
   * admits it, and a future writer would make it reachable without telling anyone.
   */
  reachable: boolean;
  /** Why this row reads the way it does. Kept short; the C# doc-comments are the long form. */
  note: string;
}

/**
 * Every key of OrderStatusMachine.Transitions, in the backend's declaration order.
 *
 * Sixteen. `src/types/procurement.ts`'s OrderStatus union has fifteen — it omits
 * `pending_parse` — and `src/test/backendMirror.test.ts` asserts that the only
 * difference between the two is a status this file marks unreachable, so the union
 * cannot quietly drop a status an operator can actually reach.
 */
export const ORDER_STATUS_FACTS: readonly OrderStatusFact[] = [
  {
    status: "pending_parse",
    bucket: "healthy",
    reachable: false,
    note: "Declared but never written — every entity construction site overrides the C# default.",
  },
  { status: "parsing", bucket: "healthy", reachable: true, note: "Reading the file." },
  {
    status: "unrouted",
    bucket: "parked",
    reachable: true,
    note: "Extracted, no supplier resolved. A routing hold, not a failure — and the one problem state whose fix is entirely self-serve.",
  },
  { status: "pending_review", bucket: "healthy", reachable: true, note: "Waiting on a human review that the workshop itself is." },
  { status: "ready", bucket: "healthy", reachable: true, note: "Reviewed, not yet built." },
  { status: "transforming", bucket: "healthy", reachable: true, note: "Building the supplier's file." },
  { status: "ready_to_deliver", bucket: "healthy", reachable: true, note: "Built, queued to send." },
  {
    status: "delivery_held",
    bucket: "parked",
    reachable: true,
    note: "Billing paused the send. Released automatically when the org is back in good standing.",
  },
  { status: "delivering", bucket: "healthy", reachable: true, note: "The Worker holds the dispatch claim." },
  { status: "delivered", bucket: "healthy", reachable: true, note: "The supplier has it." },
  { status: "delivery_failed", bucket: "failure", reachable: true, note: "Could not reach the supplier; the backoff queue is still trying." },
  {
    status: "delivery_unconfirmed",
    bucket: "parked",
    reachable: true,
    note: "A send was attempted and its outcome was lost on a channel that cannot de-duplicate. Only a person may resolve it.",
  },
  { status: "delivery_dead_letter", bucket: "failure", reachable: true, note: "The automatic attempts are spent." },
  { status: "transform_failed", bucket: "failure", reachable: true, note: "The output could not be built. Holds no artifact." },
  { status: "rejected_by_supplier", bucket: "failure", reachable: true, note: "The supplier read it and refused it." },
  { status: "failed", bucket: "failure", reachable: true, note: "The source file could not be read. The only DeclaredTerminal status." },
] as const;

/** Every status the machine knows, reachable or not. */
export const ORDER_STATUSES: readonly string[] = ORDER_STATUS_FACTS.map((f) => f.status);

/** The statuses a production writer can actually produce. */
export const REACHABLE_STATUSES: readonly string[] = ORDER_STATUS_FACTS.filter((f) => f.reachable).map((f) => f.status);

function statusesInBucket(bucket: StatusBucket): readonly string[] {
  return ORDER_STATUS_FACTS.filter((f) => f.bucket === bucket && f.reachable).map((f) => f.status);
}

/**
 * OrderStatusConstants.FailureBucket — the five statuses the inbox collapses into
 * one red pill and that `?status=failed` expands to server-side.
 *
 * Derived from the bucket column rather than retyped: the two cannot disagree.
 */
export const FAILURE_STATUSES: readonly string[] = statusesInBucket("failure");

/** Stopped, but nothing broke. Not a backend set — see StatusBucket's doc. */
export const PARKED_STATUSES: readonly string[] = statusesInBucket("parked");

/**
 * Every status that owes the operator an answer to "what do I do now".
 *
 * This is the list WP-36's coverage test iterates, and it is computed, so a status
 * added to ORDER_STATUS_FACTS in either problem bucket is covered the moment it
 * is added — which is the difference between this and the nine checklists above.
 */
export const PROBLEM_BUCKET_STATUSES: readonly string[] = [...FAILURE_STATUSES, ...PARKED_STATUSES];

/**
 * OrderStatusMachine.DeclaredTerminal — terminal BY DECLARATION, never derived
 * from an empty edge set.
 *
 * That distinction is load-bearing and the C# doc explains why at length: deriving
 * terminality from "it has no successors" is how `rejected_by_supplier` became an
 * unintended dead end that no control in the product could move. `failed` is the
 * only member, and its exit is a NEW order row rather than a transition on this one.
 */
export const DECLARED_TERMINAL: readonly string[] = ["failed"];

/** The operations a problem panel or an ops table may offer. */
export type OrderOp =
  | "transformOrder"
  | "retryDelivery"
  | "requeueDelivery"
  | "redeliverOrder"
  | "markDelivered"
  | "assignSupplier";

export interface OpGuard {
  /** The statuses the ENDPOINT admits. Not the statuses a downstream claim accepts. */
  allowedFrom: readonly string[];
  /** The C# symbol this mirrors, or the literal when the backend has not named one. */
  backendSymbol: string;
  /** file:line of the guard in the backend repo, as read at the date in this file's header. */
  backendSite: string;
}

/**
 * ENDPOINT ADMISSION GUARDS — what the API answers 2xx for.
 *
 * THE DISTINCTION THIS TABLE EXISTS TO HOLD: the backend has TWO kinds of status
 * set per operation, and they are not the same size.
 *
 *   • the ENDPOINT's admission guard — what a controller checks before answering
 *   • the WORKER's atomic claim set — what a job may pick the row up from
 *
 * A UI control is offered on the strength of the FIRST. Mirroring the second
 * over-admits, and over-admitting is the D2 defect verbatim: a button the backend
 * answers 400 to. That is exactly how `retryDelivery` came to claim
 * `ready_to_deliver`, which `ClaimableForRetryFrom` contains and the endpoint's
 * `RetryableFrom` does not.
 *
 * `delivery_held` appears in NONE of these: the release is automatic when billing
 * settles, and every send endpoint answers 400 while held.
 *
 * This table says what the backend ACCEPTS — never what the product chooses to
 * OFFER. Those were conflated once and the mirror drifted in both directions at
 * the same time; a mirror that lies in order to enforce a policy stops being able
 * to enforce anything. Product rules (for instance "a refused order is never
 * offered a retry, because re-sending the refused bytes cannot un-refuse them")
 * are asserted over PROBLEM_COPY, where they are true.
 */
export const OP_GUARDS: Record<OrderOp, OpGuard> = {
  transformOrder: {
    allowedFrom: ["ready", "transform_failed", "rejected_by_supplier"],
    backendSymbol: "OrderStatusMachine.TransformableFrom",
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:1698",
  },
  retryDelivery: {
    // RetryableFrom, NOT ClaimableForRetryFrom. The claim set also contains
    // `ready_to_deliver`; the endpoint does not, and answers 400 for it with a
    // message built from this very set. `delivery_dead_letter` is refused one line
    // earlier with its own sentence pointing at the ops path.
    allowedFrom: ["delivery_failed"],
    backendSymbol: "OrderStatusMachine.RetryableFrom",
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2320",
  },
  requeueDelivery: {
    // Named at last. This entry used to read "an inline status literal, not a named
    // set — the sibling backend PR promotes it to OrderStatusMachine.RequeueableFrom",
    // which was true when written and stopped being true when that PR landed. The
    // set exists (OrderStatusMachine.cs:593) and the endpoint's refusal message is
    // built from it, so the statuses it names cannot drift from the ones it admits.
    allowedFrom: ["delivery_dead_letter", "delivery_failed"],
    backendSymbol: "OrderStatusMachine.RequeueableFrom",
    backendSite: "ProcuLink.Api/Controllers/OpsController.cs:155",
  },
  redeliverOrder: {
    allowedFrom: ["ready_to_deliver", "delivery_failed", "delivery_unconfirmed"],
    backendSymbol: "OrderStatusMachine.RedeliverableFrom",
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2092",
  },
  markDelivered: {
    allowedFrom: ["delivery_unconfirmed"],
    backendSymbol: "OrderStatusMachine.ManuallyDeliverableFrom",
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2166",
  },
  assignSupplier: {
    // The one guard the backend still writes as a bare literal rather than a named
    // set — `o.Status == OrderStatusConstants.Unrouted` inside the atomic claim.
    // Named as the literal it is: citing a symbol that does not exist is the same
    // failure as citing the wrong one.
    allowedFrom: ["unrouted"],
    backendSymbol: "OrdersController.AssignSupplier inline literal (OrderStatusConstants.Unrouted)",
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:779",
  },
};

/**
 * POST /resolve and POST /accept-ai-suggestions are a DENY-list, not an allow-list —
 * the only guard of this shape, which is why it is not in OP_GUARDS.
 *
 * A resolve is legal from every status EXCEPT these four, because both endpoints end
 * with the same unconditional recompute (`Status = Lines.Any(NeedsReview) ?
 * pending_review : ready`) and running it from one of these destroys something:
 *   unrouted     lifts the order out of the routing hold with SupplierId still null,
 *                and assign-supplier claims atomically on Status == Unrouted, so the
 *                order becomes permanently unroutable
 *   delivering   writes straight over a live dispatch claim
 *   parsing      overwrites an in-flight parse
 *   transforming overwrites an in-flight transform
 * Refused with 409 and a per-status sentence (OrderStatusMachine.ResolveHoldMessage).
 * `failed` is refused separately, one layer down, with a 400 — permanent, not a hold.
 *
 * This list was two entries (`unrouted`, `delivering`) in the client-side comment that
 * described it; the backend set has been four since WP-23 grew the parse/transform arms.
 */
export const RESOLVE_HELD_FROM: readonly string[] = ["unrouted", "delivering", "parsing", "transforming"];

const FACT_BY_STATUS = new Map(ORDER_STATUS_FACTS.map((f) => [f.status, f] as const));

/** The manifest row for a raw status, or null when the machine has never heard of it. */
export function statusFact(status: string | null | undefined): OrderStatusFact | null {
  if (!status) return null;
  return FACT_BY_STATUS.get(status) ?? null;
}

/**
 * True when the manifest names `status` and its bucket is not `healthy`.
 *
 * NO PRODUCTION CODE CALLS THIS. Every render path that once did — the issues rail,
 * the mobile triage list, the desktop Issues column head — now calls
 * `orderProblemState`, because each of them draws a VERDICT and this boolean cannot
 * carry one: `false` here means both "healthy" and "this build has never heard of
 * that status", and a live status string off the wire is routinely the second, since
 * frontend and backend deploy separately.
 *
 * It is retained as a manifest primitive for DERIVING SETS, the one job the collapse
 * is safe for. Walked over statuses the manifest already names — `REACHABLE_STATUSES`,
 * `ORDER_STATUS_FACTS` — the unknown arm cannot arise, so the boolean is total and
 * `REACHABLE_STATUSES.filter((s) => !isProblemBucketStatus(s))` is exactly the healthy
 * walk. Both in-tree callers are tests doing that split
 * (`orderStatusManifest.problemState.test.ts`, `workshop/issuesRailFailureState.test.tsx`);
 * the first also pins the difference between the two functions as an executable fact
 * rather than a comment, which is the other reason this one still exists.
 *
 * False-for-unknown is deliberate and stays. Read forward — never negated — it answers
 * "may I offer a recovery action here?", and no is the honest answer for a status this
 * build cannot read. `/operations/health` once defaulted the other way and rendered a
 * requeue button for any status it did not recognise: a control the endpoint answers
 * 400 to, offered precisely where the frontend understood the row least.
 *
 * Reaching for this inside a component means you want `orderProblemState` below.
 */
export function isProblemBucketStatus(status: string | null | undefined): boolean {
  const fact = statusFact(status);
  return fact !== null && fact.bucket !== "healthy";
}

/**
 * The three answers a status can give about whether the order is in trouble.
 *
 * `"unknown"` is a first-class answer, not a shade of `"clear"`: frontend and
 * backend deploy separately, so a status this build has never heard of is a
 * routine event, and the only honest thing to say about it is that we cannot
 * tell. Callers that render a VERDICT (a tick, an all-clear sentence, a green
 * dot) must branch on all three.
 */
export type OrderProblemState = "clear" | "problem" | "unknown";

/** `"clear"` healthy · `"problem"` stopped and owes a next step · `"unknown"` not in this build's manifest. */
export function orderProblemState(status: string | null | undefined): OrderProblemState {
  const fact = statusFact(status);
  if (fact === null) return "unknown";
  return fact.bucket === "healthy" ? "clear" : "problem";
}

/** True when the backend's guard for `op` admits `status`. Unknown status → false. */
export function opAllowsStatus(op: OrderOp, status: string | null | undefined): boolean {
  if (!status) return false;
  return OP_GUARDS[op].allowedFrom.includes(status);
}
