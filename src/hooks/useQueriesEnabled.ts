"use client";

// useQueriesEnabled — single source of truth for the "may data queries run?" gate.
//
// The gate has to be true in THREE situations:
//   1. Mock mode (isApiMockMode)            — dev/demo, no real backend.
//   2. Live QA-bypass e2e (isQaBypass)      — NEXT_PUBLIC_QA_BYPASS_AUTH=true +
//      PROCULINK_QA_BYPASS_AUTH on the API. The browser has NO Clerk session, so
//      the clerkReady branch below is false and every query would starve. This
//      branch keeps the live e2e screens populated and the upload button enabled.
//   3. A signed-in Clerk user (clerkReady)  — the normal production path.
//
// Production behavior is unchanged: NEXT_PUBLIC_QA_BYPASS_AUTH is unset there, so
// isQaBypass is false and the gate collapses back to `isApiMockMode || clerkReady`.
//
// ── WHAT THIS HOOK DOES NOT DO (WP-32) ────────────────────────────────────────
// It has no timeout, and it must not grow one. If Clerk's hosted JS never loads
// (ad blocker, corporate proxy, provider outage) `isLoaded` never flips and this
// returns FALSE FOREVER — which is the correct answer, because a query fired
// without a session token just 401s. The bug was never here; it was that nobody
// bounded the wait, so all 28 consumers rendered their loading branch forever
// and a blocked script was indistinguishable from a hang.
//
// The bound lives one level up, in <ClerkAvailabilityGate> at
// src/app/(app)/layout.tsx: after CLERK_LOAD_DEADLINE_MS it replaces the whole
// shell with an explanatory card. It arms that deadline on `!useQueriesEnabled()`
// precisely because this hook already knows the two cases that must never see
// the card — mock and QA-bypass, where Clerk is dormant BY DESIGN (empty
// publishable key) and `isLoaded` is legitimately false for the whole session.
// If you ever make this hook return true in a new no-Clerk mode, the gate
// disarms itself for that mode automatically. Keep them coupled this way.

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { isApiMockMode, isQaBypass } from "@/lib/api-client";

/**
 * Returns whether TanStack Query data fetches should be enabled for the current
 * auth/runtime context. Replaces the per-component
 * `const clerkReady = ...; const queryEnabled = isApiMockMode || clerkReady;`.
 */
export function useQueriesEnabled(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  return isApiMockMode || isQaBypass || (isLoaded && !!isSignedIn);
}

// ── useTenantQueriesEnabled — the SECOND gate, for org-scoped requests ────────
//
// A signed-in session is not the same thing as a resolvable tenant, and for a
// short window on a brand-new organisation's first app paint it is provably not:
// Clerk mints the session token BEFORE the organisation claim is attached, so
// every request sent in that window reaches the backend with no org_id. The
// backend's TenantResolutionMiddleware then leaves the tenant unresolved and the
// endpoint answers 500 `System.UnauthorizedAccessException: Organisation not
// resolved`. Four to five of them, on every production smoke run since
// 2026-08-18 — /api/orders, /api/orders/summary, /api/onboarding/status,
// /api/settings/organisation, and sometimes /api/dashboard/topology.
//
// Nobody caught it because the page HEALS: <AutoActivateOrg> in
// src/app/(app)/layout.tsx sees no active organisation, calls
// setActive({ organization: firstMembership }), then invalidates every query so
// they refetch with the claim present. The screen a human sees is correct. The
// 500s are the doomed first attempts — requests the app already knew it could
// not answer yet.
//
// So this hook does not add a new fact. It asks the SAME question
// <AutoActivateOrg> asks, from the same Clerk data, one beat earlier: is there an
// organisation to scope this request to, or is activation still in flight?
//
// ── WHY THIS IS A SEPARATE HOOK AND NOT A TIGHTENING OF useQueriesEnabled ─────
// Because <ClerkAvailabilityGate> arms its "Clerk never loaded" deadline card on
// `!useQueriesEnabled()` (see the note above that hook). The org-activation
// window is short, normal, and healthy — if it made the base gate go false, the
// availability gate would start counting toward showing an alarming failure card
// for a workspace where nothing is wrong. The two gates answer different
// questions and must stay separate. Keep them in this file so they stay
// documented together.
//
// ── WHICH CONSUMERS BELONG ON WHICH GATE ─────────────────────────────────────
// Converted to this hook: a consumer whose queries are BOTH (a) tenant-scoped —
// the backend answers them per-organisation and needs the org_id claim — AND
// (b) reachable on the FIRST app paint of a session, which is the only moment
// the activation window exists. In practice that is the app shell (BridgeTopbar,
// BridgeSidebar, NotificationsBell), the dashboard (BridgeDashboard, and the
// onboarding checklist through the shared hook below), and the two shared query
// owners every screen reads on mount: useOrderDirection (["org-settings"]) and
// useOnboardingStatus (["onboarding-status"]).
//
// Deliberately left on useQueriesEnabled:
//   • <ClerkAvailabilityGate> — see above; converting it would defeat its purpose.
//   • Screens the user has to navigate to (settings, upload, supplier detail,
//     order review, admin, operations). They mount long after activation
//     resolved, so there is nothing for this gate to prevent there; converting
//     them would be churn against a window that has already closed.
//
// A note on shared query keys, because it decides correctness rather than taste:
// TanStack Query enables a query if ANY mounted observer enables it. ["orders"],
// ["orders-summary"], ["billing-status"] and ["admin-access"] all have several
// observers. Every observer that can mount on the first paint was converted
// together — including NotificationsBell, which carried no auth gate at all —
// because leaving one behind would have kept firing the query and made the
// conversion of its siblings worth nothing.
//
// ── THE NO-MEMBERSHIPS BRANCH IS LOAD-BEARING ────────────────────────────────
// It returns TRUE, and it must. The backend deliberately supports legacy
// "sub-keyed" organisations whose tokens carry NO organisation claim at all —
// branch (2) of TenantResolutionMiddleware.InvokeAsync, which resolves an
// Organisation row keyed to the user's own Clerk user id so those customers keep
// working. They will never have an org claim and never have a membership to
// activate. Gating them off would starve every query on every screen, forever:
// not a slow app, a blank one. Pinned by useTenantQueriesEnabled.test.tsx.

/**
 * Returns whether ORGANISATION-SCOPED data fetches may run yet — i.e. whether a
 * request sent right now would carry an org_id claim the backend can resolve a
 * tenant from.
 *
 * True when: mock / QA-bypass (Clerk is dormant by design — defers to
 * `useQueriesEnabled`), or an organisation is already active, or the user
 * provably has no Clerk organisation at all (the legacy sub-keyed tenant above).
 *
 * False when: the base gate is false, or the membership list has not loaded yet,
 * or memberships exist but none is active — the activation window this hook was
 * written for.
 */
export function useTenantQueriesEnabled(): boolean {
  // Every hook call is unconditional and above every branch (rules of hooks).
  const queriesEnabled = useQueriesEnabled();
  const { orgId } = useAuth();
  // The params match <AutoActivateOrg>'s call in src/app/(app)/layout.tsx
  // EXACTLY, on purpose: identical params mean Clerk serves both from one cache
  // entry, so this gate costs no extra network request and reads precisely the
  // list that activation will pick its organisation from.
  const { isLoaded: membershipsLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  // Clerk is dormant by design in both of these (empty publishable key): there is
  // no claim coming and no membership list that will ever load. Defer to the base
  // gate, the same way <ClerkAvailabilityGate> does.
  if (isApiMockMode || isQaBypass) return queriesEnabled;

  // Not signed in, or Clerk's JS has not loaded. Nothing may go out at all.
  if (!queriesEnabled) return false;

  // An organisation is active, so the next token carries its claim.
  if (orgId) return true;

  // No claim yet — decide between "activation is in flight" and "this user has no
  // Clerk organisation at all".

  // The membership list itself failed. We cannot tell the two apart, so fail OPEN
  // and behave exactly as this app did before the gate existed: the worst case is
  // the 500s we are removing, and the alternative — failing closed on an answer we
  // never got — is an app that never loads anything again.
  if (userMemberships?.isError) return true;

  // Still discovering. Note `isLoading` is `false` (not `true`) in Clerk's
  // not-loaded default shape, so `membershipsLoaded` has to be checked as well —
  // reading `isLoading` alone would report "finished" before the fetch started.
  if (!membershipsLoaded || userMemberships?.isLoading) return false;

  const membershipCount = userMemberships?.count ?? userMemberships?.data?.length;
  // An answer we do not have is not an answer of zero. Wait.
  if (membershipCount === undefined) return false;

  // 0 → the legacy sub-keyed tenant; its token never carries an org claim and the
  // backend resolves it from the user's sub. Anything above 0 → memberships exist
  // and none is active, which is the activation window: hold until setActive lands.
  return membershipCount === 0;
}
