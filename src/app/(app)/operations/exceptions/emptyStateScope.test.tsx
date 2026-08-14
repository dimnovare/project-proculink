import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /operations/exceptions — the empty state spoke for the account from one filter's result.
//
// THE DEFECT THIS PINS, verbatim. One empty state served all four tabs:
//
//     {!showLoading && !isError && exceptions.length === 0 && (
//       ... <p>No issues — all clear</p>
//           <p>Nothing is blocked right now. Issues appear here when an order needs a
//              decision before it can be sent to a supplier.</p>
//
// `exceptions` is `data ?? []` and `data` is `getExceptions(activeState)` — ONE QUERY PER
// TAB, keyed on the tab. So `length === 0` means "this filter returned nothing", and the
// screen read it as "this account has nothing". Select Ignored on an account that has
// ignored nothing and the page printed a green tick, "No issues — all clear" and "Nothing
// is blocked right now" — while the Open tab, one click away, held live blockers on orders
// that could not be sent.
//
// This is the same class as the unrecognised-state bug pinned next door in
// exceptionStateGate.test.tsx: an ABSENT answer rendering as the FAVOURABLE one. The
// control below is therefore the actual defect — a non-All tab with an empty result set
// while another tab has rows. A test that only exercised the All tab would have passed
// against the broken code, which is exactly how this shipped.
//
// Every label comes from src/lib/exceptionStateManifest.ts, never from a state literal, so
// a fourth state cannot quietly escape the sweep.

import ExceptionsPage from "./page";
import {
  ACTIONABLE_EXCEPTION_STATES,
  EXCEPTION_STATES,
  EXCEPTION_STATE_FACTS,
  type ExceptionStateName,
} from "@/lib/exceptionStateManifest";
import type { OrderException } from "@/types/procurement";

/**
 * The tab label the page derives for the unfiltered view. Matches STATE_TABS[0].
 *
 * Widened to `string` on purpose: the floor below compares it against every manifest
 * label, and as a literal type TS would call that comparison impossible and narrow the
 * loop variable to `never` — collapsing a real collision check into a compile error.
 */
const ALL_TAB_LABEL: string = "All";

/** The verdict only the All tab may print. Both halves, as they render. */
const ALL_CLEAR_HEADLINE = "no issues — all clear";
const ALL_CLEAR_BODY = "nothing is blocked right now";

/**
 * The state that carries live, blocking work — the one whose rows exist while another
 * tab is empty. Derived, not typed: whichever state the manifest says is actionable.
 */
const LIVE_STATE: ExceptionStateName = ACTIONABLE_EXCEPTION_STATES[0];

/** Tabs that return nothing for the fixture account — the ones that used to lie. */
const EMPTY_TABS = EXCEPTION_STATE_FACTS.filter((f) => f.state !== LIVE_STATE);

// ── Anti-vacuity floor ───────────────────────────────────────────────────────
//
// Thrown at module load, not asserted in a test, for the reason exceptionStateGate.test.tsx
// gives: a sweep over an empty list satisfies every `not.toContain` in it for free, and a
// floor written as the first `describe` reports the vacuity alongside the vacuous pass
// instead of preventing it.

function floor(): void {
  const fail = (why: string): never => {
    throw new Error(`emptyStateScope anti-vacuity floor: ${why}`);
  };
  if (EXCEPTION_STATES.length < 2) {
    fail("fewer than two states — 'one tab is empty while another has rows' is unstageable");
  }
  if (ACTIONABLE_EXCEPTION_STATES.length === 0) {
    fail("no actionable state — the fixture account could not hold a live blocker");
  }
  if (EMPTY_TABS.length === 0) {
    fail("every tab holds rows in the fixture — the empty state would never render");
  }
  if (EMPTY_TABS.some((f) => f.state === LIVE_STATE)) {
    fail("the live state is also being asserted empty — the fixture contradicts itself");
  }
  for (const f of EXCEPTION_STATE_FACTS) {
    if (f.label.trim().length === 0) fail(`${f.state} has no tab label to scope the copy with`);
    if (f.label === ALL_TAB_LABEL) fail(`${f.state} is labelled "${ALL_TAB_LABEL}" — it would be indistinguishable from the unfiltered tab`);
  }
}

floor();

// ── Mocks ────────────────────────────────────────────────────────────────────

const getExceptions = vi.fn();
const resolveException = vi.fn();
const ignoreException = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/operations/exceptions",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getExceptions: (...args: unknown[]) => getExceptions(...args),
    resolveException: (...args: unknown[]) => resolveException(...args),
    ignoreException: (...args: unknown[]) => ignoreException(...args),
  };
});

beforeEach(() => {
  getExceptions.mockReset();
});
afterEach(cleanup);

// ── Fixture ──────────────────────────────────────────────────────────────────

const BLOCKER_MESSAGE = "Supplier item code is missing on line 3";

function blocker(): OrderException {
  return {
    id: "exc-live-1",
    orderId: "ord-live-1",
    lineId: null,
    stage: "validate",
    code: "UNRESOLVED_MAPPING",
    severity: "error",
    message: BLOCKER_MESSAGE,
    state: LIVE_STATE,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/**
 * An account with live blockers under `LIVE_STATE` and nothing under any other state.
 * `undefined` is the All tab, which loads every state and therefore sees the blocker.
 */
function accountWithBlockers(): void {
  getExceptions.mockImplementation((state?: ExceptionStateName) =>
    Promise.resolve(state === undefined || state === LIVE_STATE ? [blocker()] : []),
  );
}

/** An account with nothing anywhere — the only case the all-clear verdict is true for. */
function emptyAccount(): void {
  getExceptions.mockImplementation(() => Promise.resolve([]));
}

function renderPage(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExceptionsPage />
    </QueryClientProvider>,
  );
}

/** Everything a person can read on the page, flattened. Not props — rendered text. */
const body = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ").toLowerCase();

async function selectTab(label: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(getExceptions).toHaveBeenCalled());
}

// ═════════════════════════════════════════════════════════════════════════════
// THE DEFECT — a filter with no rows, on an account that is not clear.
// ═════════════════════════════════════════════════════════════════════════════

describe("a filter that returns nothing does not clear the account", () => {
  it.each(EMPTY_TABS.map((f) => [f.label, f.state] as const))(
    "the %s tab says it is the %s tab that is empty, not that nothing is blocked",
    async (label) => {
      accountWithBlockers();
      renderPage();
      await waitFor(() => expect(body()).toContain(BLOCKER_MESSAGE.toLowerCase()));

      await selectTab(label);
      // Settle on a signal this fix does not own: the live tab's rows are gone, so the
      // empty state — whatever it says — is what is on screen. Waiting on the NEW copy
      // instead would make the scoped headline the first thing to fail, and the assertion
      // that has to fail here is the one about the OLD copy.
      await waitFor(() => expect(body()).not.toContain(BLOCKER_MESSAGE.toLowerCase()));

      // The whole defect, in two assertions. The account HAS blockers — they are on the
      // tab this one is not — so neither half of the all-clear verdict may appear.
      expect(
        body(),
        `the ${label} tab printed the account-wide all-clear headline from an empty filter`,
      ).not.toContain(ALL_CLEAR_HEADLINE);
      expect(
        body(),
        `the ${label} tab claimed nothing is blocked while blockers sit on the ${LIVE_STATE} tab`,
      ).not.toContain(ALL_CLEAR_BODY);

      // …and it says which filter it is answering for, so the scope is readable.
      expect(body()).toContain(`no ${label.toLowerCase()} issues`);
    },
  );

  it("the blockers really are one click away — the emptiness was local, not the account", async () => {
    // Without this the sweep above could pass against a page that simply lost its rows.
    accountWithBlockers();
    renderPage();
    const empty = EMPTY_TABS[0].label;

    await selectTab(empty);
    await waitFor(() => expect(body()).toContain(`no ${empty.toLowerCase()} issues`));
    expect(body()).not.toContain(BLOCKER_MESSAGE.toLowerCase());

    await selectTab(ALL_TAB_LABEL);
    await waitFor(() => expect(body()).toContain(BLOCKER_MESSAGE.toLowerCase()));
    expect(body(), "the All tab hid rows it had loaded").not.toContain(ALL_CLEAR_HEADLINE);
  });

  it("names the tab it is speaking for, so the scope is readable and not inferred", async () => {
    accountWithBlockers();
    renderPage();
    await waitFor(() => expect(body()).toContain(BLOCKER_MESSAGE.toLowerCase()));

    for (const fact of EMPTY_TABS) {
      await selectTab(fact.label);
      await waitFor(() => expect(body()).toContain(`no ${fact.label.toLowerCase()} issues`));
      // Points at the tab that can answer for the account instead of answering for it.
      expect(
        body(),
        `the ${fact.label} empty state does not send the reader anywhere that can answer`,
      ).toContain("switch to all");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTROL — the All tab keeps the verdict it is entitled to, word for word.
//
// This half is what stops the fix passing by deleting the all-clear copy outright. An
// account with nothing anywhere IS all clear, and the tab that loads every state is the
// one place that can say so.
// ═════════════════════════════════════════════════════════════════════════════

describe("the All tab still prints the account-wide verdict on a genuinely empty account", () => {
  it("keeps both halves of the all-clear copy", async () => {
    emptyAccount();
    renderPage();

    await waitFor(() => expect(body()).toContain(ALL_CLEAR_HEADLINE));
    expect(body()).toContain(ALL_CLEAR_BODY);
  });

  it("does not scope itself to a filter it is not applying", async () => {
    emptyAccount();
    renderPage();

    await waitFor(() => expect(body()).toContain(ALL_CLEAR_HEADLINE));
    expect(
      body(),
      "the unfiltered tab described itself as a filter",
    ).not.toContain(`no ${ALL_TAB_LABEL.toLowerCase()} issues`);
  });

  it("every scoped tab of an empty account is scoped too — emptiness alone is not all-clear", async () => {
    // The All tab being right does not license the others: on THIS account they are all
    // empty and all of them are still only answering for themselves.
    emptyAccount();
    renderPage();
    await waitFor(() => expect(body()).toContain(ALL_CLEAR_HEADLINE));

    for (const fact of EXCEPTION_STATE_FACTS) {
      await selectTab(fact.label);
      await waitFor(() => expect(body()).toContain(`no ${fact.label.toLowerCase()} issues`));
      expect(body()).not.toContain(ALL_CLEAR_HEADLINE);
    }
  });
});
