/**
 * A supplier's response body, made fit to read as a sentence.
 *
 * WHY THIS EXISTS. When a delivery fails, the backend captures the supplier endpoint's response
 * body deliberately — `HttpDeliveryDispatcher.CapturesSupplierResponseBody` is true because that
 * body is real evidence of what the endpoint said. The Order Problem panel then used it directly
 * as the operator's explanation (`rejectionReason ?? serverMessage ?? fallback`).
 *
 * That is right when a supplier answers with a sentence. It is wrong when they answer with a web
 * page: the first authenticated production pass hit a 404 whose body was an HTML error page, and
 * the operator was shown its markup as the reason their order failed
 * (`docs/qa/2026-08-01-wp-39-authenticated-production-pass.md` §4.4).
 *
 * Not a security fix — React escapes this, so nothing executes. It is a legibility fix: markup
 * rendered as prose tells the operator nothing and looks broken.
 *
 * DELIBERATELY CONSERVATIVE. The evidence itself is never destroyed — the full body stays in the
 * order passport, which is where an integrator goes to read exactly what came back. This only
 * decides what is fit to appear in a sentence, and when it cannot find one it returns null so the
 * caller falls through to copy written for a human.
 */

/** Longest supplier-supplied string we will inline into operator copy. */
export const SUPPLIER_REASON_MAX = 180;

const BLOCKISH = /<\/(p|div|br|li|tr|h[1-6])\s*>|<br\s*\/?>/gi;
const TAG = /<[^>]*>/g;
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * True when the value looks like markup or a serialised payload rather than a sentence a person
 * wrote. Kept separate from the cleaning so a caller can ask the question without changing the text.
 */
export function looksLikeMarkupOrPayload(value: string): boolean {
  const v = value.trim();
  if (/^<[!?a-z]/i.test(v)) return true;              // <!DOCTYPE html>, <html>, <?xml
  if (/^[[{]/.test(v) && /[\]}]$/.test(v)) return true; // a JSON body
  return /<\/?[a-z][^>]*>/i.test(v);                   // any tag anywhere
}

/**
 * The readable sentence inside a supplier response, or null when there is not one.
 *
 * Returning null rather than a truncated mess is the point: the caller has copy written for a
 * human, and no explanation beats an unintelligible one.
 */
export function supplierReasonText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A plain sentence is passed through untouched apart from length. This is the common case —
  // suppliers that answer properly must not be reformatted.
  if (!looksLikeMarkupOrPayload(trimmed)) return clamp(trimmed);

  // A JSON body usually carries the real sentence in a named field. Lift it rather than either
  // showing the operator a brace-blob or throwing away a message the supplier did write.
  const fromJson = messageFromJson(trimmed);
  if (fromJson !== undefined) return fromJson === null ? null : clamp(fromJson);

  const text = trimmed
    .replace(SCRIPT_OR_STYLE, " ")  // drop bodies wholesale — their content is never a reason
    .replace(BLOCKISH, " ")         // block boundaries become spaces, so words do not fuse
    .replace(TAG, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Nothing legible survived — an HTML page whose visible text was only chrome, or a JSON blob of
  // ids. Say nothing and let the caller's own copy explain the failure.
  if (text.length < 3) return null;
  if (!/[a-z]/i.test(text)) return null;

  return clamp(text);
}

/**
 * The message inside a JSON body.
 *
 * Returns the string when one of the conventional fields holds it, `null` when the body is JSON but
 * carries no sentence (an id blob explains nothing), and `undefined` when it is not JSON at all so
 * the caller keeps going.
 */
function messageFromJson(value: string): string | null | undefined {
  if (!/^[[{]/.test(value) || !/[\]}]$/.test(value)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null; // shaped like JSON, is not JSON — nothing readable to lift
  }
  if (typeof parsed === "string") return parsed.trim() || null;
  if (typeof parsed !== "object" || parsed === null) return null;
  for (const key of ["error", "message", "detail", "description", "reason", "title"]) {
    const found = (parsed as Record<string, unknown>)[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  return null;
}

function clamp(value: string): string {
  if (value.length <= SUPPLIER_REASON_MAX) return value;
  // Cut on a word boundary when one is near the limit, so the tail is not a severed word.
  const cut = value.slice(0, SUPPLIER_REASON_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > SUPPLIER_REASON_MAX - 40 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}
