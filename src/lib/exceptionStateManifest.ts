// exceptionStateManifest — the ONE place the frontend writes down what the backend can
// put in an exception's `state`, and the only list /operations/exceptions is allowed to
// read.
//
// WHY THIS FILE EXISTS
//
// `src/app/(app)/operations/exceptions/page.tsx` decided the entire right-hand end of
// every row — the state word AND all three actions — with one equality:
//
//     {exc.state === "open" ? ( <Resolve/OpenOrder/> <Ignore/> ) : (
//       <span style={{ color: "var(--ink-faint)" }}>{exc.state ?? "—"}</span>
//     )}
//
// There is no third branch. So a state this build has never heard of took the ELSE, and
// the else is the settled branch: the row rendered as a faint grey word in the column
// where `resolved` and `ignored` render, with Resolve, Open order and Ignore all gone. A
// live, open, blocking exception therefore read as already dealt with and offered the
// operator no way to act on it — on the one screen whose entire job is "every order that
// needs a human decision before it can be sent". An absent state was worse still: it
// rendered as `—`, a row that says nothing at all and does nothing at all.
//
// This is the SEVENTH instance of one defect class in this codebase: an unknown or absent
// value resolving to a confident, favourable answer. The v2 audit found six in a day (the
// delivery log, catalog sync, the output passport, mapping confidence, supplier health,
// and a practice-order safety promise), and every one had this shape. The rule those
// fixes established, and the rule this file exists to hold: AN UNRECOGNISED VALUE MUST
// RESOLVE TO THE LEAST CONFIDENT READING, NEVER THE MOST. "I cannot place this" is not a
// synonym for "handled".
//
// WHY THE UNKNOWN CASE KEEPS ITS ACTIONS, when the invoice manifest's unknown case
// deliberately withholds them. That is not an inconsistency; the two are answering
// different questions and the difference is in the backend.
//
//   • `canApproveInvoice` answers false for an unknown status because POST /approve is
//     only sensible on a parsed row, and offering it elsewhere puts a control in front of
//     the operator exactly where the UI understands the row least.
//   • The exception actions have NO prior-state guard at all. `ResolveAsync` and
//     `IgnoreAsync` both funnel into `SetStateAsync` (OrderExceptionService.cs:167,170,172),
//     which loads the row by id and org and writes the new state unconditionally — the
//     controller's only failure mode is 404 for a row that is not yours
//     (ExceptionsController.cs:33-40). "Open order" is navigation. So every action offered
//     here really works from any state, including one this build cannot name.
//
// Withholding them would therefore not be caution, it would be the original bug with a
// better label: a real exception that no one can act on. The honest answer is to say what
// is known, admit what is not, and leave the operator the controls.
//
// PROVENANCE — backend repo ProcuLink @ main c2f8564, read 2026-08-08.
//
// THE BACKEND NAMES NO SET, exactly as for invoice statuses and catalog sync statuses.
// There is no constants class, no enum, no `IReadOnlySet`: `OrderException.State` is a
// bare `string` column, and the vocabulary exists as literals at the sites that write it
// plus a doc-comment on the entity that lists them in prose:
//
//   ProcuLink.Core/Entities/OrderException.cs:20
//     /// <summary>open | resolved | ignored</summary>
//   ProcuLink.Core/Entities/OrderException.cs:21          = "open"      (property default)
//   ProcuLink.Infrastructure/Services/OrderExceptionService.cs:117   ex.State = "resolved"
//   ProcuLink.Infrastructure/Services/OrderExceptionService.cs:143   State    = "open"
//   ProcuLink.Infrastructure/Services/OrderExceptionService.cs:167   SetStateAsync(…, "resolved")
//   ProcuLink.Infrastructure/Services/OrderExceptionService.cs:170   SetStateAsync(…, "ignored")
//
// Note the shape of that list, because it is why the invoice mirror's parser is not
// sufficient on its own. `ignored` is never the right-hand side of an assignment
// anywhere in the backend — it reaches the column only as the third ARGUMENT of a
// `SetStateAsync` call. An assignment-only reader parses this file to {open, resolved}
// and would report a manifest containing `ignored` as drift. The mirror check in
// src/test/backendMirror.test.ts therefore reads both forms and unions them, and its
// parser is exercised against an inline fixture on every run so that "found nothing"
// fails loudly instead of confirming the mirror by silence.
//
// The READERS are deliberately not part of the vocabulary: `DataRetentionService.cs:103`
// and `OpsHealthService.cs:65` compare against these strings, and a reader can only ever
// narrow what a writer produces. Only writers define what can arrive on the wire.

/**
 * What a state entitles the row to say, and what it owes the operator.
 *
 *  needs_action  a person still has to do something. The row must offer its controls.
 *  settled       the row is finished with, by the system or by a person. Label, no controls.
 *
 * There is deliberately NO member for "unknown". An unrecognised state is the ABSENCE of a
 * fact, not a third kind — see {@link exceptionStateFact}, which answers null for it. A
 * kind called `unknown` would be a place for a future edit to quietly park a state it did
 * not want to think about, which is how the defect above was written in the first place.
 */
export type ExceptionStateKind = "needs_action" | "settled";

interface ExceptionStateFactShape {
  /** The raw string the API sends in `state`. */
  state: string;
  kind: ExceptionStateKind;
  /** What an operator reads in the filter tabs. Never the raw wire value. */
  label: string;
  /** file:line of the C# that writes this value, as read at the date in this header. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/**
 * Every value a production writer can put in an exception's `state`. Three.
 *
 * `as const satisfies` rather than a plain annotation, and that is load-bearing: it keeps
 * each `state` a literal type so {@link ExceptionStateName} is DERIVED from this array
 * rather than hand-typed beside it. A fourth entry widens the union, which makes the
 * switch in {@link exceptionRowPresentation} non-exhaustive, which fails its `never`
 * assignment — so adding a state without deciding how it renders is a build error rather
 * than a silent extra member of whichever branch it happened to fall into.
 */
export const EXCEPTION_STATE_FACTS = [
  {
    state: "open",
    kind: "needs_action",
    label: "Open",
    backendSite: "ProcuLink.Infrastructure/Services/OrderExceptionService.cs:143",
    note:
      "What ReconcileAsync writes when it opens a row, and the property default on the entity " +
      "(OrderException.cs:21). The state this screen exists to work through: the only one that " +
      "used to reach the action buttons at all.",
  },
  {
    state: "resolved",
    kind: "settled",
    label: "Resolved",
    backendSite: "ProcuLink.Infrastructure/Services/OrderExceptionService.cs:117",
    note:
      "Written by ReconcileAsync when the order's underlying cause is gone, and by ResolveAsync " +
      "for a row with no owning order. Not an operator verdict on an order-linked row — the next " +
      "pipeline pass re-opens one whose cause still holds, which is why this list offers 'Open " +
      "order' instead of 'Resolve' whenever there is an order to open.",
  },
  {
    state: "ignored",
    kind: "settled",
    label: "Ignored",
    backendSite: "ProcuLink.Infrastructure/Services/OrderExceptionService.cs:170",
    note:
      "A person dismissed it. The one genuinely terminal state: ReconcileAsync never auto-resolves " +
      "or reopens an ignored row, and an ignored row for the current problem suppresses opening a " +
      "duplicate (OrderExceptionService.cs:19-20,133). Reaches the column only as a SetStateAsync " +
      "argument — it is never assigned a literal — which is why the mirror parser reads call " +
      "arguments as well as assignments.",
  },
] as const satisfies readonly ExceptionStateFactShape[];

/** Every state this build knows, as a type. Derived from the table, never retyped. */
export type ExceptionStateName = (typeof EXCEPTION_STATE_FACTS)[number]["state"];

export type ExceptionStateFact = (typeof EXCEPTION_STATE_FACTS)[number];

/** Every state this build knows, in the backend's own vocabulary. */
export const EXCEPTION_STATES: readonly ExceptionStateName[] = EXCEPTION_STATE_FACTS.map(
  (f) => f.state,
);

/** The states on which the row offers its controls. Derived, never retyped. */
export const ACTIONABLE_EXCEPTION_STATES: readonly ExceptionStateName[] = EXCEPTION_STATE_FACTS
  .filter((f) => f.kind === "needs_action")
  .map((f) => f.state);

/** The states that read as finished with. Derived, never retyped. */
export const SETTLED_EXCEPTION_STATES: readonly ExceptionStateName[] = EXCEPTION_STATE_FACTS
  .filter((f) => f.kind === "settled")
  .map((f) => f.state);

const FACT_BY_STATE = new Map<string, ExceptionStateFact>(
  EXCEPTION_STATE_FACTS.map((f) => [f.state, f] as const),
);

/**
 * The manifest row for a raw state, or null when this build has never heard of it.
 *
 * NULL IS THE WHOLE POINT, and it is the direction the original bug ran in. Whitespace is
 * trimmed and an empty string answers null: a blank state is not a member of the
 * vocabulary either, and it arrived on this screen as `—`.
 */
export function exceptionStateFact(raw: string | null | undefined): ExceptionStateFact | null {
  if (!raw) return null;
  return FACT_BY_STATE.get(raw.trim()) ?? null;
}

/** What the notice calls a state this build cannot place, when the row reported one. */
export const UNRECOGNISED_EXCEPTION_LABEL = "Unrecognised state";

/** What the notice calls a row that arrived carrying no state at all. */
export const MISSING_EXCEPTION_STATE_LABEL = "No state reported";

/** How a row's right-hand end renders. Exactly three shapes; a row is one of them. */
export type ExceptionRowPresentation =
  /** A person still has to act. Offer the controls, say nothing about the state. */
  | { kind: "needs_action" }
  /**
   * Finished with. A faint word, no controls.
   *
   * `stateWord` is the RAW value rather than the fact's `label` on purpose. This is the
   * one branch that already shipped correctly, and it renders `{exc.state}` under a
   * `capitalize` class — CSS capitalisation does not change `textContent`, so swapping in
   * the label would change what the DOM says while looking identical on screen. The
   * regression guard for this fix asserts the recognised states render EXACTLY as they do
   * today, and it is allowed to be that strict precisely because nothing here moved.
   */
  | { kind: "settled"; stateWord: string }
  /**
   * This build cannot place the state. Say so, and keep the controls.
   *
   * `label` states what is known (the value that arrived, or that none did). `detail`
   * admits what is not (whether the issue has been handled) and names the way forward.
   */
  | { kind: "unrecognised"; label: string; detail: string };

/**
 * How to render the right-hand end of an exception row, from its raw `state`.
 *
 * THE ONE RULE: an unrecognised state resolves to `unrecognised`, which keeps the controls
 * and never reads as handled. It does NOT resolve to `needs_action` either — claiming the
 * row is "Open" would be inventing a status the backend did not send, which is the same
 * class of lie pointing the other way.
 */
export function exceptionRowPresentation(raw: string | null | undefined): ExceptionRowPresentation {
  const fact = exceptionStateFact(raw);

  if (fact === null) {
    const reported = (raw ?? "").trim();
    return reported.length > 0
      ? {
          kind: "unrecognised",
          label: `${UNRECOGNISED_EXCEPTION_LABEL}: ${reported}`,
          detail:
            `This issue reported a state ProcuLink doesn't recognise (“${reported}”), so we can't ` +
            "confirm whether it has been dealt with. It's still listed as needing attention. Open " +
            "the order to fix the cause, or ignore it if it doesn't apply.",
        }
      : {
          kind: "unrecognised",
          label: MISSING_EXCEPTION_STATE_LABEL,
          detail:
            "This issue arrived without a state, so ProcuLink can't confirm whether it has been " +
            "dealt with. It's still listed as needing attention. Open the order to fix the cause, " +
            "or ignore it if it doesn't apply.",
        };
  }

  // Bound to a local rather than switched on as `fact.state`: switching on the property
  // narrows `fact` ITSELF to `never` once the arms are exhaustive, and `never.state` is an
  // error rather than the check we want. The union has to be in a variable of its own.
  const state: ExceptionStateName = fact.state;

  switch (state) {
    case "open":
      return { kind: "needs_action" };
    case "resolved":
    case "ignored":
      // Both settled states render identically today — a faint capitalised state word and
      // no controls — so they share an arm. They are NOT collapsed into one value: the
      // word each renders is its own, which is what the guard checks.
      return { kind: "settled", stateWord: (raw ?? "").trim() };
  }

  // No `default:` above, deliberately. A fourth entry in EXCEPTION_STATE_FACTS fails to
  // assign to `never` here, so it is a build error — the decision this function exists to
  // force — rather than a silent extra member of whichever branch the default happened to
  // be. This is the structural half PR #121 established; without it the next state added
  // backend-side rejoins the settled branch exactly as `escalated` would have.
  const unhandled: never = state;
  void unhandled;
  // Unreachable while the union holds. If it ever is reached at runtime — a build that
  // skipped typechecking, a state added to the table with no arm — it degrades to the
  // least confident reading, never to "handled".
  return {
    kind: "unrecognised",
    label: UNRECOGNISED_EXCEPTION_LABEL,
    detail:
      "ProcuLink can't confirm whether this issue has been dealt with. It's still listed as " +
      "needing attention. Open the order to fix the cause, or ignore it if it doesn't apply.",
  };
}

/**
 * True when the row must offer Resolve / Open order / Ignore.
 *
 * Unknown answers TRUE. That is the opposite of `canApproveInvoice`, and deliberately so —
 * see this file's header: those actions have no prior-state guard, so offering them on a
 * row we cannot place costs nothing and withholding them strands a real exception.
 */
export function exceptionOffersActions(raw: string | null | undefined): boolean {
  return exceptionRowPresentation(raw).kind !== "settled";
}

/** True only when the row may read as needing no further work. Unknown answers false. */
export function exceptionReadsAsHandled(raw: string | null | undefined): boolean {
  return exceptionRowPresentation(raw).kind === "settled";
}
