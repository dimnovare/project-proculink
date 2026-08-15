import { describe, test, expect } from "vitest";
import {
  PROBLEM_COPY,
  TRANSFORM_CAUSE_NAMES,
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
  // :698-699 — the template / output-mapping failure this state was written for.
  // The tail after ": " is the inner engine exception and varies.
  output_mapping_failed:
    "The published output mapping for this connection could not be applied, so the order was not delivered: "
    + "Object reference not set to an instance of an object.",
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

/**
 * The single spine every loop in this file runs on.
 *
 * It was `Object.keys(MESSAGE)` inline, fourteen times over, with nothing asserting
 * how many keys that is — so a record that lost entries would have made every
 * `for` and every `test.each` iterate over what was left, or over nothing, and pass.
 * The floor immediately below is what makes the rest of the file mean something.
 */
const CAUSES = Object.keys(MESSAGE) as TransformCauseName[];

/** Real backend sentences that reach `errorMessage` and that NO matcher recognises. */
const UNRECOGNISED = {
  // ProcuLink.Transform/Output/TransformValidationException.cs — thrown by the CSV,
  // JSON, XML, Scriban and mapped transformers and by OutputFieldValidator, then
  // caught by TransformCoreAsync's terminal handler and written out verbatim. It is
  // a LINE problem, and the old fallback answered it with the output-settings copy.
  lineValidation: "Cannot transform: lines 2, 5 still need review.",
  // ScribanTemplateTransformService.cs:77 — the engine's own compile error, raw.
  templateEngine: "Scriban: (12,5) : error : Cannot get member on a null object",
  // The acceptance profile's own sentence, written by whoever set the rule.
  supplierOwnReason: "Orders under EUR 250 are not accepted on this account.",
  // A reword of a message we DO recognise today — the shape backendMirror.test.ts
  // now fails on, kept here for what the panel does in the window before it does.
  rewordedCause: "We could not get this order ready to send. Please try again shortly.",
  future: "A sentence written by a future version of the API.",
} as const;

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
    accountStatus: null,
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

describe("the walks below are not empty walks", () => {
  // THE FLOOR. Everything else in this file is a loop or a `test.each` over CAUSES.
  // A record that shrank would shrink every one of them silently — `for (const c of
  // [])` runs zero assertions and reports a pass, and `test.each([])` does not even
  // register a case. Nothing here asserted the size, so the whole suite could have
  // been hollowed out one key at a time without a single red run.

  test("the fixtures cover exactly the causes the table names", () => {
    // Both directions, from the registry that OWNS the list rather than from a
    // second hand-typed copy of it. A matcher with no message fixture would go
    // untested; a fixture with no matcher would test a cause that cannot happen.
    expect([...CAUSES].sort()).toEqual([...TRANSFORM_CAUSE_NAMES].sort());
  });

  test("there are six of them, and the table declares each once", () => {
    // The literal count is the part that cannot drift quietly: the set-equality
    // above stays green if a cause is deleted from BOTH sides in the same edit.
    expect(CAUSES).toHaveLength(6);
    expect(TRANSFORM_CAUSE_NAMES).toHaveLength(6);
    expect(new Set(TRANSFORM_CAUSE_NAMES).size, "a cause is declared twice").toBe(6);
  });

  test("every fixture is a real sentence, not an empty placeholder", () => {
    // `MESSAGE[cause] = ""` would keep the key, keep the count, and match nothing.
    for (const cause of CAUSES) {
      expect(MESSAGE[cause].length, cause).toBeGreaterThan(30);
    }
  });

  test("the unrecognised fixtures really are unrecognised", () => {
    // They anchor every assertion in the last describe. If a matcher widened far
    // enough to claim one of them, those assertions would silently start testing a
    // recognised cause against the unrecognised contract.
    for (const [name, message] of Object.entries(UNRECOGNISED)) {
      expect(transformCauseNameFor(message), `${name} is now claimed by a matcher`).toBeNull();
    }
    expect(Object.keys(UNRECOGNISED).length).toBeGreaterThanOrEqual(5);
  });
});

describe("every message the backend can write here is recognised", () => {
  test.each(CAUSES)("%s is matched by its real message", (cause) => {
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
    for (const claimed of CAUSES) {
      for (const written of CAUSES) {
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

  /** The only two causes where waiting is genuinely enough. */
  const HEALS: readonly TransformCauseName[] = ["preparation_failed", "rules_check_failed"];

  test.each(CAUSES)(
    "%s never says we won't try again — the Worker does",
    (cause) => {
      const line = copy.automaticFor(forCause(cause));
      expect(line.length).toBeGreaterThan(15);
      expect(line, `"${line}" denies a retry the backend performs`).not.toMatch(RETRY_DENIAL);
    },
  );

  test("the unrecognised case does not deny it either — the same job retries whatever it was", () => {
    for (const message of [...Object.values(UNRECOGNISED), null]) {
      const line = copy.automaticFor(ctx({ serverMessage: message }));
      expect(line, `"${line}" denies a retry the backend performs`).not.toMatch(RETRY_DENIAL);
      expect(line.length).toBeGreaterThan(15);
    }
  });

  test("only the two causes a retry can fix promise that it is being handled", () => {
    // "We're trying again automatically" is a promise that waiting is enough. It
    // is true for an unexpected fault and for a rules check that could not run —
    // and false for the four where the same inputs fail the same way, and for a
    // message we could not read at all, where we do not know which of those it is.
    for (const cause of CAUSES) {
      const line = copy.automaticFor(forCause(cause));
      expect(
        /trying again automatically/i.test(line),
        `${cause}: "${line}"`,
      ).toBe(HEALS.includes(cause));
    }
    expect(/trying again automatically/i.test(copy.automaticFor(ctx()))).toBe(false);
  });

  test("a cause that cannot heal says so in the same breath as the tries", () => {
    // Derived from the healing pair rather than retyped, so a cause added to the
    // table joins this walk instead of quietly sitting outside it.
    const cannotHeal = CAUSES.filter((c) => !HEALS.includes(c));
    expect(cannotHeal).toHaveLength(4);
    for (const cause of cannotHeal) {
      expect(copy.automaticFor(forCause(cause)), cause).toMatch(/every time|each time/i);
    }
  });

  test("the outage note is still appended for every cause", () => {
    for (const cause of CAUSES) {
      expect(copy.automaticFor(forCause(cause, { processingPaused: true }))).toMatch(/paused/i);
    }
    expect(copy.automaticFor(ctx({ processingPaused: true }))).toMatch(/paused/i);
  });
});

describe("the tier says who has to act, and it is honest about it", () => {
  test.each([
    ["output_mapping_failed", "self"],
    ["unresolved_lines", "self"],
    ["preparation_failed", "wait"],
    ["no_builder_for_format", "self"],
    ["rules_check_failed", "wait"],
    ["rules_refused", "self"],
  ] as const)("%s is a %s", (cause, tier) => {
    expect(copy.tier(forCause(cause))).toBe(tier);
  });

  test("the tier walk covers every cause", () => {
    // The `test.each` table above is hand-typed. Without this, a cause added to the
    // table simply never gets a tier assertion — and `us` vs `self` is the
    // difference between "we'll look at it" and "go and fix your settings".
    expect(CAUSES).toHaveLength(6);
  });

  test("an infrastructure fault is never the operator's to fix", () => {
    // "self" on the health page means "you can fix this". A DB blip is not
    // something a purchasing coordinator can do anything about, and the backend
    // is already retrying it.
    expect(copy.tier(forCause("preparation_failed"))).not.toBe("self");
    expect(copy.tier(forCause("rules_check_failed"))).not.toBe("self");
  });

  test("a message we could not read is never the operator's to fix either", () => {
    // It was `self` — "you can fix this" — for every message the table did not
    // recognise, which is a claim about a cause we do not have. `us` is the honest
    // bucket: the panel's second route is "send it to us".
    expect(copy.tier(ctx())).toBe("us");
    for (const message of Object.values(UNRECOGNISED)) {
      expect(copy.tier(ctx({ serverMessage: message })), message).toBe("us");
    }
  });

  test("the template failure this state was written for is still self-serve", () => {
    // It did not stop being fixable — it stopped being the default.
    expect(copy.tier(ctx({ serverMessage: MESSAGE.output_mapping_failed }))).toBe("self");
  });
});

describe("each cause is pointed at something that can actually fix it", () => {
  test("a broken output mapping leads to the output settings, where it is edited", () => {
    const actions = copy.actions(forCause("output_mapping_failed"));
    expect(hrefOf(actions[0])).toBe("/library/suppliers/sup-1?tab=delivery");
    expect(variantOf(actions[0])).toBe("primary");
    expect(labels(forCause("output_mapping_failed"))).toEqual([
      "Open the output settings",
      "Try building it again",
    ]);
  });

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
    for (const cause of CAUSES) {
      const actions = copy.actions(forCause(cause, { supplierId: null, supplier: "this supplier" }));
      expect(actions.length, cause).toBeGreaterThan(0);
      for (const a of actions) {
        if (a.kind === "link") expect(a.href, cause).toBe("/library/suppliers");
      }
    }
  });

  test("a read-only plan disables every rebuild it offers rather than firing a refused POST", () => {
    for (const cause of CAUSES) {
      for (const a of copy.actions(forCause(cause, { readOnly: true }))) {
        if (a.kind === "post") expect(a.disabledReason, cause).toBeTruthy();
      }
    }
  });

  test("only the transform rebuild is ever posted — no cause invents an endpoint", () => {
    for (const cause of CAUSES) {
      for (const a of copy.actions(forCause(cause))) {
        if (a.kind === "post") expect(a.op).toBe("transformOrder");
      }
    }
  });
});

describe("the copy says what to do, not what happened", () => {
  test.each(CAUSES)("%s never repeats the server message", (cause) => {
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

  test.each(CAUSES)("%s answers all five questions", (cause) => {
    expect(copy.attribution(forCause(cause)).length).toBeGreaterThan(20);
    expect(copy.consequence(forCause(cause)).length).toBeGreaterThan(20);
    expect(copy.automaticFor(forCause(cause)).length).toBeGreaterThan(15);
    expect(copy.actions(forCause(cause)).length).toBeGreaterThan(0);
  });

  test.each(CAUSES)("%s names the supplier where it matters", (cause) => {
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
    for (const cause of CAUSES) {
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

// ─────────────────────────────────────────────────────────────────────────────
// An unrecognised message used to render the MOST confident copy in the table.
//
// `transformCauseFor` returns null for anything no matcher reads, and the base
// entry it then fell through to was the template/mapping copy — so "we don't know"
// came out as "the output we build for BoltWorks BV isn't [fine]", "every future
// order for them will stop in the same place", a primary CTA to the supplier's
// Delivery tab, and "building it again won't help".
//
// The defence was that this preserved pre-table behaviour. It did — and pre-table
// behaviour was written when transform_failed meant one thing. It already misread a
// message the backend writes today: TransformValidationException's "Cannot
// transform: lines 2, 5 still need review." is a LINE problem, and it was answered
// with a settings screen. This repo's own v2 audit found six independent instances
// of an unknown value resolving to a confident claim; this was the seventh.
//
// BOTH DIRECTIONS BELOW, on purpose. Vague copy everywhere would satisfy the first
// half and fail the second.
// ─────────────────────────────────────────────────────────────────────────────
describe("an unrecognised message says what is known, and nothing more", () => {
  /** The four claims that belong to output_mapping_failed and to nothing else. */
  const TEMPLATE_CLAIMS = {
    "blames the output we build": /the output we build for .* isn'?t/i,
    "predicts every future order": /every future order/i,
    "sends them to the output settings": /^Open the output settings$/,
    "says a rebuild is pointless": /building it again won'?t help/i,
  } as const;

  const rendered = (c: ProblemCtx) =>
    [
      copy.attribution(c),
      copy.consequence(c),
      copy.helper!(c) ?? "",
      copy.automaticFor(c),
      ...labels(c),
    ].join("\n");

  const UNKNOWN_INPUTS: Array<[string, string | null]> = [
    ...Object.entries(UNRECOGNISED),
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    // Unvalidated off the wire, and these three index Object.prototype to something
    // truthy — the hazard `transformCauseFor` is shaped to avoid.
    ["constructor", "constructor"],
    ["__proto__", "__proto__"],
    ["toString", "toString"],
  ];

  test.each(UNKNOWN_INPUTS)("%s makes none of the template/mapping claims", (_name, message) => {
    const over = ctx({ serverMessage: message });
    expect(transformCauseFor(over)).toBeNull();
    const said = rendered(over);
    for (const [claim, re] of Object.entries(TEMPLATE_CLAIMS)) {
      expect(
        said.split("\n").some((line) => re.test(line)),
        `an unrecognised message ${claim}:\n${said}`,
      ).toBe(false);
    }
  });

  test.each(UNKNOWN_INPUTS)("%s still says what IS known, and offers the rebuild", (_name, message) => {
    const over = ctx({ serverMessage: message });
    expect(() => copy.actions(over)).not.toThrow();
    // The two facts that hold for every failure that reaches this status.
    expect(copy.consequence(over)).toContain("has not received this order");
    expect(copy.attribution(over).length).toBeGreaterThan(20);
    expect(copy.consequence(over).length).toBeGreaterThan(20);
    // "Keep build again available" — and it is the primary, because it is the one
    // control that presumes nothing about a cause we could not read.
    const rebuild = copy.actions(over).find((a) => a.kind === "post");
    expect(rebuild, "the rebuild disappeared for an unrecognised message").toBeTruthy();
    expect(variantOf(rebuild!)).toBe("primary");
    expect(labels(over)).toEqual(["Try building it again", "Get help with this order"]);
  });

  test("it never invents a retry count or a schedule", () => {
    // Order carries neither number. An invented one is the difference between an
    // operator waiting and escalating on the wrong schedule.
    for (const [, message] of UNKNOWN_INPUTS) {
      const said = rendered(ctx({ serverMessage: message }));
      expect(said).not.toMatch(/attempt \d|\d+ of \d+|in \d+ (second|minute|hour)/i);
    }
  });

  test("the message itself is never paraphrased back at the operator", () => {
    // It is rendered verbatim in its own block above these lines.
    for (const message of Object.values(UNRECOGNISED)) {
      expect(rendered(ctx({ serverMessage: message }))).not.toContain(message);
    }
  });

  // ── The other direction ────────────────────────────────────────────────────
  // Everything above passes trivially if every cause is flattened to vague copy.

  test("the template failure still makes ALL of the claims that are true of it", () => {
    const over = ctx({ serverMessage: MESSAGE.output_mapping_failed });
    expect(transformCauseNameFor(MESSAGE.output_mapping_failed)).toBe("output_mapping_failed");
    const lines = rendered(over).split("\n");
    for (const [claim, re] of Object.entries(TEMPLATE_CLAIMS)) {
      expect(lines.some((line) => re.test(line)), `output_mapping_failed no longer ${claim}`).toBe(true);
    }
  });

  test("every recognised cause still says something the others do not", () => {
    // Six causes, six distinct attributions and six distinct action sets. Collapse
    // any two of them into the same words and this fails.
    const attributions = CAUSES.map((c) => copy.attribution(forCause(c)));
    expect(new Set(attributions).size, `two causes share an attribution:\n${attributions.join("\n")}`).toBe(6);
    const routes = CAUSES.map((c) => labels(forCause(c)).join(" | "));
    expect(new Set(routes).size).toBeGreaterThanOrEqual(4);
    // And none of them is the unrecognised copy.
    const unknown = copy.attribution(ctx());
    for (const cause of CAUSES) {
      expect(copy.attribution(forCause(cause)), cause).not.toBe(unknown);
    }
  });

  test("a supplier's own refusal sentence degrades knowingly, and no longer misroutes", () => {
    // When the acceptance profile carries its own reason, THAT sentence is what
    // reaches errorMessage — written by whoever set the rule, so no pattern can
    // recognise it. Pinned so the limit stays a decision on the record. What
    // changed is the landing: it used to be told its output settings were broken.
    expect(transformCauseNameFor(UNRECOGNISED.supplierOwnReason)).toBeNull();
    expect(labels(ctx({ serverMessage: UNRECOGNISED.supplierOwnReason }))).toEqual([
      "Try building it again",
      "Get help with this order",
    ]);
  });
});
