/**
 * refusal.ts — the two different 403s this API answers with, told apart in one place.
 *
 * WHY THIS EXISTS. Until now a 403 meant exactly one thing on the frontend: your plan does not
 * include this, upgrade. The backend then added an organisation-admin role and enforced it on the
 * twelve actions that are irreversible, financial, or able to silently change where an
 * organisation's documents go (`ProcuLink.Api/Auth/RequireOrgAdminAttribute.cs`). Those endpoints
 * can now refuse for EITHER reason, with different fixes:
 *
 *   `requires_org_admin`         you are not an administrator of this organisation.
 *                                Another person can do this. Asking them is the fix.
 *   `<capability>_requires_<plan>`  your plan does not include this. Upgrading is the fix.
 *
 * Confusing them is worse than printing the raw code, in both directions: "upgrade your plan"
 * invents a reason to spend money for someone who merely lacks a role, and "ask an administrator"
 * sends an organisation that needs a bigger plan to a colleague who is equally blocked. The
 * discriminator itself lives in `src/lib/planGate.ts` so the two tests sit next to each other and
 * cannot drift apart; this module is only the api-layer wiring.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH. A plan gate keeps the message it has always had — the raw
 * code, or the raw body when a site kept that. `planGateUpgradeUrl` pulls `upgradeUrl` back out of
 * the raw message text with a regex, and a previous packet broke the upgrade link by sanitising
 * that text out from under it. Only the org-admin case rewrites anything.
 */

import { ApiHttpError } from "./core";
import { isOrgAdminError, orgAdminMessage } from "@/lib/planGate";

/**
 * The org-admin sentence when this failure is that refusal, and `null` for everything else —
 * including a plan-gate 403, which the caller must keep handling exactly as it did before.
 *
 * `raw` may be the parsed `error` code, the whole response body, or a message that quotes either;
 * the match is on the code token, so all three work. For a caller that has already consumed the
 * response body and cannot read it twice.
 */
export function orgAdminRefusal(status: number, raw: string | null | undefined): string | null {
  return status === 403 && isOrgAdminError(raw) ? orgAdminMessage() : null;
}

/** Parse a body without throwing. Returns `null` for an empty or non-JSON body. */
function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The conventional `{ "error": "<code or sentence>" }` field, when the body carries one. */
function errorField(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { error?: unknown }).error;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Read a failed response ONCE and build the error to throw.
 *
 * `fallback` is the message the call site used before — it is still what gets thrown for every
 * failure that is not the org-admin refusal and carries no `error` field, so no existing behaviour
 * changes shape. Returns (rather than throws) so the call site reads `throw await readRefusal(...)`
 * and keeps its own control flow visible.
 *
 * Always an `ApiHttpError`, never a plain `Error`: the parsed body rides along on `.body` for
 * anything that needs the literal response, and `classifyApiFailure` can then see a 403 for what
 * it is instead of guessing "unreachable" and retrying a refusal that will never change its mind.
 */
export async function readRefusal(res: Response, fallback: string): Promise<ApiHttpError> {
  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  const code = errorField(body);

  const admin = orgAdminRefusal(res.status, code ?? text);
  if (admin) return new ApiHttpError(admin, res.status, body);

  return new ApiHttpError(code ?? fallback, res.status, body);
}
