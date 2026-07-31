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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

import { ClerkAvailabilityGate, CLERK_LOAD_DEADLINE_MS } from "./ClerkAvailabilityGate";

const APP_CONTENT = "workspace content";
// Typographic apostrophe — the copy ships &rsquo;, not a straight quote.
const HEADING = "Can’t reach the sign-in service";

function renderGate() {
  return render(
    <ClerkAvailabilityGate>
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

  it("re-arms the wait on retry so a suppressed reload does not freeze the card", () => {
    renderGate();
    advance(CLERK_LOAD_DEADLINE_MS);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Reload is stubbed here, i.e. suppressed. The UI must go back to the normal
    // app view and start waiting again rather than sitting on a dead card.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(APP_CONTENT)).toBeInTheDocument();

    advance(CLERK_LOAD_DEADLINE_MS);
    expect(screen.getByRole("alert")).toBeInTheDocument();
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
});

describe("ClerkAvailabilityGate wiring", () => {
  // Source assertion, same technique as src/test/plain-language-copy.test.ts.
  // Without it the gate could be perfect and mounted nowhere — the failure mode
  // where a fix passes its own tests and ships dead.
  const layout = readFileSync(
    join(__dirname, "..", "..", "app", "(app)", "layout.tsx"),
    "utf8",
  );

  it("is imported by the (app) layout", () => {
    expect(layout).toMatch(/from\s+"@\/components\/bridge\/ClerkAvailabilityGate"/);
  });

  it("is rendered by the (app) layout", () => {
    expect(layout).toMatch(/<ClerkAvailabilityGate>/);
  });
});
