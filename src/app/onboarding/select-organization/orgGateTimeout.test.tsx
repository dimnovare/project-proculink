// The org gate's stall state uses the shared pattern (WP-32 follow-up, F3).
//
// THE DEFECT THIS PINS. This page hand-rolled its own timeout:
// `setTimeout(() => setTimedOut(true), 12_000)`, rendering "Still setting
// things up… / Retry". Three problems, all measurable:
//
//   • 12s is OVER the 10s ceiling the degraded-state pattern is held to.
//   • The copy is false. When the sign-in service's hosted script is dead,
//     nothing is being set up — and this page is where every successful
//     sign-in lands (sign-in/page.tsx fallbackRedirectUrl) and where the
//     middleware org gate sends people (middleware.ts redirectToCreateOrg),
//     so it is a high-traffic place to say something untrue.
//   • "Retry" is the exact word the pattern deliberately avoided in favour of
//     "Try again" (it is on the vocabulary gate's GLOSS tier).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";

const replaceSpy = vi.fn();
const refreshSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy, refresh: refreshSpy, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

let membershipsData: unknown[] | undefined;
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { firstName: "Ada", primaryEmailAddress: { emailAddress: "a@b.co" } } }),
  useOrganization: () => ({ organization: null }),
  useOrganizationList: () => ({
    userMemberships: { data: membershipsData },
    setActive: undefined,
    createOrganization: undefined,
  }),
  CreateOrganization: () => <div>create org form</div>,
  OrganizationList: () => <div>org list</div>,
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
const reloadSpy = vi.fn();
vi.mock("@/lib/reload", () => ({ reloadPage: () => reloadSpy() }));

import SelectOrganizationPage from "./page";
import { CLERK_LOAD_DEADLINE_MS } from "@/components/bridge/ClerkAvailabilityGate";

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  membershipsData = undefined; // Clerk's memberships query never resolves.
  replaceSpy.mockClear();
  refreshSpy.mockClear();
  reloadSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("/onboarding/select-organization when the sign-in service stalls", () => {
  it("waits inside the same ceiling as the rest of the app", () => {
    render(<SelectOrganizationPage />);

    advance(CLERK_LOAD_DEADLINE_MS - 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    advance(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(CLERK_LOAD_DEADLINE_MS).toBeLessThan(10_000);
  });

  it("names the real cause instead of claiming a setup is in progress", () => {
    render(<SelectOrganizationPage />);
    advance(CLERK_LOAD_DEADLINE_MS);

    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent("Can’t reach the sign-in service");
    expect(screen.queryByText(/still setting things up/i)).not.toBeInTheDocument();
    // "Try again", not "Retry" — the word the pattern chose.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^retry$/i })).not.toBeInTheDocument();
  });

  it("keeps showing the gate while the service is still answering", () => {
    membershipsData = []; // resolved: zero orgs → the auto-create path
    render(<SelectOrganizationPage />);
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
