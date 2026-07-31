// outputRuleModel — the pure rule writers behind the output designer.
//
// WHY THIS FILE EXISTS. Both rule writers used to rebuild `rule` from a five-key
// object literal:
//
//   rule: { outputPath, canonicalField, sourceToken, fixedValue, fieldManipulators }
//
// `OutputFieldRule` on the BACKEND carries more than that — `Expression`
// (`OrderMappingOverride.cs:117`) sits at the TOP of the resolution precedence
// chain (`MappedTransformService.ResolveExpressionOrField`). A literal that names
// five keys silently drops every key it does not name, so an author who wrote an
// expression in the template editor and then rebound a node, or changed its date
// format, lost the expression — and the delivered document quietly changed.
//
// The rule is now built by SPREADING the previous rule, so a field this file has
// never heard of survives a round trip. That is the property the tests pin, and it
// is the one that stops the next backend field from being destroyed by the same
// bug.

import type { OutputFieldRule, ManipulatorEntry } from "@/lib/api/types";

/** The three mutually exclusive ways a node can be bound to a value. */
export type BindingKey = "canonicalField" | "sourceToken" | "fixedValue";

const BINDING_KEYS: readonly BindingKey[] = ["canonicalField", "sourceToken", "fixedValue"];

/**
 * Rebind a node's rule to exactly ONE source, clearing the other two.
 *
 * `outputPath` is re-synced to the node name on every write — the emitter reads it,
 * and a renamed node whose rule still points at the old path binds nothing.
 */
export function withBinding(
  prev: OutputFieldRule | null | undefined,
  nodeName: string,
  key: BindingKey,
  value: string | null,
): OutputFieldRule {
  const next: OutputFieldRule = {
    ...(prev ?? { outputPath: nodeName, fieldManipulators: [] }),
    outputPath: nodeName,
    fieldManipulators: prev?.fieldManipulators ?? [],
  };
  // Written as a loop over BINDING_KEYS rather than three literal properties, so
  // adding a fourth binding kind cannot leave one of them un-cleared — the exclusivity
  // is the invariant, not the three names.
  for (const k of BINDING_KEYS) (next as Record<BindingKey, string | null>)[k] = k === key ? value : null;
  return next;
}

/**
 * Replace the node's ONE format manipulator, keeping every other step in the stack
 * and its order. `formatTypes` is passed in rather than imported so this module
 * stays free of the designer's presentation constants.
 */
export function withFormatManipulator(
  prev: OutputFieldRule | null | undefined,
  nodeName: string,
  formatTypes: ReadonlySet<string>,
  next: ManipulatorEntry | null,
): OutputFieldRule {
  const others = (prev?.fieldManipulators ?? []).filter((m) => !formatTypes.has(m.type));
  return {
    ...(prev ?? { outputPath: nodeName, fieldManipulators: [] }),
    outputPath: nodeName,
    fieldManipulators: next ? [...others, next] : others,
  };
}

/** Replace the whole manipulator stack, preserving every other rule field. */
export function withManipulators(
  prev: OutputFieldRule | null | undefined,
  nodeName: string,
  fieldManipulators: ManipulatorEntry[],
): OutputFieldRule {
  return {
    ...(prev ?? { outputPath: nodeName, fieldManipulators: [] }),
    outputPath: nodeName,
    fieldManipulators,
  };
}
