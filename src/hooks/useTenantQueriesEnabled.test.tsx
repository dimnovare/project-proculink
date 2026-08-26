// The gate for organisation-scoped requests, branch by branch.
//
// THE DEFECT THIS PINS. On a brand-new organisation's first app paint, Clerk
// mints the session token BEFORE the organisation claim is attached. Every
// tenant-scoped request sent in that window reaches the backend with no org_id,
// TenantResolutionMiddleware leaves the tenant unresolved, and the endpoint
// answers 500 `System.UnauthorizedAccessException: Organisation not resolved`.
// Four to five of them on every production smoke run since 2026-08-18 —
// /api/orders, /api/orders/summary, /api/onboarding/status,
// /api/settings/organisation and sometimes /api/dashboard/topology — and every
// one of those runs still reported success, because <AutoActivateOrg> calls
// setActive and invalidates the cache, so the page a human sees is correct.
//
// THE FOUR THINGS THAT MUST STAY TRUE:
//   1. memberships exist but none is active → FALSE. The window above.
//   2. no memberships AT ALL → TRUE. Load-bearing: the backend deliberately
//      supports legacy "sub-keyed" organisations whose tokens carry no org claim
//      ever (TenantResolutionMiddleware.InvokeAsync branch 2, which resolves the
//      Organisation row keyed to the user's own Clerk user id). Those customers
//      will never have a claim and never have a membership to activate. Gating
//      them off would not slow the app down for them, it would blank it forever.
//   3. mock / QA-bypass → whatever the base gate says. Clerk is dormant by design
//      there (empty publishable key), so there is no claim coming.
//   4. useQueriesEnabled() itself is UNCHANGED through the whole window.
//      <ClerkAvailabilityGate> arms its "can't reach the sign-in service"
//      deadline card on `!useQueriesEnabled()`. If the base gate went false while
//      an organisation was activating — a short, normal, entirely healthy state —
//      that card would start counting down in front of a workspace where nothing
//      is wrong. That is why this is a second hook and not a tightening of the
//      first one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// ── Clerk knobs ──────────────────────────────────────────────────────────────
let clerkLoaded = true;
let clerkSignedIn = true;
let activeOrgId: string | null = null;

type MembershipsShape = {
  isLoading: boolean;
  isError: boolean;
  count: number | undefined;
  data: unknown[] | undefined;
};

let membershipsLoaded = true;
let memberships: MembershipsShape;
const orgListParams: unknown[] = [];

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, orgId: activeOrgId }),
  useOrganizationList: (params: unknown) => {
    orgListParams.push(params);
    return { isLoaded: membershipsLoaded, userMemberships: memberships };
  },
}));

// Getters, not plain values: the module factory runs once, but the hooks read the
// bindings on every call, so each test can vary the build flags.
let mockMode = false;
let qaBypass = false;
vi.mock("@/lib/api-client", () => ({
  get isApiMockMode() {
    return mockMode;
  },
  get isQaBypass() {
    return qaBypass;
  },
}));

import { useQueriesEnabled, useTenantQueriesEnabled } from "./useQueriesEnabled";

/** A membership list that has finished loading and holds `count` entries. */
function loadedMemberships(count: number): MembershipsShape {
  return {
    isLoading: false,
    isError: false,
    count,
    data: Array.from({ length: count }, (_, i) => ({ organization: { id: `org_${i}` } })),
  };
}

/**
 * Clerk's real not-loaded shape: `PaginatedResourcesWithDefault` maps every
 * boolean to FALSE and everything else to undefined. So `isLoading` reads
 * `false` here — "not fetching", which is not the same as "finished" — which is
 * exactly why the hook cannot decide on `isLoading` alone.
 */
const NOT_LOADED_MEMBERSHIPS: MembershipsShape = {
  isLoading: false,
  isError: false,
  count: undefined,
  data: undefined,
};

const tenantGate = () => renderHook(() => useTenantQueriesEnabled()).result.current;
const baseGate = () => renderHook(() => useQueriesEnabled()).result.current;

beforeEach(() => {
  clerkLoaded = true;
  clerkSignedIn = true;
  activeOrgId = null;
  membershipsLoaded = true;
  memberships = loadedMemberships(0);
  mockMode = false;
  qaBypass = false;
  orgListParams.length = 0;
});
afterEach(cleanup);

describe("useTenantQueriesEnabled — no Clerk session to wait for", () => {
  it("mirrors the base gate in mock mode, even mid-activation", () => {
    mockMode = true;
    // Everything below screams "activation pending". None of it applies: Clerk is
    // dormant with an empty publishable key, so no claim is ever coming.
    clerkLoaded = false;
    clerkSignedIn = false;
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;

    expect(baseGate()).toBe(true);
    expect(tenantGate()).toBe(true);
  });

  it("mirrors the base gate under QA-bypass", () => {
    qaBypass = true;
    clerkLoaded = false;
    clerkSignedIn = false;
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;

    expect(baseGate()).toBe(true);
    expect(tenantGate()).toBe(true);
  });
});

describe("useTenantQueriesEnabled — nothing may go out at all", () => {
  it("is false when the user is signed out", () => {
    clerkSignedIn = false;
    expect(tenantGate()).toBe(false);
  });

  it("is false while Clerk's own JS has not loaded", () => {
    clerkLoaded = false;
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;
    expect(tenantGate()).toBe(false);
  });
});

describe("useTenantQueriesEnabled — the organisation-activation window", () => {
  it("is true once an organisation is active", () => {
    activeOrgId = "org_live";
    expect(tenantGate()).toBe(true);
  });

  it("is true once an organisation is active even if the membership list is still loading", () => {
    activeOrgId = "org_live";
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;
    // The claim is what the backend reads. Once it is there, nothing else matters.
    expect(tenantGate()).toBe(true);
  });

  it("is false while the membership list has not loaded — a not-fetching list is not a finished one", () => {
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;
    // If the hook decided on `isLoading` alone it would read this shape as
    // "loaded, zero memberships" and let the doomed requests out.
    expect(memberships.isLoading).toBe(false);
    expect(tenantGate()).toBe(false);
  });

  it("is false while the membership list is fetching", () => {
    memberships = { ...loadedMemberships(0), isLoading: true };
    expect(tenantGate()).toBe(false);
  });

  it("is FALSE when memberships exist but none is active — the window that caused the 500s", () => {
    activeOrgId = null;
    memberships = loadedMemberships(1);
    expect(tenantGate()).toBe(false);
  });

  it("is false when several memberships exist and none is active", () => {
    activeOrgId = null;
    memberships = loadedMemberships(3);
    expect(tenantGate()).toBe(false);
  });

  it("is false when the list is loaded but carries no count we can read", () => {
    memberships = { isLoading: false, isError: false, count: undefined, data: undefined };
    // An answer we do not have is not an answer of zero.
    expect(tenantGate()).toBe(false);
  });

  it("counts a list that reports data without a count", () => {
    memberships = { ...loadedMemberships(2), count: undefined };
    expect(tenantGate()).toBe(false);
  });
});

describe("useTenantQueriesEnabled — the legacy sub-keyed tenant", () => {
  it("is TRUE when the user has no Clerk organisation at all", () => {
    activeOrgId = null;
    memberships = loadedMemberships(0);
    // The backend resolves these customers from their own Clerk user id
    // (TenantResolutionMiddleware branch 2). They have no claim and no membership
    // to wait for, so a gate that waited would blank the entire app for them
    // permanently. This branch is why that cannot happen.
    expect(tenantGate()).toBe(true);
  });

  it("fails OPEN when the membership list itself errors", () => {
    activeOrgId = null;
    memberships = { isLoading: false, isError: true, count: undefined, data: undefined };
    // We cannot tell "activating" from "legacy sub-keyed" without that list. The
    // worst case of guessing true is the 500s this hook removes; the worst case of
    // guessing false is an app that never loads anything again.
    expect(tenantGate()).toBe(true);
  });
});

describe("useTenantQueriesEnabled — what it must NOT disturb", () => {
  it("leaves useQueriesEnabled TRUE through the whole activation window", () => {
    activeOrgId = null;
    memberships = loadedMemberships(1);

    // <ClerkAvailabilityGate> arms its deadline card on `!useQueriesEnabled()`.
    // The tenant gate holding requests back must not start that countdown.
    expect(tenantGate()).toBe(false);
    expect(baseGate()).toBe(true);
  });

  it("leaves useQueriesEnabled TRUE while the membership list is still loading", () => {
    membershipsLoaded = false;
    memberships = NOT_LOADED_MEMBERSHIPS;

    expect(tenantGate()).toBe(false);
    expect(baseGate()).toBe(true);
  });

  it("reads the same membership list AutoActivateOrg activates from", () => {
    tenantGate();
    // Identical params to the useOrganizationList call in src/app/(app)/layout.tsx,
    // so Clerk serves both from ONE cache entry: the gate costs no extra request,
    // and it cannot disagree with the component doing the activating.
    expect(orgListParams).toContainEqual({ userMemberships: { infinite: true } });
  });
});
