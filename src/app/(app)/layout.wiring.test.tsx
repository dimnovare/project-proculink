// The (app) shell really is behind the sign-in gate (WP-32 follow-up, F4).
//
// THE DEFECT THIS PINS. The original wiring assertion read this layout as a
// STRING and regexed for `/<ClerkAvailabilityGate>/`. It never rendered it, so
// two realistic regressions kept every gate green with the gate dead:
//
//   R15 — comment the JSX out. `{/* <ClerkAvailabilityGate> */}` still matches
//         the regex. The forever-spinner is fully restored.
//   R17 — leave `<ClerkAvailabilityGate>{null}</ClerkAvailabilityGate>` beside
//         an UNGATED shell. The gate mounts, waits, and replaces nothing. This
//         is the refactor shape: someone reorganising the provider stack moves
//         the closing tag.
//
// Under R17 the whole toolchain — vitest, tsc --noEmit, next lint, next build —
// was green with the gate dead. Four gates, zero detection.
//
// So this renders the REAL layout and asserts the BEHAVIOUR: past the deadline
// the card is on screen AND the shell is gone. R15 fails the first half, R17
// fails the second.
//
// WHAT IS MOCKED, AND WHY IT DOES NOT DEFEAT THE POINT. The chrome components
// (topbar, sidebar, workspace nudge) and the MSW provider are stubbed because
// they drag in the whole data layer and are not what is under test. Two things
// are deliberately NOT stubbed: <ClerkAvailabilityGate> itself, and the shell
// `<div>`/`<main id="main-content">` — those are written inline in layout.tsx,
// so a mutation that unwraps them has nowhere to hide.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";

let clerkLoaded = false;
let clerkSignedIn = false;
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: clerkLoaded, isSignedIn: clerkSignedIn }),
  useOrganization: () => ({ organization: null }),
  useOrganizationList: () => ({ userMemberships: { data: undefined }, setActive: undefined }),
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

vi.mock("@/mocks/MSWProvider", () => ({
  MSWProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/bridge/BridgeTopbar", () => ({
  BridgeTopbar: () => <div>topbar</div>,
}));
vi.mock("@/components/bridge/BridgeSidebar", () => ({
  BridgeSidebar: () => <div>sidebar</div>,
}));
vi.mock("@/components/onboarding/WorkspaceNameNudge", () => ({
  WorkspaceNameNudge: () => null,
}));

import AppShellLayout from "./layout";
import { CLERK_LOAD_DEADLINE_MS } from "@/components/bridge/ClerkAvailabilityGate";

const PAGE_CONTENT = "the page a route rendered";

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function shell() {
  return document.querySelector("#main-content");
}

beforeEach(() => {
  vi.useFakeTimers();
  clerkLoaded = false;
  clerkSignedIn = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("(app) layout — sign-in gate wiring", () => {
  it("renders the shell while the sign-in service is still coming", () => {
    render(
      <AppShellLayout>
        <div>{PAGE_CONTENT}</div>
      </AppShellLayout>,
    );
    advance(CLERK_LOAD_DEADLINE_MS - 1);

    expect(shell()).not.toBeNull();
    expect(screen.getByText(PAGE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the whole shell with the card once the deadline passes", () => {
    render(
      <AppShellLayout>
        <div>{PAGE_CONTENT}</div>
      </AppShellLayout>,
    );
    advance(CLERK_LOAD_DEADLINE_MS);

    // R15 (gate commented out) fails here — no card ever appears.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Can’t reach the sign-in service",
    );

    // R17 (gate wrapping {null} beside an ungated shell) fails here — the card
    // mounts but the starving shell is still on the page behind it.
    expect(shell()).toBeNull();
    expect(screen.queryByText(PAGE_CONTENT)).not.toBeInTheDocument();
    // Exactly one h1: the card owns the document heading, the shell is gone.
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("keeps the shell when the sign-in service is healthy", () => {
    clerkLoaded = true;
    clerkSignedIn = true;
    render(
      <AppShellLayout>
        <div>{PAGE_CONTENT}</div>
      </AppShellLayout>,
    );
    advance(CLERK_LOAD_DEADLINE_MS * 4);

    expect(shell()).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
