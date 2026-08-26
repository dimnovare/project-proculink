import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /operations/exceptions — the unrecognised-state guard.
//
// THE DEFECT THIS PINS, verbatim. The row's entire right-hand end was one equality,
// written twice (once in the desktop table cell, once in the mobile card):
//
//     {exc.state === "open" ? ( <Resolve/OpenOrder/> <Ignore/> ) : (
//       <span style={{ color: "var(--ink-faint)" }}>{exc.state ?? "—"}</span>
//     )}
//
// There was no third branch, so a state this build has never heard of took the ELSE —
// and the else is the SETTLED branch, the one `resolved` and `ignored` render in. A live,
// open, blocking exception therefore appeared as a faint grey word with Resolve, Open
// order and Ignore all gone: it read as already dealt with and offered no way to act on
// it, on the one screen whose job is "every order that needs a human decision before it
// can be sent". A row that arrived with no state at all rendered as `—`.
//
// This is the seventh instance of one class in this codebase — an unknown or absent value
// resolving to a confident, favourable answer. So the guard runs in BOTH directions, and
// it has to: a fix that flattened every state into one vague "needs attention" would
// satisfy the unknown half on its own. The recognised half below pins that `open`,
// `resolved` and `ignored` still render EXACTLY what they rendered before this change,
// down to the DOM text.
//
// EVERY ASSERTION IS DERIVED FROM src/lib/exceptionStateManifest.ts, never from a state
// literal. The manifest is diffed against the real C# by src/test/backendMirror.test.ts,
// so these tests inherit that anchoring instead of inventing their own vocabulary. The
// only literals in this file are the STRANGERS — values asserted to be strangers.

import ExceptionsPage from "./page";
import {
  ACTIONABLE_EXCEPTION_STATES,
  EXCEPTION_STATES,
  EXCEPTION_STATE_FACTS,
  MISSING_EXCEPTION_STATE_LABEL,
  SETTLED_EXCEPTION_STATES,
  UNRECOGNISED_EXCEPTION_LABEL,
  exceptionOffersActions,
  exceptionReadsAsHandled,
  exceptionRowPresentation,
  exceptionStateFact,
} from "@/lib/exceptionStateManifest";
import type { OrderException } from "@/types/procurement";

/**
 * The state the bug was reported against. No backend writer produces it, and before this
 * fix it rendered as a settled row with every control stripped.
 */
const THE_BUG = "escalated";

/**
 * Values this build must treat as unplaceable. `""` and `"   "` are the absent-state
 * shapes that used to render as `—`; `"Open"` is the case variant — the backend writes
 * lowercase only, so a capitalised one is a stranger and must fail SAFE, not match.
 */
const STRANGERS: readonly (string | null | undefined)[] = [
  THE_BUG,
  "snoozed",
  "acknowledged",
  "closed",
  "Open",
  "",
  "   ",
  null,
  undefined,
];

// ── Anti-vacuity floor ───────────────────────────────────────────────────────
//
// Enforced at MODULE LOAD, deliberately, and not only as a test. Every sweep below
// iterates a list, and a sweep over an empty list passes each `toBeNull` / `not.toContain`
// it contains for free. A floor written as the first `describe` still leaves the negative
// assertions to run after it fails, so it does not actually prevent the vacuous pass — it
// only reports alongside it. Throwing here means vitest collects nothing from this file
// unless the vocabulary is the size and shape the assertions assume.
//
// This repo has shipped the vacuous shape before, which is why the floor is this rude.

function floor(): void {
  const fail = (why: string): never => {
    throw new Error(`exceptionStateGate anti-vacuity floor: ${why}`);
  };

  if (EXCEPTION_STATES.length !== 3) {
    fail(`expected 3 exception states, found ${EXCEPTION_STATES.length} — every sweep below is unsound`);
  }
  if (EXCEPTION_STATE_FACTS.length !== EXCEPTION_STATES.length) {
    fail("EXCEPTION_STATE_FACTS and EXCEPTION_STATES disagree on size");
  }
  if (new Set(EXCEPTION_STATES).size !== EXCEPTION_STATES.length) {
    fail("a state is listed twice, so a per-state sweep would test one of them twice and another never");
  }
  if (ACTIONABLE_EXCEPTION_STATES.length === 0) {
    fail("no state offers actions — 'the row shows its controls' would be unfalsifiable");
  }
  if (SETTLED_EXCEPTION_STATES.length === 0) {
    fail("no state is settled — 'unknown must not render as settled' would have nothing to differ from");
  }
  if (ACTIONABLE_EXCEPTION_STATES.length + SETTLED_EXCEPTION_STATES.length !== EXCEPTION_STATES.length) {
    fail("the actionable and settled sets do not partition the vocabulary");
  }
  if (STRANGERS.length < 5) {
    fail(`only ${STRANGERS.length} stranger values — too few to call this a sweep`);
  }
  const known = new Set<string>(EXCEPTION_STATES);
  for (const s of STRANGERS) {
    if (typeof s === "string" && known.has(s.trim()) && s.trim().length > 0) {
      fail(`'${s}' is in the real vocabulary, so asserting it is a stranger asserts the opposite of the truth`);
    }
  }
}

floor();

// ── Mocks ────────────────────────────────────────────────────────────────────

const getExceptions = vi.fn();
const resolveException = vi.fn();
const ignoreException = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => push(...args), replace: vi.fn() }),
  usePathname: () => "/operations/exceptions",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

// Spread the real module: the page pulls three functions from it, but the components it
// renders pull others, and a hand-written stub would fail on whichever one moved next.
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

afterEach(() => {
  cleanup();
  getExceptions.mockReset();
  resolveException.mockReset();
  ignoreException.mockReset();
  push.mockReset();
});

// ── Rendering helpers ────────────────────────────────────────────────────────

function exceptionRow(
  state: string | null | undefined,
  i: number,
  orderId: string | null = `ord-${i}`,
): OrderException {
  return {
    id: `exc-${i}`,
    orderId,
    lineId: null,
    stage: "deliver",
    code: `CODE_${i}`,
    severity: "error",
    message: `Message ${i}`,
    state,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/**
 * Renders the page over `states` and returns the desktop table.
 *
 * The desktop table and the mobile card list BOTH render in jsdom, so every row query is
 * scoped to one of them — an unscoped `getByText` would match twice and throw.
 */
async function renderRows(
  states: readonly (string | null | undefined)[],
  orderIdFor: (i: number) => string | null = (i) => `ord-${i}`,
): Promise<HTMLElement> {
  getExceptions.mockResolvedValue(states.map((s, i) => exceptionRow(s, i, orderIdFor(i))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExceptionsPage />
    </QueryClientProvider>,
  );
  const nodes = await screen.findAllByText("Message 0");
  const table = nodes.map((n) => n.closest("table")).find((t): t is HTMLTableElement => t !== null);
  if (!table) throw new Error("the exceptions page rendered no desktop table");
  return table;
}

/** The desktop row for exception `i`, found by its message rather than by index. */
function rowFor(table: HTMLElement, i: number): HTMLElement {
  const cell = within(table).getByText(`Message ${i}`);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no desktop row for Message ${i}`);
  return row;
}

/** The mobile card for exception `i`. Walks up to the child of the `md:hidden` list. */
function mobileCardFor(i: number): HTMLElement {
  const node = screen.getAllByText(`Message ${i}`).find((n) => n.closest("table") === null);
  if (!node) throw new Error(`no mobile card for Message ${i}`);
  let el: HTMLElement | null = node;
  while (el && !(el.parentElement?.className ?? "").includes("md:hidden")) {
    el = el.parentElement;
  }
  if (!el) throw new Error(`Message ${i} is not inside the mobile list — the card markup moved`);
  return el;
}

/** The three controls, by accessible name. `null` where the control is absent. */
function controlsIn(scope: HTMLElement) {
  return {
    resolve: within(scope).queryByRole("button", { name: /^resolve$/i }),
    openOrder: within(scope).queryByRole("button", { name: /^open order$/i }),
    ignore: within(scope).queryByRole("button", { name: /^ignore$/i }),
  };
}

/** Whether this row carries the "we cannot place this state" notice. */
function hasUnrecognisedNotice(scope: HTMLElement): boolean {
  const pattern = new RegExp(`${UNRECOGNISED_EXCEPTION_LABEL}|${MISSING_EXCEPTION_STATE_LABEL}`, "i");
  return within(scope).queryAllByText(pattern).length > 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// The floor, restated as visible tests so a green run says what it covered.
// ═════════════════════════════════════════════════════════════════════════════

describe("the vocabulary being exercised is real and the size these sweeps assume", () => {
  it("has the three states the backend writes, no more and no fewer", () => {
    expect(EXCEPTION_STATES).toHaveLength(3);
    expect(EXCEPTION_STATE_FACTS).toHaveLength(EXCEPTION_STATES.length);
    expect(new Set(EXCEPTION_STATES).size, "a state is listed twice").toBe(EXCEPTION_STATES.length);
  });

  it("has at least one actionable and one settled state, and they partition the set", () => {
    // Without this, "no state is settled" would satisfy every negative assertion below
    // while the screen was just as broken as the bug being fixed — silently, and green.
    expect(ACTIONABLE_EXCEPTION_STATES.length).toBeGreaterThan(0);
    expect(SETTLED_EXCEPTION_STATES.length).toBeGreaterThan(0);
    expect([...ACTIONABLE_EXCEPTION_STATES, ...SETTLED_EXCEPTION_STATES].sort()).toEqual(
      [...EXCEPTION_STATES].sort(),
    );
  });

  it("sweeps a non-trivial number of stranger values, none of which is a real state", () => {
    expect(STRANGERS.length).toBeGreaterThanOrEqual(5);
    for (const s of STRANGERS) {
      if (typeof s === "string" && s.trim().length > 0) {
        expect(EXCEPTION_STATES, `'${s}' is not actually a stranger`).not.toContain(s.trim());
      }
    }
  });

  it("cites a real backend file:line and a note for every state", () => {
    for (const fact of EXCEPTION_STATE_FACTS) {
      expect(fact.backendSite, `${fact.state} cites no backend site`).toMatch(
        /^ProcuLink\.[\w.]+\/[\w./]+\.cs:\d+$/,
      );
      expect(fact.note.length, `${fact.state} has no note`).toBeGreaterThan(20);
      expect(fact.label.length, `${fact.state} has no operator-facing label`).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DIRECTION 1 — an unrecognised state must not read as handled, and keeps its actions.
// ═════════════════════════════════════════════════════════════════════════════

describe("the state the row used to fall through on", () => {
  it("is unknown to the manifest", () => {
    expect(exceptionStateFact(THE_BUG)).toBeNull();
    expect(EXCEPTION_STATES).not.toContain(THE_BUG);
  });

  it("does not read as handled — the whole defect, in one assertion", () => {
    expect(exceptionReadsAsHandled(THE_BUG)).toBe(false);
    expect(exceptionRowPresentation(THE_BUG).kind).not.toBe("settled");
  });

  it("keeps its actions", () => {
    expect(exceptionOffersActions(THE_BUG)).toBe(true);
  });

  it("does not claim to be a state the backend never sent", () => {
    // The same lie pointing the other way: relabelling an unplaceable row "Open" would
    // invent a status. It must read as unplaceable, not as a member of the vocabulary.
    const presentation = exceptionRowPresentation(THE_BUG);
    expect(presentation.kind).toBe("unrecognised");
    if (presentation.kind !== "unrecognised") throw new Error("unreachable");
    expect(presentation.label).toContain(THE_BUG);
    expect(presentation.detail.length).toBeGreaterThan(40);
  });

  it("renders on the DESKTOP row with its controls and a notice, not as a settled word", async () => {
    const table = await renderRows([THE_BUG]);
    const row = rowFor(table, 0);

    // Kept its way forward. This row has an owning order, so the primary control is
    // "Open order" — exactly what an `open` row in the same shape offers.
    expect(controlsIn(row).openOrder, "an unplaceable row lost its Open order button").not.toBeNull();
    expect(controlsIn(row).ignore, "an unplaceable row lost its Ignore button").not.toBeNull();
    expect(controlsIn(row).ignore).toBeEnabled();

    // Said what it does not know.
    expect(hasUnrecognisedNotice(row), "an unplaceable row said nothing about being unplaceable").toBe(true);
  });

  it("renders on the MOBILE card with its controls and a notice — the defect existed twice", async () => {
    await renderRows([THE_BUG]);
    const card = mobileCardFor(0);

    expect(controlsIn(card).openOrder).not.toBeNull();
    expect(controlsIn(card).ignore).not.toBeNull();
    expect(hasUnrecognisedNotice(card)).toBe(true);
  });

  it("offers Resolve instead of Open order when there is no order to open", async () => {
    // The list-clearable branch is a property of the ORDER, not of the state, so an
    // unplaceable row must follow the same rule an `open` row does.
    const table = await renderRows([THE_BUG], () => null);
    const controls = controlsIn(rowFor(table, 0));
    expect(controls.resolve).not.toBeNull();
    expect(controls.openOrder).toBeNull();
    expect(controls.ignore).not.toBeNull();
  });

  it("holds for every stranger, not just the reported one", async () => {
    for (const stranger of STRANGERS) {
      expect(exceptionReadsAsHandled(stranger), `'${stranger}' read as handled`).toBe(false);
      expect(exceptionOffersActions(stranger), `'${stranger}' lost its actions`).toBe(true);
      expect(exceptionRowPresentation(stranger).kind).toBe("unrecognised");
    }
  });

  it("names the missing case honestly instead of rendering a dash", () => {
    // `—` was what an absent state rendered as: a row that says nothing and does nothing.
    for (const blank of [null, undefined, "", "   "] as const) {
      const presentation = exceptionRowPresentation(blank);
      expect(presentation.kind).toBe("unrecognised");
      if (presentation.kind !== "unrecognised") throw new Error("unreachable");
      expect(presentation.label).toBe(MISSING_EXCEPTION_STATE_LABEL);
      expect(presentation.label).not.toBe("—");
    }
  });

  it("renders a state-less row with controls, not as a dash", async () => {
    const table = await renderRows([null]);
    const row = rowFor(table, 0);
    expect(controlsIn(row).openOrder).not.toBeNull();
    expect(controlsIn(row).ignore).not.toBeNull();
    expect(within(row).queryByText("—"), "a state-less row still renders the old dead dash").toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DIRECTION 2 — every recognised state still renders EXACTLY as it does today.
//
// This half is what stops the fix passing by flattening the vocabulary into one vague
// "needs attention" state. Each recognised state is pinned to its own distinct rendering.
// ═════════════════════════════════════════════════════════════════════════════

describe("every state the backend writes renders exactly as it did before this change", () => {
  it("renders one row per state and never mistakes one for another", async () => {
    const table = await renderRows(EXCEPTION_STATES);
    expect(within(table).getAllByRole("row")).toHaveLength(EXCEPTION_STATES.length + 1); // + header

    EXCEPTION_STATES.forEach((state, i) => {
      const row = rowFor(table, i);
      const settled = SETTLED_EXCEPTION_STATES.includes(state);

      if (settled) {
        // A faint word and no controls — the shipped behaviour, unchanged. The DOM text is
        // the RAW value: the `capitalize` class is CSS, and CSS does not touch textContent.
        expect(within(row).getByText(state), `${state} lost its state word`).toBeTruthy();
        const controls = controlsIn(row);
        expect(controls.resolve, `${state} grew a Resolve button`).toBeNull();
        expect(controls.openOrder, `${state} grew an Open order button`).toBeNull();
        expect(controls.ignore, `${state} grew an Ignore button`).toBeNull();
      } else {
        // Actionable — controls, and no state word taking their place.
        const controls = controlsIn(row);
        expect(controls.openOrder, `${state} lost its Open order button`).not.toBeNull();
        expect(controls.ignore, `${state} lost its Ignore button`).not.toBeNull();
      }

      expect(
        hasUnrecognisedNotice(row),
        `${state} is in the vocabulary but was labelled unrecognised`,
      ).toBe(false);
    });
  });

  it("renders the same way on the mobile card as on the desktop row", async () => {
    await renderRows(EXCEPTION_STATES);

    EXCEPTION_STATES.forEach((state, i) => {
      const card = mobileCardFor(i);
      const controls = controlsIn(card);
      if (SETTLED_EXCEPTION_STATES.includes(state)) {
        expect(within(card).getByText(state)).toBeTruthy();
        expect(controls.ignore, `${state} grew an Ignore button on mobile`).toBeNull();
      } else {
        expect(controls.ignore, `${state} lost its Ignore button on mobile`).not.toBeNull();
      }
      expect(hasUnrecognisedNotice(card)).toBe(false);
    });
  });

  it("offers Resolve rather than Open order on an actionable row with no owning order", async () => {
    const table = await renderRows(ACTIONABLE_EXCEPTION_STATES, () => null);
    ACTIONABLE_EXCEPTION_STATES.forEach((_state, i) => {
      const controls = controlsIn(rowFor(table, i));
      expect(controls.resolve).not.toBeNull();
      expect(controls.openOrder).toBeNull();
    });
  });

  it("gives each state its own answer — the fix did not flatten them together", () => {
    // Directly falsifies "make everything actionable" and "make everything settled".
    const kinds = EXCEPTION_STATES.map((s) => exceptionRowPresentation(s).kind);
    expect(new Set(kinds).size, "every recognised state now renders identically").toBeGreaterThan(1);
    expect(kinds).toContain("needs_action");
    expect(kinds).toContain("settled");
    expect(kinds, "a state the backend writes is being called unrecognised").not.toContain("unrecognised");
  });

  it("keeps each settled state's own word rather than one shared label", () => {
    const words = SETTLED_EXCEPTION_STATES.map((s) => {
      const presentation = exceptionRowPresentation(s);
      if (presentation.kind !== "settled") throw new Error(`${s} is no longer settled`);
      return presentation.stateWord;
    });
    expect(new Set(words).size, "the settled states collapsed onto one word").toBe(words.length);
    expect(words).toEqual([...SETTLED_EXCEPTION_STATES]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The filter tabs are derived, not a fourth hand-typed copy.
// ═════════════════════════════════════════════════════════════════════════════

describe("the state filter tabs", () => {
  it("offers All plus exactly one tab per state, labelled from the manifest", async () => {
    await renderRows(EXCEPTION_STATES);
    for (const fact of EXCEPTION_STATE_FACTS) {
      expect(
        screen.getByRole("button", { name: fact.label }),
        `no filter tab for ${fact.state}`,
      ).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
  });
});
