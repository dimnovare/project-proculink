// The ladder's numbers, wherever a sentence quotes them, come off `src/lib/plans.ts`.
//
// WHAT THIS PINS. Three surfaces used to retype figures that plans.ts already owns:
// the /pricing SEO description ("from €149/mo", "€0.50 per-order overage"), the
// /sign-up sub-heading ("20 orders free for 14 days"), and the ROI calculator's two
// Pilot sentences ("20 orders", "free for 14 days"). Every one of them was CORRECT
// when this file was written — that is the point. They are the copy nobody revisits
// during a repricing: metadata never renders on the page it describes, /sign-up is a
// screen a pricing change would never bring anyone back to, and the ROI fine print
// sits below the fold under six sliders. A €149 that became €179 in plans.ts would
// have gone on being advertised at €149 in all three places, indefinitely and silently.
//
// So each test comes in a pair, and both halves are load-bearing:
//
//   • BYTE IDENTITY — the shipped sentence is unchanged. The literal here is the
//     contract (this was drift-proofing, not a copy rewrite), so a refactor that
//     quietly reworded a promise fails.
//   • THE DERIVATION BITES — with the ladder re-pointed, the sentence MOVES. Without
//     this half, a hardcoded string passes the first half forever; it is the same
//     shape as the supplier-limit banner that told a 30-supplier Distributor org it
//     had one (CLAUDE.md §11.5), which also read perfectly on the tier it was typed for.
//
// The ladder is re-pointed by mocking `@/lib/plans` with a mutable copy, and each
// surface is re-imported with `vi.resetModules()` because all three read their figures
// at MODULE scope — a mutation applied after the first import would otherwise be
// invisible, and the mutation half would pass vacuously.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Plan, PlanId } from "@/lib/plans";

const h = vi.hoisted(() => ({
  ladder: {} as Record<string, Plan>,
  overage: { value: 0 },
}));

// The mock deliberately populates NOTHING itself: `beforeEach` below restores the
// pristine ladder before any page is imported, so a mutation made inside a test is not
// clobbered when `resetModules` re-runs this factory.
//
// `PLANS` and `OVERAGE_PER_ORDER_EUR` are GETTERS, not values, and that is not tidiness.
// Vitest evaluates this factory once and keeps the namespace it returns across
// `resetModules`, so a value captured here is frozen at the first import and every
// mutation half of every pair below would have passed vacuously — the overage test
// caught exactly that while this file was being written. `PLAN_BY_ID` needs no getter
// because `h.ladder` is the identity the mutations write through.
vi.mock("@/lib/plans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans")>("@/lib/plans");
  return {
    ...actual,
    PLAN_BY_ID: h.ladder,
    get PLANS() {
      return Object.values(h.ladder);
    },
    get OVERAGE_PER_ORDER_EUR() {
      return h.overage.value;
    },
  };
});

// /sign-up mounts Clerk's <SignUp/> behind <ClerkAvailabilityGate>, which reads
// useAuth().isLoaded. Same stubs as src/app/sign-in/authRouteGate.test.tsx.
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
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

// ── What ships today, verbatim ───────────────────────────────────────────────
const SIGN_UP_SUB = "No credit card. 20 orders free for 14 days.";
const ROI_FALLBACK =
  "Start with the free 14-day Pilot — 20 orders, no card required — and upgrade once the savings are real.";
const ROI_FINE_PRINT = "The Pilot tier is free for 14 days (20 orders) and does not require a card.";
const PRICING_DESCRIPTION =
  "Plans for purchase-order automation: a free 14-day pilot, self-serve paid tiers from €149/mo, " +
  "and custom Enterprise. Orders are never blocked — predictable €0.50 per-order overage above your plan.";

let PRISTINE_LADDER: Record<string, Plan> = {};
let PRISTINE_OVERAGE = 0;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans")>("@/lib/plans");
  PRISTINE_LADDER = actual.PLAN_BY_ID;
  PRISTINE_OVERAGE = actual.OVERAGE_PER_ORDER_EUR;
});

beforeEach(() => {
  for (const [id, plan] of Object.entries(PRISTINE_LADDER)) h.ladder[id] = { ...plan };
  h.overage.value = PRISTINE_OVERAGE;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** Rendered copy as a reader meets it, with runs of whitespace collapsed. */
function copyOf(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A floor under every assertion below: a surface that rendered nothing proves nothing. */
function assertRendered(copy: string, where: string): void {
  expect(copy.length, `${where} rendered no copy, so every assertion about it is vacuous`).toBeGreaterThan(60);
}

async function signUpCopy(): Promise<string> {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_Y2xlcmsucHJvY3VsaW5rLmV1JA==");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_live_not-a-real-key");
  vi.resetModules();
  const { default: SignUpPage } = await import("@/app/sign-up/[[...sign-up]]/page");
  const { container } = render(<SignUpPage />);
  const copy = copyOf(container);
  assertRendered(copy, "/sign-up");
  return copy;
}

/**
 * The ROI calculator with its last slider — "% of that work you expect ProcuLink to
 * remove" — dragged to 0. That zeroes the modelled saving, so the recommended plan
 * costs more than it saves and the panel switches from the plan's blurb to the Pilot
 * fallback sentence. It is the only way to reach that sentence, and reaching it is
 * the whole reason this helper drives a control instead of rendering and reading.
 */
async function roiCopyWithNoSavings(): Promise<string> {
  vi.resetModules();
  const { ROICalculator } = await import("@/components/marketing/ROICalculator");
  const { container } = render(<ROICalculator />);
  const sliders = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
  expect(sliders.length, "the ROI calculator no longer renders the slider set this test drives").toBe(7);
  fireEvent.change(sliders[sliders.length - 1], { target: { value: "0" } });
  const copy = copyOf(container);
  assertRendered(copy, "the ROI calculator");
  return copy;
}

async function pricingDescription(): Promise<string> {
  vi.resetModules();
  const mod = await import("@/app/(marketing)/pricing/layout");
  const description = mod.metadata.description;
  expect(typeof description, "/pricing metadata no longer carries a description").toBe("string");
  return description as string;
}

describe("/sign-up sells the Pilot allowance the ladder declares", () => {
  it("ships today's sentence, unchanged", async () => {
    expect(await signUpCopy()).toContain(SIGN_UP_SUB);
  });

  it("moves when the Pilot allowance moves", async () => {
    h.ladder.pilot = { ...h.ladder.pilot, orderLimit: 500, priceCadence: "30 days" };

    const copy = await signUpCopy();
    expect(copy).toContain("No credit card. 500 orders free for 30 days.");
    expect(copy, "the typed sentence must be gone, not merely joined").not.toContain(SIGN_UP_SUB);
  });
});

describe("the ROI calculator's Pilot copy comes off the ladder", () => {
  it("ships today's two sentences, unchanged", async () => {
    const copy = await roiCopyWithNoSavings();
    expect(copy).toContain(ROI_FALLBACK);
    expect(copy).toContain(ROI_FINE_PRINT);
  });

  it("moves when the Pilot tier is renamed or re-sized", async () => {
    h.ladder.pilot = { ...h.ladder.pilot, name: "Trial", orderLimit: 500, priceCadence: "30 days" };

    const copy = await roiCopyWithNoSavings();
    expect(copy).toContain("Start with the free 14-day Trial — 500 orders, no card required —");
    expect(copy).toContain("The Trial tier is free for 30 days (500 orders) and does not require a card.");
    expect(copy, "the typed sentence must be gone, not merely joined").not.toContain(ROI_FINE_PRINT);
  });
});

describe("/pricing metadata quotes the ladder, not a remembered price", () => {
  it("ships today's description, unchanged", async () => {
    expect(await pricingDescription()).toBe(PRICING_DESCRIPTION);
  });

  it("moves when the cheapest self-serve tier is repriced", async () => {
    h.ladder.growth = { ...h.ladder.growth, priceMonthly: 179 };

    const description = await pricingDescription();
    expect(description).toContain("self-serve paid tiers from €179/mo");
    expect(description, "the typed price must be gone, not merely joined").not.toContain("from €149/mo");
  });

  it("follows the ladder rather than naming Growth, when a cheaper paid tier exists", async () => {
    // Not hypothetical bookkeeping: "from €X" is a claim about the BOTTOM of the paid
    // ladder, so it has to answer to whichever tier is cheapest, not to whichever tier
    // was cheapest the day the sentence was written.
    h.ladder.operations = { ...h.ladder.operations, priceMonthly: 99 };

    expect(await pricingDescription()).toContain("self-serve paid tiers from €99/mo");
  });

  it("moves when the overage rate moves", async () => {
    h.overage.value = 0.75;

    const description = await pricingDescription();
    expect(description).toContain("predictable €0.75 per-order overage");
    expect(description, "the typed rate must be gone, not merely joined").not.toContain("€0.50 per-order");
  });
});

// A guard against this file's own blind spot: every mutation above re-points a plan the
// ladder really has. If a plan id were renamed out from under it the mutations would
// write a key nothing reads and both halves of each pair would still pass.
describe("the ladder this file re-points is the real one", () => {
  it("still has the plan ids the mutations target", () => {
    for (const id of ["pilot", "growth", "operations"] satisfies PlanId[]) {
      expect(Object.keys(PRISTINE_LADDER), `plans.ts no longer declares "${id}"`).toContain(id);
    }
  });
});
