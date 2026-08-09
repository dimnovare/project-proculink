// ─────────────────────────────────────────────────────────────────────────────
// Plan-gate error codes (WP-11)
//
// When an endpoint is refused because the org's plan does not include a capability,
// the backend answers 403 with `{ error: "<capability>_requires_<plan>", upgradeUrl }`.
// The plan segment is DERIVED on the server from the gate table
// (`PlanConstants.GetMinimumPlan`), so it changes whenever a feature is re-tiered.
//
// That is the whole point: four codes used to hardcode "integration" for gates whose real
// minimum was Growth, telling a €149 customer to buy the €999 tier. But it means the client
// must never match a code by its full literal — the moment a feature moves tiers, a
// hardcoded check silently stops matching and the customer sees a snake_case token instead
// of a sentence. Match the SHAPE, read the plan out of it.
// ─────────────────────────────────────────────────────────────────────────────

/** Plan ids the backend can name, longest-first so "operations" cannot shadow a prefix. */
const KNOWN_PLANS = [
  "distributor",
  "integration",
  "operations",
  "enterprise",
  "growth",
  "pilot",
] as const;

const PLAN_LABEL: Record<string, string> = {
  pilot: "Pilot",
  growth: "Growth",
  operations: "Operations",
  integration: "Integration",
  distributor: "Distributor",
  enterprise: "Enterprise",
};

/**
 * `<capability>_requires_<plan>` anywhere in the string — API clients often wrap the code in
 * a status line or a JSON fragment, so this deliberately searches rather than anchors.
 * Requires a capability prefix, so a bare word like "requires_attention" does not match.
 */
const PLAN_GATE_CODE = new RegExp(`[a-z0-9]+_requires_(${KNOWN_PLANS.join("|")})\\b`, "i");

/** True when a failure is a plan gate rather than a validation or network error. */
export function isPlanGateError(message: string | null | undefined): boolean {
  return !!message && PLAN_GATE_CODE.test(message);
}

/** The plan the backend said would unlock the capability, or null if it named none we know. */
export function planGateRequiredPlan(message: string | null | undefined): string | null {
  const match = message?.match(PLAN_GATE_CODE);
  return match ? (PLAN_LABEL[match[1].toLowerCase()] ?? null) : null;
}

/**
 * A plain sentence for a plan-gate 403. Names the plan the backend actually asked for, so
 * the upsell can never send a customer to a tier more expensive than the one that unlocks
 * the feature — the exact failure WP-11 fixed on the server side.
 */
export function planGateMessage(message: string | null | undefined): string {
  const plan = planGateRequiredPlan(message);
  return plan
    ? `This is included from the ${plan} plan up. Upgrade to turn it on.`
    : "Your current plan does not include this. Upgrade to turn it on.";
}

// ─────────────────────────────────────────────────────────────────────────────
// The OTHER 403 — the organisation-admin gate
//
// The API also refuses 403 when the caller IS entitled to the capability but is not an
// administrator of their organisation: `{ error: "requires_org_admin", message }`, from
// `ProcuLink.Api/Auth/RequireOrgAdminAttribute.cs` (`ErrorCode`). It guards the twelve
// actions that are irreversible, financial, or able to silently change where an
// organisation's documents go — billing portal and checkout, API-key minting, delivery-config
// writes and deletes, connection publish/rollback, integration creation, the acceptance-gate
// override, and the email/SFTP/S3 ingestion writes.
//
// THIS LIVES BESIDE THE PLAN GATE ON PURPOSE. The only way to get either wrong is to confuse
// it with the other, so the two must be read side by side. Telling someone who merely lacks
// the role to "upgrade your plan" invents a reason to spend money; telling an organisation
// that genuinely needs a bigger plan to "ask an administrator" sends them to a colleague who
// is equally blocked. Both are worse than printing the raw code.
//
// THEY CANNOT COLLIDE, and it is worth being precise about why:
//
//   • A plan gate is matched by SHAPE — `<capability>_requires_<plan>` — and `<plan>` must be
//     one of KNOWN_PLANS. "org_admin" is not a plan and cannot become one without being added
//     to that list, so PLAN_GATE_CODE can never match `requires_org_admin`. (It also needs a
//     `_requires_` substring, and `requires_org_admin` has no underscore before "requires".)
//
//   • ORG_ADMIN_CODE demands the whole token with no word character on either side, so no
//     `<capability>_requires_<plan>` code can contain it either.
//
// Both directions are asserted on the real codes in `planGate.test.ts` and end-to-end through
// the api layer in `src/lib/api/refusal.test.ts`. A test that only covered the new case would
// still pass with the two branches collapsed into one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The literal the backend emits. Mirrors `RequireOrgAdminAttribute.ErrorCode`, which is a C#
 * `const` for the same reason this is exported here: the frontend branches on it, so neither
 * side may retype it at a call site. Pinned to its C# origin by `src/test/backendMirror.test.ts`.
 */
export const ORG_ADMIN_ERROR_CODE = "requires_org_admin";

/**
 * The whole token, with no word character on either side.
 *
 * Deliberately NOT a bare substring test. `webhook_delivery_requires_org_admin` reads as a
 * capability gate and is not a code the API emits; matching it would mean guessing. One
 * constant, one match — anything else falls through to the generic refusal, which is the
 * honest answer for a code we do not recognise.
 *
 * No lookbehind: it is unsupported in older Safari, and `(^|[^A-Za-z0-9_])` is exact here.
 */
const ORG_ADMIN_CODE = /(^|[^A-Za-z0-9_])requires_org_admin(?![A-Za-z0-9_])/i;

/**
 * True when a 403 was refused for lack of the organisation-admin role rather than for lack of
 * a plan. Accepts the `error` code, the whole raw body, or a message that quotes either.
 */
export function isOrgAdminError(message: string | null | undefined): boolean {
  return !!message && ORG_ADMIN_CODE.test(message);
}

/**
 * What to tell the person who was refused.
 *
 * Takes no argument, and that is the point: unlike a plan gate there is nothing to derive from
 * the code. It names one thing — who can do this — because that is the only useful next step.
 *
 * Not an error the reader made, and not one that retrying fixes, so it never says "try again".
 * It does not name a role the product does not have, and it does not send anyone to a Settings
 * screen for managing administrators: roles come from Clerk and ProcuLink deliberately ships no
 * surface for them, so pointing at one would be a dead end.
 */
export function orgAdminMessage(): string {
  return (
    "Only an administrator of your organisation can do this. " +
    "Ask an administrator to make the change for you."
  );
}

/**
 * True when a thrown value is the organisation-admin refusal.
 *
 * Components need this rather than `isOrgAdminError` because by the time one of them sees the
 * failure the api layer has usually already swapped the code for the sentence — so the code is
 * only on the parsed body. Reads `ApiHttpError.body.error` first (the machine token, which is the
 * honest source), then the message, which also covers the throw sites that keep a plain `Error`.
 */
export function isOrgAdminRefusal(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return isOrgAdminError(error) || error === orgAdminMessage();
  if (typeof error !== "object") return false;

  const body = (error as { body?: unknown }).body;
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && isOrgAdminError(code)) return true;

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" && (isOrgAdminError(message) || message === orgAdminMessage())
  );
}

/** Where an upsell may send the customer: an in-app path, never an off-site URL. */
const DEFAULT_UPGRADE_URL = "/settings";

/** `/settings`, `/settings?tab=billing` — one leading slash, so `//host` and `javascript:` fall out. */
const IN_APP_PATH = /^\/(?!\/)/;

function sanitizeUpgradeUrl(value: unknown): string {
  return typeof value === "string" && IN_APP_PATH.test(value) ? value : DEFAULT_UPGRADE_URL;
}

/**
 * The `upgradeUrl` the backend returned alongside the gate code, so the upsell link points
 * where the SERVER says this particular gate is lifted rather than at a hardcoded guess.
 *
 * Accepts either a parsed body (`ApiHttpError.body`) or the raw message — most of the api
 * layer folds the response body into the Error message and keeps nothing else, so the string
 * form is the common case. Anything that is not an in-app path is discarded: an error banner
 * must never become a link off the app, whatever the response said.
 */
export function planGateUpgradeUrl(source: unknown): string {
  if (source && typeof source === "object") {
    return sanitizeUpgradeUrl((source as { upgradeUrl?: unknown }).upgradeUrl);
  }
  if (typeof source === "string") {
    const match = source.match(/"upgradeUrl"\s*:\s*"([^"]*)"/);
    return sanitizeUpgradeUrl(match?.[1]);
  }
  return DEFAULT_UPGRADE_URL;
}
