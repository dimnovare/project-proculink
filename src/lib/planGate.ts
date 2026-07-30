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
