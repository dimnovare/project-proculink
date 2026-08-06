// outputConditionModel — the structured ⇄ raw round trip behind "only include when…" (WP-16 · S12).
//
// `OutputNode.includeWhen` is a BARE Scriban boolean the emitter wraps as `{{ ( … ) }}`
// (OutputTemplateEmitter.cs:348). Until now the designer's only editor for it was a text input, so
// every conditional in the product was authored by someone who already knew Scriban — and the
// emitter FAILS OPEN (OutputTemplateEmitter.cs:353-363), so a predicate with a typo does not error,
// it silently includes the value. A wrong condition therefore produces a plausible file.
//
// This module is the pure half of the builder. It exists as its own file for the reason
// `outputRuleModel` does: the guarantee that matters is a ROUND TRIP, and a round trip is a property
// of two functions, not of a React component.
//
// TWO RULES GOVERN EVERYTHING HERE.
//
//  1. **Emit exactly what a hand-author would have written.** The generated predicate is shown to the
//     user in mono under the builder, so it is also documentation. If the builder emitted a dialect
//     of its own, the raw escape hatch would teach the wrong thing.
//
//  2. **Refuse to parse anything the builder could not have emitted.** A parser that half-understands
//     an expression is worse than no parser: it opens the structured editor on a predicate it cannot
//     represent, and the next save REWRITES the author's expression into an approximation of it.
//     Every rejection below returns null, and null means "show it raw, exactly as written".

/** The six operators offered. Text fields get the first four; numbers get all six. */
export type ConditionOperator = "is" | "isNot" | "isEmpty" | "isNotEmpty" | "isMoreThan" | "isLessThan";

/**
 * Which of `ScribanFieldEvaluator`'s two scopes this node sits in. A node inside a repeating list
 * reads `line.*`; anything else reads `order.*`.
 */
export type ConditionScope = "line" | "order";

export interface StructuredCondition {
  scope: ConditionScope;
  field: string;
  operator: ConditionOperator;
  /** The compared value. Empty and ignored for `isEmpty` / `isNotEmpty`. */
  value: string;
}

/** Plain-English operator labels — this is the whole point of the builder, so they are not jargon. */
export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: "is",
  isNot: "is not",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  isMoreThan: "is more than",
  isLessThan: "is less than",
};

/**
 * The row-bag keys that hold real numbers rather than strings (`OutputNode.cs:77-78`).
 *
 * This list is the guard against the one bug a coordinator could never find: Scriban compares two
 * strings lexically, so `"10" > "9"` is FALSE. A layout built on that drops exactly the lines the
 * author meant to keep, and the resulting file is perfectly plausible. So `>` and `<` are offered on
 * these fields ONLY, and their values — plus equality against them — emit unquoted.
 */
export const NUMERIC_CONDITION_FIELDS: readonly string[] = [
  "Quantity", "UnitPrice", "LineTotal", "LineAmount", "LineNumber",
  "TaxRate", "SubTotal", "TaxTotal", "GrandTotal",
];

export function isNumericConditionField(field: string): boolean {
  return NUMERIC_CONDITION_FIELDS.includes(field);
}

const TEXT_OPERATORS: readonly ConditionOperator[] = ["is", "isNot", "isEmpty", "isNotEmpty"];
const NUMERIC_OPERATORS: readonly ConditionOperator[] = [...TEXT_OPERATORS, "isMoreThan", "isLessThan"];

/** The operators offered for a field. Ordering is the dropdown's ordering. */
export function operatorsForField(field: string): ConditionOperator[] {
  return [...(isNumericConditionField(field) ? NUMERIC_OPERATORS : TEXT_OPERATORS)];
}

/** False for the emptiness operators — their value input is hidden, not merely ignored. */
export function operatorTakesValue(op: ConditionOperator): boolean {
  return op !== "isEmpty" && op !== "isNotEmpty";
}

/** A Scriban string literal. Backslash first, or the quote escape would be escaped again. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(literal: string): string {
  return literal.replace(/\\(.)/g, "$1");
}

/** A decimal literal, optionally negative. Anything else is not a number the builder wrote. */
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
/** A complete, properly terminated Scriban string literal and nothing else. */
const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;

/**
 * Render the predicate. This is the exact text the emitter evaluates, and the exact text shown to the
 * user under the builder — the two must not diverge, because the second is how a power user learns to
 * write the first.
 */
export function buildPredicate(c: StructuredCondition): string {
  const ref = `${c.scope}.${c.field}`;
  switch (c.operator) {
    case "isEmpty": return `${ref} == ""`;
    case "isNotEmpty": return `${ref} != ""`;
    case "isMoreThan": return `${ref} > ${c.value}`;
    case "isLessThan": return `${ref} < ${c.value}`;
    case "is":
    case "isNot": {
      const op = c.operator === "is" ? "==" : "!=";
      // A numeric field holds a number, so quoting its value would make BOTH sides strings and turn
      // the comparison lexical — the same trap `>` is restricted for.
      const rhs = isNumericConditionField(c.field) && NUMBER_LITERAL.test(c.value.trim())
        ? c.value.trim()
        : quote(c.value);
      return `${ref} ${op} ${rhs}`;
    }
  }
}

/** `scope.Field <op> <rhs>` and nothing else. Anchored, so a compound expression never matches. */
const PREDICATE = /^(line|order)\.([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>|<)\s*(.+)$/;

/**
 * Read a saved predicate back into the builder, or return null to leave it raw.
 *
 * `expectedScope` and `allowedFields` are what this NODE can offer — a predicate naming anything else
 * is refused rather than coerced. Both refusals guard the same failure the format control shipped
 * once: a control whose value matches no option renders blank, and the next save writes the blank.
 */
export function parsePredicate(
  raw: string | null | undefined,
  expectedScope: ConditionScope,
  allowedFields: readonly string[],
): StructuredCondition | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;

  const m = PREDICATE.exec(text);
  if (!m) return null;

  const [, scope, field, op, rhsRaw] = m;
  if (scope !== expectedScope) return null;
  if (!allowedFields.includes(field)) return null;

  const rhs = rhsRaw.trim();
  const numeric = isNumericConditionField(field);

  if (op === ">" || op === "<") {
    // Numeric-only, and the right-hand side must be a number. A quoted RHS here is the lexical-
    // comparison bug written down; parsing it into the builder would launder it into a saved state
    // the builder claims to own.
    if (!numeric || !NUMBER_LITERAL.test(rhs)) return null;
    return { scope, field, operator: op === ">" ? "isMoreThan" : "isLessThan", value: rhs };
  }

  const equality = op === "==";

  if (rhs === '""') {
    return { scope, field, operator: equality ? "isEmpty" : "isNotEmpty", value: "" };
  }

  const str = STRING_LITERAL.exec(rhs);
  if (str) {
    return { scope, field, operator: equality ? "is" : "isNot", value: unquote(str[1]) };
  }

  if (numeric && NUMBER_LITERAL.test(rhs)) {
    return { scope, field, operator: equality ? "is" : "isNot", value: rhs };
  }

  // A bare identifier (a field-to-field comparison), an unterminated string, a number against a text
  // field — all real Scriban the builder has no shape for. Raw, unchanged.
  return null;
}
