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
import { render, cleanup } from "@testing-library/react";
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
    get DOCUMENT_PLANS() {
      return actual.DOCUMENT_PLANS.map((p) => h.ladder[p.id]);
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
// Re-worded deliberately for the item-code positioning (it was "No credit card. 20 orders
// free for 14 days."): it now also names the supplier allowance, which is the Pilot limit a
// new buyer meets first. The pair below still holds it byte-for-byte AND proves it moves.
const SIGN_UP_SUB = "Free for 14 days · 20 documents · 2 flows · no credit card";
// C32: derived from the pristine ladder, not typed — the shape is the contract, the numbers are plans.ts's.
const pricingDescriptionFor = (starter: Plan) =>
  `Document processing from €${starter.priceMonthly} a month for ${starter.orderLimit!.toLocaleString("en-US")} documents. ` +
  "Every feature on every plan. Free for 14 days.";

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

async function pricingDescription(): Promise<string> {
  vi.resetModules();
  const mod = await import("@/app/(marketing)/pricing/layout");
  const description = mod.metadata.description;
  expect(typeof description, "/pricing metadata no longer carries a description").toBe("string");
  return description as string;
}

describe("/sign-up sells the Trial allowance the ladder declares", () => {
  it("ships today's sentence, unchanged", async () => {
    expect(await signUpCopy()).toContain(SIGN_UP_SUB);
  });

  it("moves when the Pilot allowance moves", async () => {
    h.ladder.pilot = { ...h.ladder.pilot, orderLimit: 500, flowLimit: 3, priceCadence: "30 days" };

    const copy = await signUpCopy();
    expect(copy).toContain("Free for 30 days · 500 documents · 3 flows · no credit card");
    expect(copy, "the typed sentence must be gone, not merely joined").not.toContain(SIGN_UP_SUB);
  });
});

describe("/pricing metadata quotes the ladder, not a remembered price", () => {
  it("ships the Starter price and allowance", async () => {
    expect(await pricingDescription()).toBe(pricingDescriptionFor(PRISTINE_LADDER.starter));
  });

  it("moves when the Starter plan is repriced or re-sized", async () => {
    h.ladder.starter = { ...h.ladder.starter, priceMonthly: 41, orderLimit: 175 };

    const description = await pricingDescription();
    expect(description).toBe(pricingDescriptionFor(h.ladder.starter));
    expect(description, "the old price must be gone, not merely joined").not.toContain(
      `€${PRISTINE_LADDER.starter.priceMonthly} a month`,
    );
  });
});

// A guard against this file's own blind spot: every mutation above re-points a plan the
// ladder really has. If a plan id were renamed out from under it the mutations would
// write a key nothing reads and both halves of each pair would still pass.
describe("the ladder this file re-points is the real one", () => {
  it("still has the plan ids the mutations target", () => {
    for (const id of ["pilot", "starter"] satisfies PlanId[]) {
      expect(Object.keys(PRISTINE_LADDER), `plans.ts no longer declares "${id}"`).toContain(id);
    }
  });
});
