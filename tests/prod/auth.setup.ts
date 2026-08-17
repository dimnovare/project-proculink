import { test as setup, expect } from "@playwright/test";
import { readDisposableState, STORAGE_STATE } from "./disposableIdentity";

/**
 * Exchange the disposable sign-in ticket for a real production browser session.
 *
 * This runs as its own Playwright project so that the ticket — which is
 * SINGLE-USE — is redeemed exactly once, and every spec afterwards loads the
 * resulting cookies from `storageState`. Redeeming it per-test would fail every
 * test but the first, and would fail in a way that looks like a product bug.
 *
 * The ticket is minted by scripts/prod-smoke/clerk-disposable.mjs; see that
 * file's header for why a ticket is the only path that works on this Clerk
 * instance (the Native API is disabled, and Backend API session creation is
 * development-only).
 *
 * STORAGE_STATE and readDisposableState live in ./disposableIdentity because
 * playwright.prod.config.ts imports the first of them, and a Playwright config
 * may not import a module that declares tests.
 */

setup("sign in to production with a disposable Clerk identity", async ({ page }) => {
  const state = readDisposableState();

  // Navigating with `__clerk_ticket` is the redemption. Clerk resolves it before
  // the app's own middleware runs and sets __session / __client on the redirect.
  await page.goto(`/sign-in?__clerk_ticket=${encodeURIComponent(state.ticket)}`);

  // The landing is /bridge, but not necessarily in one hop. A brand-new user has
  // no ACTIVE organisation on the edge session even though the membership
  // exists, so src/middleware.ts bounces once to /onboarding/select-organization,
  // which activates the org and forwards on with ?org_set=1. Waiting for the
  // destination rather than for a single redirect makes that hop invisible here
  // and keeps this setup honest if the gate's shape changes.
  await page.waitForURL(/\/bridge(\?|$)/, { timeout: 90_000 });

  // Being on /bridge is not the same as being signed in on /bridge: a signed-out
  // request is redirected to /sign-in, so the assertion that matters is the
  // negative one. If Clerk silently failed, this is where it says so.
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page).not.toHaveURL(/\/onboarding\//);

  await page.context().storageState({ path: STORAGE_STATE });
});
