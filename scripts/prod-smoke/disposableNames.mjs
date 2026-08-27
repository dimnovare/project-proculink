/**
 * Every Clerk-visible name the production smoke run creates, built in ONE place.
 *
 * SPLIT OUT OF clerk-disposable.mjs SO IT CAN BE TESTED. That file runs its CLI
 * on import — `commands[command]()` at the bottom — so importing it from a test
 * exits the process. This module has no side effects and no I/O, which is what
 * lets src/test/prodSmokeNames.test.ts CALL these functions instead of pattern-
 * matching the source of them.
 *
 * ── WHY THE NAMES CANNOT CARRY THE RUN ID ────────────────────────────────────
 *
 * Clerk refuses any name that parses as a phone number, and a GitHub run id is
 * an eleven-digit number. It broke production monitoring twice in fourteen hours:
 *
 *   2026-08-26 19:30   first_name   "Smoke33005458702-1"            -> HTTP 422
 *   2026-08-27 09:39   organization "…-ci-smoke-33059511557-1"      -> HTTP 422
 *
 * The second is the one worth remembering. The first was diagnosed correctly and
 * fixed correctly — and the fix moved the break one API call down the same
 * function, because the defect was never "this string", it was "any string we
 * send Clerk that carries the run id". Fixing the instance left the class open.
 * It was only caught because the fix was proved with a real run rather than
 * declared done.
 *
 * The failure is also invisible until it happens: it depends on which run ids
 * GitHub is issuing, so it passed for months and will not clear on its own. And
 * it kills the job in ~30 seconds, before any test executes, so the smoke run
 * reports failure with no report to read.
 *
 * The raw run id therefore reaches no name at all. It survives in
 * `public_metadata`, which Clerk does not validate, so a stray object can still
 * be traced back to the run that made it.
 */

/** Prefix every disposable object carries. Cleanup refuses to delete anything without it. */
export const DISPOSABLE_PREFIX = "proculink-ci-smoke";

/**
 * Each digit becomes a letter: 0->a, 1->b … 9->j. Everything else is untouched,
 * so a run id's "-" separator survives.
 *
 * A substitution, not a hash, and deliberately so. It is one-to-one, so
 * uniqueness is preserved exactly and two run ids can never collide; and it is
 * reversible by eye, which is what matters when the only trace of a failed
 * cleanup is a name in the Clerk dashboard.
 */
export function digitsAsLetters(value) {
  return String(value).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
}

/** The inverse, for a human decoding a name back to its run. */
export function lettersAsDigits(value) {
  return String(value).replace(/[a-j]/g, (c) => String("abcdefghij".indexOf(c)));
}

/**
 * @param {string} runId  `${github.run_id}-${github.run_attempt}`
 * @param {string} domain email domain for the disposable address
 */
export function disposableNames(runId, domain) {
  const safe = digitsAsLetters(runId);
  const slug = `${DISPOSABLE_PREFIX}-${safe}`;
  return {
    slug,
    // The local part could keep digits — Clerk validates NAMES, not addresses —
    // but it is built from the same token so every artefact of one run carries
    // the same recognisable suffix.
    email: `${slug}@${domain}`,
    // The dashboard greets by first name (DashboardContextLine), so a unique
    // value here is the one assertion in the suite that can only pass if a real
    // Clerk session hydrated in a real browser against production.
    firstName: `Smoke${safe}`,
    // Must keep DISPOSABLE_PREFIX: cleanup refuses to delete an organisation
    // whose name does not start with it.
    orgName: slug,
  };
}
