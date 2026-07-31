// WP-32 — the degraded state for a hard external dependency.
//
// THE DEFECT THIS PINS. `useQueriesEnabled()` returns
// `isApiMockMode || isQaBypass || (isLoaded && !!isSignedIn)`. When the sign-in
// service's hosted JS never arrives — ad blocker, corporate proxy, provider
// outage — `isLoaded` never flips, so in a production build (where the first two
// flags compile to false) the gate is false for the lifetime of the tab. Every
// (app) screen passes it straight to `useQuery({ enabled })` and renders a
// loading branch when it is false, e.g. operations/health/page.tsx:121
// `if (!queryEnabled || healthQ.isLoading) return <…>Loading pipeline health…`.
// Nothing in that chain has a timeout. A blocked script is indistinguishable
// from a hang.
//
// THE THREE THINGS THAT MUST STAY TRUE:
//   1. blocked  → an explanatory card inside the deadline, with a working retry
//   2. healthy  → never the card, whether signed in OR signed out
//   3. mock / QA-bypass → never the card, ever. Those builds hand ClerkProvider
//      an EMPTY publishable key on purpose (src/app/layout.tsx:88,
//      playwright.config.ts:78) so Clerk stays dormant and `isLoaded` is
//      legitimately false forever. Arming a timer on `!isLoaded` alone would
//      put this card in front of the entire e2e suite.
//
// The REAL useQueriesEnabled runs here — only its two build flags are stubbed —
// so the arm/disarm coupling is exercised rather than asserted about.
//
// The layout WIRING is asserted behaviourally in
// src/app/(app)/layout.wiring.test.tsx: it renders the real layout and checks
// the shell is gone, because a source-text regex for `<ClerkAvailabilityGate>`
// passed with the gate commented out and with the gate wrapping `{null}`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";

let clerkLoaded = false;
let clerkSignedIn = false;
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: clerkLoaded, isSignedIn: clerkSignedIn }),
}));

// Getters, not plain values: the module factory runs once, but `useQueriesEnabled`
// reads the bindings on every call, so each test can vary the build flags.
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

const reloadSpy = vi.fn();
vi.mock("@/lib/reload", () => ({ reloadPage: () => reloadSpy() }));

// The wall clock the deadline is anchored to. Pinned per test rather than read
// from the runner's faked `performance`, so the anchoring is asserted, not
// inherited.
let elapsedSinceNavigation = 0;
vi.mock("@/lib/navigationClock", () => ({
  msSinceNavigationStart: () => elapsedSinceNavigation,
}));

import {
  ClerkAvailabilityGate,
  CLERK_LOAD_DEADLINE_MS,
  REARM_AFTER_RELOAD_MS,
  signInHostFromPublishableKey,
} from "./ClerkAvailabilityGate";

const APP_CONTENT = "workspace content";
// Typographic apostrophe — the copy ships &rsquo;, not a straight quote.
const HEADING = "Can’t reach the sign-in service";

function renderGate(surface?: "workspace" | "auth") {
  return render(
    <ClerkAvailabilityGate surface={surface}>
      <div>{APP_CONTENT}</div>
    </ClerkAvailabilityGate>,
  );
}

/** Push fake time forward inside act() so React commits the timer's state update. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clerkLoaded = false;
  clerkSignedIn = false;
  mockMode = false;
  qaBypass = false;
  elapsedSinceNavigation = 0;
  document.title = "Dashboard — ProcuLink";
  reloadSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClerkAvailabilityGate", () => {
  it("shows the degraded card when the sign-in service never loads", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);

    const card = screen.getByRole("alert");
    expect(card).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HEADING);
    expect(card).toHaveTextContent("your browser could not load it");
    // Honest about consequences, and does not blame the user.
    expect(card).toHaveTextContent("Nothing was changed");
    // The starving app content is gone — the card REPLACES it, it does not sit
    // above a screen still claiming to load.
    expect(screen.queryByText(APP_CONTENT)).not.toBeInTheDocument();
  });

  it("lands inside the 10s acceptance ceiling", () => {
    expect(CLERK_LOAD_DEADLINE_MS).toBeLessThan(10_000);
    // …and above the app's own 5s Clerk wait in authHeader (src/lib/api/core.ts),
    // so the card can never pre-empt a slow load the fetch path would still honour.
    expect(CLERK_LOAD_DEADLINE_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("counts the deadline from navigation, not from the moment it mounted", () => {
    // The whole budget is wall clock. By the time this component mounts, the
    // document fetch, the JS download and the hydrate have already spent part
    // of it — and the script it is waiting for was requested by the document,
    // so that time counted against the dependency too.
    elapsedSinceNavigation = 3_000;
    renderGate();

    advance(CLERK_LOAD_DEADLINE_MS - 3_000 - 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps showing the app until the deadline actually passes", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS - 1);

    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a retry that re-requests the page", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);

    const retry = screen.getByRole("button", { name: /try again/i });
    expect(reloadSpy).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("does not flash the broken shell back while the reload is still landing", () => {
    // Re-arming immediately committed a React state update before the
    // navigation landed, so the entire spinning shell — the exact thing this
    // card exists to replace — reappeared for about half a second on every
    // click. The re-arm has to wait out the navigation.
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(APP_CONTENT)).not.toBeInTheDocument();
  });

  it("re-arms the wait on retry so a suppressed reload does not freeze the card", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Reload is stubbed here, i.e. suppressed — the document never goes away.
    // Once the navigation has plainly not happened, the UI must go back to its
    // normal waiting state rather than sitting on a dead card.
    advance(REARM_AFTER_RELOAD_MS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();

    advance(CLERK_LOAD_DEADLINE_MS);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("says that trying again cannot clear a blocker", () => {
    // The card names three likely causes and offers one action that provably
    // fixes only one of them. Without this clause an ad-blocker user presses
    // "Try again", waits the same eight seconds, and gets the identical card,
    // with nothing on screen ever admitting why.
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);

    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent("ad blocker");
    expect(card).toHaveTextContent(/trying again only helps/i);
    expect(card).toHaveTextContent(/has to be allowed/i);
  });

  it("offers a way to get help that does not depend on being signed in", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);

    const help = screen.getByRole("link", { name: /get help/i });
    // /support is a public marketing route (not in middleware's isProtectedRoute)
    // and ContactForm imports nothing from Clerk, so it renders with the sign-in
    // script dead. /operations/health does NOT qualify: it gates on
    // useQueriesEnabled itself and would be a second permanent spinner.
    expect(help).toHaveAttribute("href", "/support");
  });

  it("keeps both recovery controls at the 44px mobile tap floor", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);

    // These two controls ARE the recovery path. A dense desktop height here
    // costs a phone user the only way out of the card.
    expect(screen.getByRole("button", { name: /try again/i }).className).toMatch(
      /(^|\s)h-\[44px\]/,
    );
    expect(screen.getByRole("link", { name: /get help/i }).className).toMatch(
      /(^|\s)min-h-\[44px\]/,
    );
  });

  it("stops the tab title claiming the workspace is open", () => {
    renderGate();
    expect(document.title).toBe("Dashboard — ProcuLink");

    advance(CLERK_LOAD_DEADLINE_MS);
    expect(document.title).toContain("Can’t reach the sign-in service");

    // A late arrival unmounts the card on its own, so the title has to come back.
    clerkLoaded = true;
    act(() => {
      cleanup();
    });
    expect(document.title).toBe("Dashboard — ProcuLink");
  });

  it("never shows the card once the sign-in service loads", () => {
    clerkLoaded = true;
    clerkSignedIn = true;
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never tells a merely signed-out user that the service is down", () => {
    clerkLoaded = true;
    clerkSignedIn = false;
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays out of the way in mock mode, where Clerk is dormant by design", () => {
    mockMode = true;
    clerkLoaded = false;
    renderGate();
    advance(60_000);

    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays out of the way under QA-bypass, where Clerk is dormant by design", () => {
    qaBypass = true;
    clerkLoaded = false;
    renderGate();
    advance(60_000);

    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells an auth page what is blocked there, not that a workspace cannot open", () => {
    renderGate("auth");
    advance(CLERK_LOAD_DEADLINE_MS);

    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent("you can’t sign in or create an account");
    expect(card).not.toHaveTextContent("your workspace can’t open");
  });
});

describe("signInHostFromPublishableKey", () => {
  // The one piece of hand-rolled parsing in this pattern. It is exported for
  // testability and had no test: a mutation returning null always — which
  // silently drops the host block, i.e. the single actionable string on the
  // card — was invisible to the whole suite.
  it("decodes a live key", () => {
    expect(signInHostFromPublishableKey("pk_live_Y2xlcmsucHJvY3VsaW5rLmV1JA==")).toBe(
      "clerk.proculink.eu",
    );
  });

  it("decodes a test key", () => {
    // base64("polite-lizard-42.clerk.accounts.dev$")
    expect(
      signInHostFromPublishableKey(
        "pk_test_cG9saXRlLWxpemFyZC00Mi5jbGVyay5hY2NvdW50cy5kZXYk",
      ),
    ).toBe("polite-lizard-42.clerk.accounts.dev");
  });

  it("returns null rather than guessing when the key is unusable", () => {
    expect(signInHostFromPublishableKey(undefined)).toBeNull();
    expect(signInHostFromPublishableKey("")).toBeNull();
    expect(signInHostFromPublishableKey("pk_live_")).toBeNull();
    // Valid base64, but not a host — must not be printed as one.
    expect(signInHostFromPublishableKey("pk_live_bm90IGEgaG9zdA==")).toBeNull();
    // Not base64 at all.
    expect(signInHostFromPublishableKey("pk_live_!!!!")).toBeNull();
  });
});
