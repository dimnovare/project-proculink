// src/components/onboarding/orgGate.ts

/**
 * Pure decision model for the post-signup organization gate.
 * Holds NO React/Clerk imports so it can be unit-tested in isolation (mirrors
 * the pure-derivation pattern in buildChecklistSteps.ts).
 */
export type OrgGateAction =
  | { kind: "skip" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "activate"; orgId: string }
  | { kind: "create" }
  | { kind: "select" };

export interface OrgGateInput {
  /** isApiMockMode || isQaBypass — both run without a Clerk session. */
  bypass: boolean;
  /** True once Clerk's userMemberships query has resolved (data !== undefined). */
  membershipsLoaded: boolean;
  /** Org ids of every organization the user is a member of. */
  membershipOrgIds: string[];
  /** The currently active org id, or null when none is active. */
  activeOrgId: string | null;
}

export function decideOrgGate(input: OrgGateInput): OrgGateAction {
  if (input.bypass) return { kind: "skip" };
  if (input.activeOrgId) return { kind: "ready" };
  if (!input.membershipsLoaded) return { kind: "loading" };
  const ids = input.membershipOrgIds;
  if (ids.length === 0) return { kind: "create" };
  if (ids.length === 1) return { kind: "activate", orgId: ids[0] };
  return { kind: "select" };
}
