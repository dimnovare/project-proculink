// /sign-in and /sign-up are behind the same bounded wait (WP-32 follow-up, F1).
//
// THE DEFECT THIS PINS. The gate shipped in the (app) layout, and /sign-in is
// not in (app) — its only ancestor layout is src/app/layout.tsx. Meanwhile
// src/middleware.ts sends EVERY signed-out request on a protected route to
// /sign-in, so the most common real-world instance of "the sign-in service is
// blocked" landed on the one page the gate could not reach.
//
// What the user got there was worse than the spinner the gate replaced:
// <SignIn/> never mounts without the hosted script, so the page rendered a
// "Welcome back" heading above an empty box, with no spinner, no error and no
// timeout — measured still blank after 14s against a production build.
//
// WHY isLoaded IS THE RIGHT READY SIGNAL HERE. The failure being bounded is
// "the hosted script never arrived", and useAuth().isLoaded is precisely the
// flag that flips when it does arrive and initialises. It does not throw when
// the script is missing (ClerkProvider is mounted in the root layout either
// way) — it simply stays false, which is the condition. Waiting on the form's
// own DOM instead would mean waiting on markup that a blocked script never
// produces, i.e. reading the symptom rather than the dependency.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";

let clerkLoaded = false;
let clerkSignedIn = false;
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: clerkLoaded, isSignedIn: clerkSignedIn }),
  SignIn: () => <div>clerk sign-in form</div>,
  SignUp: () => <div>clerk sign-up form</div>,
}));

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

import SignInPage from "./[[...sign-in]]/page";
import SignUpPage from "../sign-up/[[...sign-up]]/page";
import { CLERK_LOAD_DEADLINE_MS } from "@/components/bridge/ClerkAvailabilityGate";

const HEADING = "Can’t reach the sign-in service";

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clerkLoaded = false;
  clerkSignedIn = false;
  // Decodes to clerk.proculink.eu — the host the card has to name.
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_Y2xlcmsucHJvY3VsaW5rLmV1JA==");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_live_not-a-real-key");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/sign-in", () => {
  it("shows the sign-in page while the service is still coming", () => {
    render(<SignInPage />);
    advance(CLERK_LOAD_DEADLINE_MS - 1);

    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains itself instead of hanging blank when the service never loads", () => {
    render(<SignInPage />);
    advance(CLERK_LOAD_DEADLINE_MS);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HEADING);
    // The empty box under "Welcome back" is the thing being fixed: the card
    // replaces the page, it does not sit under a heading that promises a form.
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
    expect(screen.queryByText("clerk sign-in form")).not.toBeInTheDocument();
  });

  it("says what is actually blocked on an auth page, not that a workspace cannot open", () => {
    render(<SignInPage />);
    advance(CLERK_LOAD_DEADLINE_MS);

    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent("you can’t sign in or create an account");
    // The host an operator's IT has to allow.
    expect(card).toHaveTextContent("clerk.proculink.eu");
  });

  it("never shows the card when the service is healthy", () => {
    clerkLoaded = true;
    render(<SignInPage />);
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(screen.getByText("clerk sign-in form")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("/sign-up", () => {
  // Same file shape as /sign-in: a server component outside (app) whose only
  // ancestor is the root layout, rendering a Clerk component that never mounts
  // without the hosted script. Middleware does not route anyone here, but the
  // marketing "Start for free" call to action does.
  it("explains itself instead of hanging blank when the service never loads", () => {
    render(<SignUpPage />);
    advance(CLERK_LOAD_DEADLINE_MS);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HEADING);
    expect(screen.queryByText("Start for free")).not.toBeInTheDocument();
    expect(screen.queryByText("clerk sign-up form")).not.toBeInTheDocument();
  });

  it("never shows the card when the service is healthy", () => {
    clerkLoaded = true;
    render(<SignUpPage />);
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(screen.getByText("clerk sign-up form")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
