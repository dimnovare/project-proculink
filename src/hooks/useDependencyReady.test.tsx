// useDependencyReady — where the deadline's clock starts (WP-32 follow-up, F2).
//
// THE DEFECT THIS PINS. The deadline is a setTimeout started inside a
// useEffect, so it is measured from HYDRATION, not from navigation. The
// product promise is wall clock ("an explanatory card within 10s"), and by the
// time React mounts, the document fetch, the JS download, the parse and the
// hydrate have already been spent — out of the same budget. Measuring from
// mount silently adds all of that back on, so the wall-clock time to the card
// varies with page load time and the ceiling is not guaranteed.
//
// The dependency this bounds is requested by the DOCUMENT (ClerkProvider
// renders `<script src=… async>`, so the fetch starts while the HTML is still
// parsing), which is why "navigation" is the honest anchor for it.
//
// A jsdom test cannot prove a wall-clock number. What it CAN prove — and what
// these tests prove — is the mechanism: the budget is computed from the
// navigation clock, not from mount.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";

let elapsedSinceNavigation = 0;
vi.mock("@/lib/navigationClock", () => ({
  msSinceNavigationStart: () => elapsedSinceNavigation,
}));

import {
  useDependencyReady,
  MIN_WAIT_AFTER_MOUNT_MS,
  type UseDependencyReadyOptions,
} from "./useDependencyReady";

function Probe(opts: UseDependencyReadyOptions) {
  const { status } = useDependencyReady(opts);
  return <div data-testid="status">{status}</div>;
}

function status() {
  return screen.getByTestId("status").textContent;
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  elapsedSinceNavigation = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDependencyReady", () => {
  it("measures from mount by default", () => {
    elapsedSinceNavigation = 5_000;
    render(<Probe ready={false} timeoutMs={8_000} />);

    // The navigation clock is irrelevant to the default anchor: the full
    // timeout must still be available after mount.
    advance(7_999);
    expect(status()).toBe("pending");
    advance(1);
    expect(status()).toBe("unavailable");
  });

  it("spends the time that hydration already consumed when anchored to navigation", () => {
    elapsedSinceNavigation = 3_000;
    render(<Probe ready={false} timeoutMs={8_000} since="navigation" />);

    // 3s of the 8s budget is already gone, so only 5s of it is left. Under the
    // mount anchor this would still be pending at 5s and the card would land
    // 3s later in wall-clock terms than the budget says.
    advance(4_999);
    expect(status()).toBe("pending");
    advance(1);
    expect(status()).toBe("unavailable");
  });

  it("still gives the dependency a floor of time when the budget is already spent", () => {
    // Slow device / slow link: hydration alone outran the whole budget. The
    // remaining budget is negative, but the card must not appear in the same
    // frame the component mounts — the dependency's own handshake can still be
    // in flight, and a card that flashes before it resolves reads as a hard
    // error page rather than a bounded wait.
    elapsedSinceNavigation = 30_000;
    render(<Probe ready={false} timeoutMs={8_000} since="navigation" />);

    expect(status()).toBe("pending");
    advance(MIN_WAIT_AFTER_MOUNT_MS - 1);
    expect(status()).toBe("pending");
    advance(1);
    expect(status()).toBe("unavailable");
  });

  it("keeps the budget stable across re-renders", () => {
    // The budget is read from a clock that moves. If it were recomputed every
    // render it would land in the effect's dependency array with a new value
    // each time, the timer would be torn down and restarted on every render,
    // and it would never fire at all.
    elapsedSinceNavigation = 1_000;
    const { rerender } = render(<Probe ready={false} timeoutMs={8_000} since="navigation" />);

    advance(3_000);
    elapsedSinceNavigation = 4_000;
    rerender(<Probe ready={false} timeoutMs={8_000} since="navigation" />);
    advance(3_000);
    elapsedSinceNavigation = 7_000;
    rerender(<Probe ready={false} timeoutMs={8_000} since="navigation" />);

    // 6s of the 7s remaining budget has passed across three renders.
    expect(status()).toBe("pending");
    advance(1_000);
    expect(status()).toBe("unavailable");
  });

  it("never reports unavailable while the dependency is ready or disarmed", () => {
    elapsedSinceNavigation = 30_000;
    const { rerender } = render(<Probe ready armed timeoutMs={8_000} since="navigation" />);
    advance(60_000);
    expect(status()).toBe("ready");

    rerender(<Probe ready={false} armed={false} timeoutMs={8_000} since="navigation" />);
    advance(60_000);
    expect(status()).toBe("ready");
  });
});
