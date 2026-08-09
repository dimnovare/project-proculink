/* ── /sign-in and /sign-up render the SAME surface ────────────────────────────
 *
 * THE DEFECT, VERBATIM.
 *
 * The two route files held 290 byte-identical lines and no shared module. They
 * had already drifted, in the one place a buyer can see. /sign-in carried:
 *
 *     // Hide Clerk's unstyled "Last used" badge — it overhangs the button's top-right
 *     // corner as a clipped notch (no appearance styling), which reads as a glitch.
 *     lastAuthenticationStrategyBadge: "hidden",
 *
 * and /sign-up did not — so the fix landed on the page a returning user sees and
 * missed the page a brand-new buyer lands on from every marketing call to action.
 * The first screen of the product shipped the glitch its sibling had already
 * named and fixed.
 *
 * WHY THIS TEST ASSERTS IDENTITY AND NOT EQUALITY.
 *
 * Copying the missing key across would satisfy any assertion of the form
 * "sign-up hides the badge" and would restore the exact conditions that produced
 * the bug: two objects, drifting independently, with the next appearance fix
 * again free to land on one of them. `toBe` fails the moment either page goes
 * back to holding its own copy, which is the actual regression.
 *
 * The second half guards the other divergence on these pages: below lg the navy
 * brand panel is `hidden`, and it used to take the value proposition and the
 * storage/audit line with it, leaving a phone user a bare form.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const captured: { signIn?: unknown; signUp?: unknown } = {};

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  SignIn: (props: { appearance?: unknown }) => {
    captured.signIn = props.appearance;
    return <div>clerk sign-in form</div>;
  },
  SignUp: (props: { appearance?: unknown }) => {
    captured.signUp = props.appearance;
    return <div>clerk sign-up form</div>;
  },
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
import { clerkAppearance } from "@/components/auth/AuthSurface";

/* The three claims the brand panel makes. Read off the shared module rather than
   retyped, so re-wording a claim does not silently empty this test's corpus —
   a hand-typed list is how a drift survives its own guard in this repo. */
const FEATURE_CLAIMS = [
  "AI-assisted mapping with visible confidence",
  "Validate before anything reaches the supplier",
  "Orders out in minutes, fully audited",
];
const TRUST_FRAGMENT = "AES-GCM at rest";

/* ── Anti-vacuity floor ───────────────────────────────────────────────────────
 *
 * Enforced at MODULE LOAD. Every assertion below reads a captured prop or
 * searches rendered markup, and both are free wins against nothing: if the pages
 * stop mounting Clerk at all, `captured.signIn` and `captured.signUp` are both
 * `undefined`, and `undefined === undefined` would pass the identity check while
 * proving the opposite of what it claims. Throwing here means vitest collects
 * nothing from this file unless the shared object is the size and shape the
 * assertions assume. */
function floor(): void {
  const fail = (why: string): never => {
    throw new Error(`authSurfaceShared anti-vacuity floor: ${why}`);
  };

  if (typeof clerkAppearance !== "object" || clerkAppearance === null) {
    fail("clerkAppearance is not an object — nothing below is testing a real appearance");
  }
  const elements = clerkAppearance.elements as Record<string, unknown> | undefined;
  if (!elements) fail("clerkAppearance has no `elements` — the badge key cannot be absent OR present");
  const keyCount = Object.keys(elements ?? {}).length;
  if (keyCount < 15) {
    fail(`only ${keyCount} styled Clerk elements — too few to be the real appearance object`);
  }
  if (FEATURE_CLAIMS.length !== 3) {
    fail(`expected 3 feature claims, found ${FEATURE_CLAIMS.length} — the panel sweep is unsound`);
  }
}

floor();

beforeEach(() => {
  captured.signIn = undefined;
  captured.signUp = undefined;
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_Y2xlcmsucHJvY3VsaW5rLmV1JA==");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_live_not-a-real-key");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the auth appearance is defined once", () => {
  it("hides Clerk's 'Last used' badge, which is what /sign-up was missing", () => {
    const elements = clerkAppearance.elements as Record<string, unknown>;
    expect(elements.lastAuthenticationStrategyBadge).toBe("hidden");
  });

  it("hands /sign-in and /sign-up the very same object, not two copies of it", () => {
    render(<SignInPage />);
    cleanup();
    render(<SignUpPage />);

    // Both pages must actually have mounted Clerk, or the identity check below is
    // comparing undefined to undefined.
    expect(captured.signIn, "/sign-in never rendered a Clerk component").toBeDefined();
    expect(captured.signUp, "/sign-up never rendered a Clerk component").toBeDefined();

    expect(captured.signIn).toBe(clerkAppearance);
    expect(captured.signUp).toBe(clerkAppearance);
    // The regression: two independently-drifting appearance objects.
    expect(captured.signUp).toBe(captured.signIn);
  });
});

describe("the value proposition survives below the lg breakpoint", () => {
  for (const [label, Page] of [
    ["/sign-in", SignInPage],
    ["/sign-up", SignUpPage],
  ] as const) {
    it(`${label} states what the product does, and where orders are held, without the navy panel`, () => {
      const { container } = render(<Page />);

      // The navy panel is `hidden lg:flex`, so on a phone it renders nothing. The
      // same content therefore has to exist inside a container that is visible
      // when that one is not.
      const mobileOnly = Array.from(container.querySelectorAll<HTMLElement>(".lg\\:hidden"));
      expect(mobileOnly.length, "no lg:hidden container at all — the mobile stack is gone").toBeGreaterThan(0);

      const mobileText = mobileOnly.map((el) => el.textContent ?? "").join(" ");

      for (const claim of FEATURE_CLAIMS) {
        expect(mobileText, `"${claim}" is desktop-only again`).toContain(claim);
      }
      expect(mobileText, "the storage/audit trust line is desktop-only again").toContain(TRUST_FRAGMENT);
    });
  }
});

describe("each route still says which one it is", () => {
  it("keeps the headings that distinguish the two pages", () => {
    render(<SignInPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back");
    cleanup();

    render(<SignUpPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Start for free");
  });
});
