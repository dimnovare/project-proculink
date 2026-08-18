// The marketing mobile menu, as a keyboard user meets it.
//
// It shipped as `{open && <div className="fixed inset-0 z-50 …">}` — an opaque
// full-viewport sheet with no role, no aria-modal, no Escape handler, no focus
// move-in and no focus restore. Every assertion below fails against that version:
// there is no [role="dialog"] to find, Escape does nothing, and focus is left
// wherever the click put it instead of returning to the hamburger.
//
// It is navigation by CONTENT, which is why it was left off the modal sweep for
// so long, but it is a modal by BEHAVIOUR: nothing behind it is visible or
// clickable while it is up. So it gets the app shell drawer's treatment
// (`src/app/(app)/layout.tsx`) — dialog marking plus `useDialogA11y`.
//
// The registry side of this is pinned elsewhere: `src/test/dialog-a11y.test.tsx`
// (structural conformance + inventory) and `src/test/unmarked-modal.test.ts`
// (the file is off the unmarked-overlay baseline and stays off).

import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarketingNav } from "@/components/marketing/MarketingNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pricing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The nav lazy-loads `MarketingClerkLinks` (next/dynamic, ssr:false) whenever
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set, and that module calls `useUser()`,
// which throws outside a <ClerkProvider>. Two things made that a real CI failure
// rather than a hypothetical: the key is set in CI and not in a bare local shell,
// and WHEN the dynamic import resolves relative to these assertions is timing, not
// something the test controls — so the same file passed locally with the key set
// and still threw on the runner. Mocking the auth surface removes both variables:
// signed-out is the marketing default, and it holds either way.
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  UserButton: () => null,
}));

// Pin the riskier of the two configurations ON. Without a key the nav skips the
// lazy Clerk module entirely, so a local run would exercise the easy branch and
// leave the branch CI actually runs untested — which is exactly how the first
// version of this file went green here and red on the runner.
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||= "pk_test_marketing_nav_a11y";

/**
 * `useDialogA11y` moves focus in on a rAF, so every open must be flushed. The
 * macrotask after it gives the `next/dynamic` import a turn to resolve and mount,
 * so the Clerk branch is really rendered rather than skipped by timing.
 */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
};

const press = (k: string, shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k, shiftKey });

/** Open the menu from a focused hamburger, the way a keyboard user does. */
async function openMenu() {
  render(<MarketingNav />);
  const trigger = screen.getByRole("button", { name: "Menu" });
  trigger.focus();
  fireEvent.click(trigger);
  await flush();
  const sheet = screen.getByRole("dialog");
  return { trigger, sheet };
}

describe("marketing mobile menu announces itself and gives the keyboard a way back", () => {
  it("is an announced, labelled layer", async () => {
    const { sheet } = await openMenu();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("aria-label", "Menu");
    // The links inside stay navigation — a landmark, not a pile of anchors.
    expect(within(sheet).getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();
  });

  it("the hamburger points at the sheet it controls", async () => {
    const { trigger, sheet } = await openMenu();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(sheet.id);
    expect(sheet.id).not.toBe("");
  });

  it("moves focus into the sheet on open", async () => {
    const { trigger, sheet } = await openMenu();
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("Escape closes it", async () => {
    await openMenu();
    press("Escape");
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the hamburger on close", async () => {
    const { trigger } = await openMenu();
    press("Escape");
    await flush();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the hamburger when the ✕ is used, not only Escape", async () => {
    const { trigger, sheet } = await openMenu();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close menu" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab cycles inside the sheet instead of walking the page behind it", async () => {
    const { sheet } = await openMenu();
    const stops = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(stops.length, "the sheet has no tab stops to cycle").toBeGreaterThan(1);

    stops[stops.length - 1].focus();
    press("Tab");
    expect(document.activeElement, "Tab from the last stop must wrap to the first").toBe(stops[0]);

    stops[0].focus();
    press("Tab", true);
    expect(document.activeElement, "Shift+Tab from the first stop must wrap to the last").toBe(
      stops[stops.length - 1],
    );
  });
});
