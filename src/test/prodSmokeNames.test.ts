import { describe, expect, it } from "vitest";
import {
  DISPOSABLE_PREFIX,
  digitsAsLetters,
  disposableNames,
  lettersAsDigits,
} from "../../scripts/prod-smoke/disposableNames.mjs";

/**
 * No name the production smoke run sends to Clerk may look like a phone number.
 *
 * THE DEFECT, twice in fourteen hours, and the second one is the point:
 *
 *   2026-08-26 19:30   first_name   "Smoke33005458702-1"          -> HTTP 422
 *   2026-08-27 09:39   organization "…-ci-smoke-33059511557-1"    -> HTTP 422
 *
 * A GitHub run id is eleven digits and Clerk reads it as an international
 * number. The first break was diagnosed and fixed correctly — and the fix moved
 * the failure one API call down the same function, to the organisation name,
 * because the defect was never "this string" but "any string carrying the run
 * id". Fixing the instance left the class open.
 *
 * So this test asserts the CLASS: every name `disposableNames` produces is free
 * of digits, for run ids including the two real ones that broke. It is the
 * shape of guard this repo keeps needing — the previous version of this problem
 * would have passed any test that only checked `firstName`.
 *
 * WHY IT CAN CALL THE CODE. `clerk-disposable.mjs` runs its CLI on import, so a
 * test that imported it would exit the process. The name building was split into
 * a side-effect-free module precisely so this file can execute it rather than
 * regex it.
 *
 * WHAT IT CANNOT PROVE. Clerk's validator is theirs and undocumented; "no
 * digits" is a sufficient condition we control, not a transcription of their
 * rule. If they later reject something else, this test will still pass and the
 * smoke run will still fail — loudly, in provisioning, which is where the last
 * two showed up.
 */

/** The two run ids that actually produced a 422, kept verbatim. */
const BROKE_PRODUCTION = ["33005458702-1", "33059511557-1"];

const RUN_IDS = [...BROKE_PRODUCTION, "1-1", "99999999999-9", "10203040506-12"];

describe("the smoke run's Clerk names", () => {
  it("sends no digit in any name, for the run ids that broke production", () => {
    for (const runId of BROKE_PRODUCTION) {
      const n = disposableNames(runId, "example.com");
      expect(n.firstName, `firstName still carries digits for ${runId}`).not.toMatch(/\d/);
      expect(n.orgName, `orgName still carries digits for ${runId}`).not.toMatch(/\d/);
      expect(n.slug, `slug still carries digits for ${runId}`).not.toMatch(/\d/);
    }
  });

  it("covers every name field the function returns, not a list someone typed", () => {
    // The anti-drift half. Checking three named fields would keep passing if a
    // fourth name were added later — which is exactly how the org name got
    // missed. This walks whatever the function actually returns.
    for (const runId of RUN_IDS) {
      const names = disposableNames(runId, "example.com");
      for (const [field, value] of Object.entries(names)) {
        if (field === "email") continue; // addresses are not name-validated
        expect(String(value), `${field} carries digits for run ${runId}`).not.toMatch(/\d/);
      }
    }
  });

  it("is not vacuous — the raw run ids really do contain digits", () => {
    // Without this, the assertions above pass just as happily against a
    // disposableNames() that returned empty strings, or against run ids that
    // never had digits in the first place.
    for (const runId of RUN_IDS) {
      expect(runId, "fixture run id has no digits, so this file proves nothing").toMatch(/\d/);
    }
    expect(BROKE_PRODUCTION.length).toBeGreaterThan(1);
  });

  it("keeps every run distinguishable", () => {
    // Uniqueness is the reason the run id was in the name at all. A fix that
    // collapsed two runs to one name would pass the digit checks and quietly
    // ruin the dashboard-greeting assertion in signed-in-screens.spec.ts.
    const seen = new Set(RUN_IDS.map((r) => disposableNames(r, "example.com").firstName));
    expect(seen.size).toBe(RUN_IDS.length);
  });

  it("keeps the prefix cleanup refuses to delete without", () => {
    // clerk-disposable.mjs cleanup will not delete an organisation whose name
    // does not start with DISPOSABLE_PREFIX. Encoding the whole slug would have
    // turned the prefix into letters too and stranded every disposable org.
    for (const runId of RUN_IDS) {
      expect(disposableNames(runId, "example.com").orgName.startsWith(DISPOSABLE_PREFIX)).toBe(true);
    }
    expect(DISPOSABLE_PREFIX).not.toMatch(/\d/);
  });

  it("can be decoded back to the run that made it", () => {
    // The reason this is a substitution and not a hash: the only trace of a
    // failed cleanup is a name in the Clerk dashboard, and someone has to be
    // able to work out which run left it there.
    for (const runId of RUN_IDS) {
      expect(lettersAsDigits(digitsAsLetters(runId))).toBe(runId);
    }
    expect(digitsAsLetters("33005458702-1")).toBe("ddaafefihac-b");
  });
});
