import { describe, test, expect } from "vitest";
import {
  PROBLEM_COPY,
  transformCauseFor,
  transformCauseNameFor,
  type ProblemAction,
  type ProblemCtx,
  type TransformCauseName,
} from "../problemCopy";

// ─────────────────────────────────────────────────────────────────────────────
// `transform_failed` stopped meaning one thing.
//
// BE #172 wrapped OrderTransformService.TransformAsync, so failures that used to
// strand an order silently in `transforming` now land in this status beside the
// broken-template one it was written for. The shipped copy made four statements
// that are false for most of the new causes, and the worst of them was about
// automatic behaviour: it said "We won't try to build it again on our own" while
// TransformOrderJob carries [AutomaticRetry(Attempts = 3, DelaysInSeconds =
// { 10, 60, 300 })], throws on EVERY unsuccessful result, and re-claims a
// transform_failed order on each retry.
//
// So these tests pin two things: each real backend message gets the copy and the
// route that fit it, and no cause lies about the retries in either direction.
//
// The fixtures are the backend strings VERBATIM. "Close enough" input is how a
// defect walks past its own regression test — see productionDefectStrings.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Exactly what OrderTransformService writes to the TransformFailed audit `error`. */
const MESSAGE: Record<TransformCauseName, string> = {
  // :196-201 — the trailing line numbers vary per order.
  unresolved_lines: "Resolve all lines before transforming. Unresolved: 1, 3.",
  // :137-166 — the broad catch (a DB blip, an R2 outage, anything unforeseen).
  preparation_failed:
    "Something went wrong preparing this order to send, so it wasn't sent. Try sending it again in a moment.",
  // :383-387 — the format varies.
  no_builder_for_format: "No transform service registered for format 'xml'.",
  // :559-583 — the acceptance gate could not be evaluated.
  rules_check_failed:
    "This order couldn't be checked against the supplier's rules, so it wasn't sent. Try sending it again in a moment.",
  // :585-600 — the gate blocked it and the profile named no reason of its own.
  rules_refused: "This order wasn't sent because it doesn't meet what the supplier accepts.",
};

/** The template / output-mapping failure the shipped copy was written for. */
const TEMPLATE_FAILURE =
  "The published output mapping for this connection could not be applied, so the order was not delivered: "
  + "Object reference not set to an instance of an object.";

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

const copy = PROBLEM_COPY.transform_failed;
const forCause = (cause: TransformCauseName, over: Partial<ProblemCtx> = {}) =>
  ctx({ serverMessage: MESSAGE[cause], ...over });

function label(a: ProblemAction): string {
  return a.kind === "link" || a.kind === "post" ? a.label : a.kind;
}
const labels = (c: ProblemCtx) => copy.actions(c).map(label);
const hrefOf = (a: ProblemAction) => (a.kind === "link" ? a.href : null);
const variantOf = (a: ProblemAction) => (a.kind === "link" || a.kind === "post" ? a.variant : null);

describe("every message the backend can write here is recognised", () => {
  test.each(Object.keys(MESSAGE) as TransformCauseName[])("%s is matched by its real message", (cause) => {
    expect(transformCauseNameFor(MESSAGE[cause])).toBe(cause);
    expect(transformCauseFor(forCause(cause))).not.toBeNull();
  });

  test("the unresolved-lines match survives whatever line numbers it names", () => {
    // The list is interpolated per order, so a matcher anchored on the whole
    // sentence would recognise the fixture and nothing else.
    for (const tail of ["Unresolved: 4.", "Unresolved: 2, 7, 19.", "Unresolved: 1."]) {
      expect(transformCauseNameFor(`Resolve all lines before transforming. ${tail}`)).toBe("unresolved_lines");
    }
  });

  test("the missing-builder match survives whatever format it names", () => {
    for (const format of ["xml", "cxml", "ubl_order", "x12_850"]) {
      expect(transformCauseNameFor(`No transform service registered for format '${format}'.`)).toBe(
        "no_builder_for_format",
      );
    }
  });

  test("the two 'try again in a moment' messages are told apart", () => {
    // They share a closing sentence and mean opposite things — one is our fault
    // and heals, the other is a check that could not run. Matching on the tail
    // would collapse them.
    expect(transformCauseNameFor(MESSAGE.preparation_failed)).toBe("preparation_failed");
    expect(transformCauseNameFor(MESSAGE.rules_check_failed)).toBe("rules_check_failed");
  });

  test("the matchers are disjoint — no message is claimed by another cause", () => {
    // Ordered matching means a sloppy pattern is invisible: it simply eats the
    // message of whichever cause is declared later. So assert the mapping both
    // ways — every message resolves to its OWN cause and to no other's.
    for (const claimed of Object.keys(MESSAGE) as TransformCauseName[]) {
      for (const written of Object.keys(MESSAGE) as TransformCauseName[]) {
        expect(
          transformCauseNameFor(MESSAGE[written]) === claimed,
          `the "${claimed}" matcher claims the "${written}" message`,
        ).toBe(claimed === written);
      }
    }
  });
});

describe("nothing claims a retry that does not happen, or denies one that does", () => {
  // The contradiction this whole packet exists to end. TransformOrderJob.cs:47
  // retries three times and :66-72 throws on every unsuccessful result, so the
  // tries are real for EVERY cause — including the ones they cannot fix.
  const RETRY_DENIAL = /we (won'?t|will not) try/i;

  test.each(Object.keys(MESSAGE) as TransformCauseName[])(
    "%s never says we won't try again — the Worker does",
    (cause) => {
      const line = copy.automaticFor(forCause(cause));
      expect(line.length).toBeGreaterThan(15);
      expect(line, `"${line}" denies a retry the backend performs`).not.toMatch(RETRY_DENIAL);
    },
  );

  test("the fallback does not deny it either — the same job retries a template failure", () => {
    for (const message of [TEMPLATE_FAILURE, "Scriban: (12,5) : error : Cannot get member on a null object", null]) {
      const line = copy.automaticFor(ctx({ serverMessage: message }));
      expect(line, `"${line}" denies a retry the backend performs`).not.toMatch(RETRY_DENIAL);
      expect(line.length).toBeGreaterThan(15);
    }
  });

  test("only the two causes a retry can fix promise that it is being handled", () => {
    // "We're trying again automatically" is a promise that waiting is enough. It
    // is true for an unexpected fault and for a rules check that could not run —
    // and false for the four where the same inputs fail the same way.
    const heals: TransformCauseName[] = ["preparation_failed", "rules_check_failed"];
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      const line = copy.automaticFor(forCause(cause));
      expect(
        /trying again automatically/i.test(line),
        `${cause}: "${line}"`,
      ).toBe(heals.includes(cause));
    }
    expect(/trying again automatically/i.test(copy.automaticFor(ctx()))).toBe(false);
  });

  test("a cause that cannot heal says so in the same breath as the tries", () => {
    for (const cause of ["unresolved_lines", "no_builder_for_format", "rules_refused"] as const) {
      expect(copy.automaticFor(forCause(cause))).toMatch(/every time|each time/i);
    }
  });

  test("the outage note is still appended for every cause", () => {
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      expect(copy.automaticFor(forCause(cause, { processingPaused: true }))).toMatch(/paused/i);
    }
    expect(copy.automaticFor(ctx({ processingPaused: true }))).toMatch(/paused/i);
  });
});

describe("the tier says who has to act, and it is honest about it", () => {
  test.each([
    ["unresolved_lines", "self"],
    ["preparation_failed", "wait"],
    ["no_builder_for_format", "self"],
    ["rules_check_failed", "wait"],
    ["rules_refused", "self"],
  ] as const)("%s is a %s", (cause, tier) => {
    expect(copy.tier(forCause(cause))).toBe(tier);
  });

  test("an infrastructure fault is never the operator's to fix", () => {
    // "self" on the health page means "you can fix this". A DB blip is not
    // something a purchasing coordinator can do anything about, and the backend
    // is already retrying it.
    expect(copy.tier(forCause("preparation_failed"))).not.toBe("self");
    expect(copy.tier(forCause("rules_check_failed"))).not.toBe("self");
  });

  test("the fallback stays self-serve", () => {
    expect(copy.tier(ctx())).toBe("self");
    expect(copy.tier(ctx({ serverMessage: TEMPLATE_FAILURE }))).toBe("self");
  });
});

describe("each cause is pointed at something that can actually fix it", () => {
  test("unresolved lines lead to the item codes, NOT the output settings", () => {
    // The shipped copy sent this one to `?tab=delivery`, where no amount of
    // editing puts an item code on a line.
    const actions = copy.actions(forCause("unresolved_lines"));
    expect(hrefOf(actions[0])).toBe("/library/suppliers/sup-1?tab=mappings");
    expect(variantOf(actions[0])).toBe("primary");
    expect(labels(forCause("unresolved_lines"))).toEqual([
      "Open this supplier's item codes",
      "Try building it again",
    ]);
    // The rebuild is still THERE — it is what the operator clicks once the codes
    // are in — but it is not the primary, because clicking it now cannot succeed.
    const rebuild = actions.find((a) => a.kind === "post");
    expect(variantOf(rebuild!)).toBe("secondary");
    // And the copy names the screen the codes are really confirmed on.
    expect(copy.helper!(forCause("unresolved_lines"))).toMatch(/flagged on this screen/i);
  });

  test("a refusal by the supplier's rules leads to the rules", () => {
    const actions = copy.actions(forCause("rules_refused"));
    expect(hrefOf(actions[0])).toBe("/library/suppliers/sup-1?tab=acceptance");
    expect(labels(forCause("rules_refused"))).toEqual([
      "Check this supplier's rules",
      "Try building it again",
    ]);
  });

  test("a format we cannot build keeps the output settings, which is where it is chosen", () => {
    const actions = copy.actions(forCause("no_builder_for_format"));
    expect(hrefOf(actions[0])).toBe("/library/suppliers/sup-1?tab=delivery");
    expect(labels(forCause("no_builder_for_format"))).toEqual([
      "Open the output settings",
      "Try building it again",
    ]);
  });

  test("a transient fault offers the rebuild alone — there is no setting to open", () => {
    for (const cause of ["preparation_failed", "rules_check_failed"] as const) {
      expect(labels(forCause(cause))).toEqual(["Try building it again"]);
      expect(variantOf(copy.actions(forCause(cause))[0])).toBe("primary");
    }
  });

  test("every cause still offers a route out with no supplier id", () => {
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      const actions = copy.actions(forCause(cause, { supplierId: null, supplier: "this supplier" }));
      expect(actions.length, cause).toBeGreaterThan(0);
      for (const a of actions) {
        if (a.kind === "link") expect(a.href, cause).toBe("/library/suppliers");
      }
    }
  });

  test("a read-only plan disables every rebuild it offers rather than firing a refused POST", () => {
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      for (const a of copy.actions(forCause(cause, { readOnly: true }))) {
        if (a.kind === "post") expect(a.disabledReason, cause).toBeTruthy();
      }
    }
  });

  test("only the transform rebuild is ever posted — no cause invents an endpoint", () => {
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      for (const a of copy.actions(forCause(cause))) {
        if (a.kind === "post") expect(a.op).toBe("transformOrder");
      }
    }
  });
});

describe("the copy says what to do, not what happened", () => {
  test.each(Object.keys(MESSAGE) as TransformCauseName[])("%s never repeats the server message", (cause) => {
    const rendered = [
      copy.attribution(forCause(cause)),
      copy.consequence(forCause(cause)),
      copy.helper!(forCause(cause)) ?? "",
      copy.automaticFor(forCause(cause)),
    ].join(" ");
    // The verbatim message is rendered in its own block above these lines. A
    // paraphrase beside it is the same sentence twice, in two voices.
    expect(rendered).not.toContain(MESSAGE[cause]);
  });

  test.each(Object.keys(MESSAGE) as TransformCauseName[])("%s answers all five questions", (cause) => {
    expect(copy.attribution(forCause(cause)).length).toBeGreaterThan(20);
    expect(copy.consequence(forCause(cause)).length).toBeGreaterThan(20);
    expect(copy.automaticFor(forCause(cause)).length).toBeGreaterThan(15);
    expect(copy.actions(forCause(cause)).length).toBeGreaterThan(0);
  });

  test.each(Object.keys(MESSAGE) as TransformCauseName[])("%s names the supplier where it matters", (cause) => {
    // "this supplier" is the placeholder for an order with no supplier yet; a
    // cause that hard-codes it would say it even when we know the name.
    const said = copy.attribution(forCause(cause)) + copy.consequence(forCause(cause));
    expect(said).toContain("BoltWorks BV");
  });

  test("no engine vocabulary reaches any of the new lines", () => {
    // The suite's vocabulary gate walks PROBLEM_COPY with a DEFAULT ctx, which
    // renders the fallback only — every string added by this table is invisible
    // to it. `transform` is banned product-wide and the backend messages are full
    // of it, so a copy-paste from one into the other is the likely mistake.
    const BANNED = [/\btransform\b/i, /\bdead[\s-]?letter\b/i, /\bcrossing\b/i, /\bspine\b/i, /\bdock\b/i, /\blane\b/i, /\bunrouted\b/i, /\bhangfire\b/i, /\bexception\b/i, /\bnull\b/i];
    for (const cause of Object.keys(MESSAGE) as TransformCauseName[]) {
      const strings = [
        copy.attribution(forCause(cause)),
        copy.consequence(forCause(cause)),
        copy.helper!(forCause(cause)) ?? "",
        copy.automaticFor(forCause(cause)),
        ...copy.actions(forCause(cause)).map((a) => label(a)),
      ];
      for (const s of strings) {
        for (const banned of BANNED) {
          expect(banned.test(s), `${cause}: "${s}" contains ${banned}`).toBe(false);
        }
      }
    }
  });
});

describe("an unrecognised message reads exactly as it did before the table existed", () => {
  test("a null message is the fallback, not a blank panel", () => {
    expect(transformCauseNameFor(null)).toBeNull();
    expect(transformCauseFor(ctx())).toBeNull();
    expect(copy.attribution(ctx())).toBe("Your order is fine — the output we build for BoltWorks BV isn't.");
    expect(labels(ctx())).toEqual(["Open the output settings", "Try building it again"]);
    expect(copy.helper!(ctx())).toMatch(/send us the message above/i);
  });

  test("the template failure this state was written for still gets its own copy", () => {
    const over = ctx({ serverMessage: TEMPLATE_FAILURE });
    expect(transformCauseNameFor(TEMPLATE_FAILURE)).toBeNull();
    expect(labels(over)).toEqual(["Open the output settings", "Try building it again"]);
    expect(copy.attribution(over)).toContain("the output we build for BoltWorks BV isn't");
  });

  test("a message this build has never heard of is not a crash and not a blank", () => {
    // Deploys are not atomic and the backend's failure sentences will change.
    for (const message of [
      "",
      "   ",
      "constructor",
      "__proto__",
      "toString",
      "A sentence written by a future version of the API.",
    ]) {
      const over = ctx({ serverMessage: message });
      expect(transformCauseFor(over)).toBeNull();
      expect(() => copy.actions(over)).not.toThrow();
      expect(copy.attribution(over).length).toBeGreaterThan(20);
      expect(copy.consequence(over).length).toBeGreaterThan(20);
      expect(labels(over)).toEqual(["Open the output settings", "Try building it again"]);
    }
  });

  test("a supplier's own refusal sentence degrades to the fallback, knowingly", () => {
    // When the acceptance profile carries its own reason, THAT sentence is what
    // reaches errorMessage — written by whoever set the rule, so no pattern can
    // recognise it. Pinned so the limit is a decision on the record rather than a
    // surprise: the generic copy is wrong-ish here, and guessing would be worse.
    const ownReason = "Orders under EUR 250 are not accepted on this account.";
    expect(transformCauseNameFor(ownReason)).toBeNull();
    expect(labels(ctx({ serverMessage: ownReason }))).toEqual([
      "Open the output settings",
      "Try building it again",
    ]);
  });
});
