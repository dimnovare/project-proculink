// confirmPolicy — pure decision logic for the send-confirm dialog's
// "Everything checks out / I've reviewed…" checkbox (batch 9 Phase B).
//
// FLAG: NEXT_PUBLIC_CONFIRM_ALWAYS (build-time, Next.js public env).
//   • unset / anything but "false"  → ALWAYS show the checkbox (today's
//     behaviour — the safety ritual on the money action stays untouched).
//   • "false"                       → CONDITIONAL: the checkbox renders only
//     when there is something real to acknowledge — open exceptions, failing
//     acceptance rules, or a validation that is stale (mid auto-revalidate).
//
// The flip is the founder's call (parity gate G8) — default ships today's
// behaviour byte-identical.

export interface ConfirmCheckboxContext {
  exceptionCount: number;
  failingRuleCount: number;
  /** True while the acceptance validation is stale / re-running after a commit. */
  validationStale: boolean;
}

/** Whether the confirm checkbox must render (and be checked) before send. */
export function shouldRequireConfirmCheckbox(
  ctx: ConfirmCheckboxContext,
  confirmAlways: boolean,
): boolean {
  if (confirmAlways) return true;
  return ctx.exceptionCount > 0 || ctx.failingRuleCount > 0 || ctx.validationStale;
}

/**
 * Reads the build-time flag. Kept as a function (not a module const) so the
 * pure decision above stays unit-testable with both flag values.
 * NOTE: the env var must be referenced statically for Next.js to inline it.
 */
export function confirmAlwaysFlag(): boolean {
  return process.env.NEXT_PUBLIC_CONFIRM_ALWAYS !== "false";
}
