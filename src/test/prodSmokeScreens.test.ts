// The production sweep's screen list resolves, on every ordinary CI run.
//
// WHY THIS IS HERE AND NOT LEFT TO THE SCHEDULED JOB. tests/prod/prodScreens.ts
// derives its list from CORE_SCREENS and from src/lib/pageTitles.ts, and it
// THROWS when either has drifted — a route that no longer exists, a screen with
// no registered tab title, a filter that stopped matching. Those throws are the
// point of the file, but the only thing that used to evaluate them was the
// twice-daily production run, which means a rename merged on Tuesday would first
// be heard about on Wednesday morning, in a job whose failure looks exactly like
// a production outage.
//
// Running the derivation here moves that failure to the pull request that caused
// it, and makes it say what it is: a registry drift, not a broken deploy.

import { describe, it, expect } from "vitest";
import { listProdScreens, MIN_PROD_SCREENS } from "../../tests/prod/prodScreens";
import { CORE_SCREENS } from "../../tests/e2e/coreScreens";
import { appPageTitle } from "@/lib/pageTitles";

describe("production smoke screen list", () => {
  it("resolves without throwing, and covers at least the floor", () => {
    const screens = listProdScreens();
    expect(screens.length).toBeGreaterThanOrEqual(MIN_PROD_SCREENS);
  });

  it("carries every non-dynamic signed-in core screen, and nothing else", () => {
    // Both directions. Asserting only that each listed screen is a core screen
    // would pass on an empty list; asserting only the reverse would pass on a
    // list with extra routes bolted on. The set has to be exactly the filter's
    // result, recomputed here from CORE_SCREENS rather than typed out.
    const expected = CORE_SCREENS.filter((s) => s.auth === "app" && !s.pattern.includes("["))
      .map((s) => s.pattern)
      .sort();

    expect(listProdScreens().map((s) => s.pattern).sort()).toEqual(expected);
  });

  it("excludes the dynamic order-review route, which has no production id to visit", () => {
    // The exclusion is deliberate and is the one subtraction prodScreens.ts
    // makes, so it is pinned: CORE_SCREENS still HAS a dynamic app screen (if it
    // ever loses one, this test should be reconsidered, not deleted), and the
    // production list does not contain it.
    const dynamic = CORE_SCREENS.filter((s) => s.auth === "app" && s.pattern.includes("["));
    expect(dynamic.length).toBeGreaterThan(0);

    const listed = listProdScreens().map((s) => s.pattern);
    for (const screen of dynamic) expect(listed).not.toContain(screen.pattern);
  });

  it("gives every screen the exact title src/lib/pageTitles.ts serves for it", () => {
    for (const screen of listProdScreens()) {
      expect(screen.title).toBe(appPageTitle(screen.pattern));
      expect(screen.title.endsWith(" — ProcuLink")).toBe(true);
    }
  });
});
