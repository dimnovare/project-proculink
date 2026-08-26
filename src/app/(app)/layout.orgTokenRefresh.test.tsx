// AutoActivateOrg must reissue the session token BEFORE it invalidates queries.
//
// THE DEFECT THIS PINS. `setActive()` resolving means Clerk has set the active
// ORGANISATION. It does not mean a new session token exists. The original code
// asserted otherwise in a comment — "Session token now contains org_id" — and
// invalidated immediately.
//
// `authHeader()` (src/lib/api/core.ts) reads `Clerk.session.getToken()` with NO
// `skipCache`, and Clerk caches the JWT. So every refetch triggered by that
// invalidate carried the PRE-activation token, with no org_id claim, and the
// backend answered each one `UnauthorizedAccessException("Organisation not
// resolved")` → HTTP 500.
//
// Measured in production: four to five 500s on every new organisation's first
// dashboard load, on every scheduled smoke run (2026-08-18, 08-21, 08-25, 08-26).
// Gating the queries on organisation readiness removed most of them; these two
// survived, because by this point an organisation IS active and the gate is
// correctly open. The staleness is in the TOKEN, not the state — which is why
// this is the only place it can be fixed.
//
// WHAT THIS ASSERTS. Not that getToken was called — a fix that called it AFTER
// the invalidate would satisfy that and change nothing. It asserts the ORDER,
// and that the refresh explicitly skips the cache. Both halves matter: without
// `skipCache: true` Clerk hands back the very token we are trying to replace.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const calls: string[] = [];

let setActiveImpl: ((args: { organization: string }) => Promise<void>) | undefined;
const MEMBERSHIP = { organization: { id: "org_test" } };

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useOrganization: () => ({ organization: null }),
  useOrganizationList: () => ({
    userMemberships: { data: [MEMBERSHIP] },
    setActive: setActiveImpl,
  }),
}));

const invalidateQueries = vi.fn(async () => {
  calls.push("invalidateQueries");
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});

vi.mock("@/lib/api-client", () => ({
  get isApiMockMode() {
    return false;
  },
  get isQaBypass() {
    return false;
  },
}));
vi.mock("@/lib/navigationClock", () => ({ msSinceNavigationStart: () => 0 }));
vi.mock("@/lib/reload", () => ({ reloadPage: () => {} }));
vi.mock("@/mocks/MSWProvider", () => ({
  MSWProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/bridge/BridgeTopbar", () => ({ BridgeTopbar: () => <div>topbar</div> }));
vi.mock("@/components/bridge/BridgeSidebar", () => ({ BridgeSidebar: () => <div>sidebar</div> }));
vi.mock("@/components/onboarding/WorkspaceNameNudge", () => ({ WorkspaceNameNudge: () => null }));

import AppShellLayout from "./layout";

type TokenOpts = { skipCache?: boolean } | undefined;
const getToken = vi.fn(async (opts: TokenOpts) => {
  calls.push(`getToken:${opts?.skipCache === true ? "skipCache" : "cached"}`);
  return "token";
});

function installClerkGlobal() {
  (window as unknown as { Clerk?: unknown }).Clerk = { session: { getToken } };
}

function renderShell() {
  return render(
    <AppShellLayout>
      <div>page</div>
    </AppShellLayout>,
  );
}

beforeEach(() => {
  calls.length = 0;
  invalidateQueries.mockClear();
  getToken.mockClear();
  setActiveImpl = vi.fn(async () => {
    calls.push("setActive");
  });
  installClerkGlobal();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

describe("AutoActivateOrg — token reissue ordering", () => {
  it("reissues the session token, skipping the cache, before invalidating queries", async () => {
    renderShell();

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());

    // The whole fix is this sequence. Reverting to the old body puts
    // invalidateQueries immediately after setActive and this fails.
    expect(calls).toEqual(["setActive", "getToken:skipCache", "invalidateQueries"]);
  });

  it("passes skipCache explicitly — a cached read would return the very token being replaced", async () => {
    renderShell();

    await waitFor(() => expect(getToken).toHaveBeenCalled());
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
  });

  it("still invalidates when the token reissue throws, rather than stranding the queries", async () => {
    getToken.mockImplementationOnce(async () => {
      calls.push("getToken:threw");
      throw new Error("clerk unavailable");
    });

    renderShell();

    // Failing to refresh must not be fatal: the worst case is the behaviour we
    // had before the refresh existed, not an app whose queries never refetch.
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
    expect(calls).toEqual(["setActive", "getToken:threw", "invalidateQueries"]);
  });

  it("does nothing at all when there is no membership to activate", async () => {
    // The legacy sub-keyed tenant: no Clerk organisation, nothing to activate,
    // and nothing to refresh. A fix that unconditionally refreshed would add a
    // pointless token round trip to every one of those sessions.
    setActiveImpl = undefined;
    renderShell();

    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });
});
