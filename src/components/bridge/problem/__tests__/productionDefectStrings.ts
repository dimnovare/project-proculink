/**
 * Strings captured from production, kept verbatim.
 *
 * Not a `.test.ts` on purpose — vitest collects `src/**\/*.{test,spec}.{ts,tsx}`, so this is a
 * plain module both suites import rather than a test file one imports from the other (which would
 * register the same suites twice).
 *
 * The rule these exist to enforce: a guard is fed the defect exactly as it occurred. The first fix
 * for this defect was pinned with a tidied-up HTML page and the real string walked straight past
 * it, so "close enough" input is how a defect survives its own regression test.
 */

/**
 * What order `b56ddb85-5b14-4367-bcc1-6f62a391a6a5` (delivery_dead_letter) put on an operator's
 * screen as the reason their order failed — authenticated production pass, 2026-08-06.
 *
 * It arrives on `order.errorMessage`, NOT on `rejectionReason`: the backend composes its own
 * failure sentence and concatenates the supplier's error page after "Response summary:". That is
 * why the sanitiser, which guarded only `rejectionReason`, never saw it.
 */
export const PRODUCTION_404_ERROR_MESSAGE =
  "HTTP 404: supplier endpoint returned an error. Response summary: " +
  "<!-- Tip: Set the Accept header to application/json to get errors in JSON format. --> " +
  "<!DOCTYPE html> <html> <head>";

/**
 * What the SAME order's passport carried on every delivery attempt, at
 * `deliveryAttempts[*].errorMessage`.
 *
 * Backend-authored operator copy — the 404 row of `SupplierResponseClassification.NamedCauses`,
 * reached through `DescribeFailure`. Likely cause, then the fix, then where the fix is made. It
 * existed the whole time the screen was showing the markup above.
 */
export const PRODUCTION_404_ATTEMPT_MESSAGE =
  "The supplier's endpoint was not found (HTTP 404). The delivery address in this " +
  "supplier's delivery settings has most likely moved or contains a typo — confirm the " +
  "address with the supplier, correct it there, then send the order again.";
