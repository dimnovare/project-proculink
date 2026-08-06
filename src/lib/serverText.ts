/**
 * The one door between a server's response body and operator-facing prose.
 *
 * WHY THIS EXISTS. Three separate carriers bring a server-authored string to the screen:
 *
 *   1. `ApiHttpError.message` — api-client builds it as `error ?? \`${fallback}: ${responseText}\``,
 *      and `parseApiErrorBody` only lifts a sentence when the body is JSON carrying a conventional
 *      field. A Railway or Vercel 502 answers with an HTML error page, so the raw markup lands in
 *      the message that ~80 call sites render.
 *   2. `order.errorMessage` / `deliveryAttempts[*].errorMessage` / `rejectionReason` — persisted
 *      fields that arrive on a 200. The backend concatenates the supplier's response body after its
 *      own sentence ("Response summary: …"), so these carry markup too.
 *   3. `deadLetterOrder.lastError`, `catalogSource.lastSyncError` — the same, on other payloads.
 *
 * On 2026-08-06 an authenticated production pass found carrier 2 showing an operator
 * `<!DOCTYPE html> <html> <head>` as the reason their order failed. FE #94 had been written to
 * prevent exactly that and did not, because it wrapped one operand while the markup arrived on
 * another; FE #98 fixed that operand and found this file's carriers 1 and 3 still open.
 *
 * ONE SANITISER, NOT TWO. `supplierReasonText` already does this job well and is tested against the
 * literal production strings. It is re-exported here rather than reimplemented — two sanitisers that
 * disagree is a worse outcome than one imperfect one. This module is the single place in `src/lib`
 * that reaches into `src/components/bridge/problem/`, so if that file ever moves there is exactly
 * one import to update.
 *
 * WHERE EACH CARRIER IS CLEANED, AND WHY THEY DIFFER:
 *
 *   • Carrier 1 is cleaned at CONSTRUCTION — inside `ApiHttpError` (see `src/lib/api/core.ts`).
 *     Nothing pattern-matches on the markup half of these messages, and a per-site fix has now
 *     failed to close this defect twice, so the possibility is removed instead of patched: an
 *     ApiHttpError cannot be built carrying markup, from any throw site, including one added later.
 *
 *   • Carriers 2 and 3 are cleaned at the RENDER BOUNDARY, with `serverReason` below. They must
 *     stay raw in the data layer because production logic reads them:
 *     `problemCopy.isDeliveryConfigMissing` matches `/delivery config(uration)? is missing/i` on
 *     `order.errorMessage` to decide whether to offer the "add a delivery endpoint" arm. Cleaning
 *     them at the source would trade a cosmetic defect for a functional one.
 *
 * The evidence is never destroyed either way: the untouched body stays on the order passport, which
 * is where an integrator goes to read exactly what came back.
 */

import { supplierReasonText } from "@/components/bridge/problem/supplierReasonText";

export { supplierReasonText };

/**
 * A server-authored string made fit to render, or the caller's own copy when it is not fit at all.
 *
 * `supplierReasonText` returns null when nothing legible survives — an HTML page whose visible text
 * was only chrome, a JSON blob of ids, an empty body. That is deliberate: no explanation beats an
 * unintelligible one, and every caller here has copy written for a human to fall back to.
 */
export function serverReason(raw: string | null | undefined, fallback: string): string {
  return supplierReasonText(raw) ?? fallback;
}

/**
 * The same, for a caller that would rather render nothing than a fallback sentence.
 *
 * Used where the surrounding copy already explains the failure and this string is only extra detail
 * (a table cell, a tooltip), so an unreadable body should simply disappear.
 */
export function serverReasonOrNull(raw: string | null | undefined): string | null {
  return supplierReasonText(raw);
}

/**
 * The message an `ApiHttpError` carries, once it is fit for a person to read.
 *
 * Called by the `ApiHttpError` constructor, so it runs on EVERY api failure in the app. Two rules
 * follow from that:
 *
 *   • A plain sentence must come back byte-for-byte. Real code matches on these strings —
 *     `isPlanGateError` looks for `<capability>_requires_<plan>`, `isRequestTimeout` anchors on
 *     `/^Request timed out after \d+ms$/`, `AssignSupplierBanner` strips a known prefix. Rewording
 *     any of them would trade a cosmetic defect for a functional one. `supplierReasonText` returns
 *     a non-markup input unchanged apart from a 320-character clamp, which is what makes this safe.
 *
 *   • When nothing legible survives, the raw string must NOT be passed through — that is the defect
 *     itself. The status is all that is honestly known at this layer, so that is what it says.
 *
 * A BODY THAT IS BARE JSON IS LEFT EXACTLY AS IT ARRIVED. `supplierReasonText` would helpfully lift
 * the `error` field out of it, and that broke a real consumer: `planGateUpgradeUrl` pulls the
 * `upgradeUrl` value out of a 403's raw message text with a regex, so lifting the sentence deleted
 * the URL the upgrade banner links to (`src/lib/api-client.planGate.test.ts` caught it). Braces in
 * a toast are a separate, milder defect than markup in a sentence, and most throw sites already
 * avoid them via `parseApiErrorBody`. Fixing that one is not worth breaking plan-gate routing.
 */
export function operatorSafeApiMessage(message: string, status: number): string {
  const trimmed = (message ?? "").trim();
  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) return message;
  return supplierReasonText(message) ?? `The server refused this request (HTTP ${status}).`;
}
