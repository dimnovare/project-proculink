// ─────────────────────────────────────────────────────────────────────────────
// Which plan a gated capability starts on — the one place the frontend states it.
//
// Source of truth: `ProcuLink.Core/Constants/PlanConstants.cs` → `MinimumPlan`, enforced
// there by `ProcuLink.Api.Tests/Architecture/BillingGateEnforcementIsRealTests`, which reads
// compiled IL so a row cannot be declared without a real enforcement site. This is a
// hand-kept mirror because the frontend cannot import C#. That is exactly why it is small,
// in one file, and asserted by `src/test/gatedCapabilityClaims.test.ts`: drift has to break
// a test rather than sit in prose.
//
// ── Why the copy helpers live here and not in the copy ────────────────────────
//
// CLAUDE.md §11.5: *a capability may only be listed on a tier if the backend really gates it
// there.* The corollary is easy to miss and shipped repeatedly — **a gated capability
// presented with no tier at all reads as included on every plan.** cXML was sold as an
// unconditional "Supported" on six surfaces while `BillingGateErrors.RequiredFeatures`
// refused a Growth org's cXML delivery config with `cxml_output_requires_operations`; the
// ERP connectors were listed beside SFTP and email as though they were an ordinary channel,
// at a €2,500/mo gate.
//
// The obvious repair — type "Operations plan and up" into six help pages — creates six
// places to forget when a gate moves, which is the defect one level up. So marketing and
// help copy calls `requiresPlan()` / `minimumPlanName()` and the tier name is DERIVED from
// the row below. Re-tiering a capability is then one edit here, and every surface follows.
// ─────────────────────────────────────────────────────────────────────────────

import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

/**
 * The minimum plan per gated capability, mirroring `PlanConstants.MinimumPlan`.
 *
 * `satisfies` rather than a plain annotation so the literal plan ids stay visible to the
 * type checker: a typo'd tier is a compile error, not a runtime lookup of `undefined`.
 */
export const MINIMUM_PLAN = {
  webhookDelivery: "growth",
  emailIngestion: "growth",
  sftpIngestion: "growth",
  s3Ingestion: "growth",
  bulkMapping: "operations",
  cxml: "operations",
  advancedAudit: "operations",
  erpConnectors: "enterprise",
  customSupplierRules: "enterprise",
  // Clerk *can* deliver SSO and the flag exists, but ProcuLink exposes no Settings surface
  // for it, so it is deliberately unsold. See the note on the Enterprise card in plans.ts.
  sso: "enterprise",
} as const satisfies Record<string, PlanId>;

export type GatedCapability = keyof typeof MINIMUM_PLAN;

/** The plan id a capability starts on — `"operations"`. */
export function minimumPlanId(capability: GatedCapability): PlanId {
  return MINIMUM_PLAN[capability];
}

/** The plan's display name — `"Operations"`. Use this when writing prose around it. */
export function minimumPlanName(capability: GatedCapability): string {
  return PLAN_BY_ID[MINIMUM_PLAN[capability]].name;
}

/**
 * The standard disclosure clause used across `/formats` and the help articles —
 * `"Operations plan and up"`.
 *
 * One phrasing everywhere is deliberate. A reader who has met it once on `/formats` reads it
 * the same way in a help table, and `gatedCapabilityClaims.test.ts` can recognise a real
 * disclosure without having to guess at a dozen synonyms.
 */
export function requiresPlan(capability: GatedCapability): string {
  return `${minimumPlanName(capability)} plan and up`;
}

/** A whole sentence, for prose that needs one — `"Included from the Operations plan up."` */
export function includedFromPlan(capability: GatedCapability): string {
  return `Included from the ${minimumPlanName(capability)} plan up.`;
}
