import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PROBLEM_COPY } from "../problemCopy";
import { ROOT } from "@/test/appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// The help centre is a promise about behaviour, so it fails the same way a button
// does — silently, and only for the person acting on it.
//
// /help/exceptions-and-stuck-orders told operators the exact opposite of what
// WP-24 ships: "Dead-lettered orders can't be retried from the order screen (that
// path is deliberately closed once retries are exhausted). Instead, go to
// Operations → Health…". An out-of-retries order now carries its own recovery on
// the order screen, so that paragraph sent people to a second screen to do a thing
// the first screen was already offering.
//
// These are source-text assertions over the .mdx — cheap, no MDX compile, no
// providers. The load-bearing ones read their expected strings OUT of PROBLEM_COPY
// rather than hard-coding them, so renaming a shipped button breaks the article's
// test instead of quietly making the article wrong.
// ─────────────────────────────────────────────────────────────────────────────

const ARTICLE = "src/app/(marketing)/help/exceptions-and-stuck-orders/page.mdx";
const article = readFileSync(join(ROOT, ARTICLE), "utf8");

/** The label of a shipped action, so the doc cannot drift from the button. */
function actionLabel(status: keyof typeof PROBLEM_COPY, op: string): string {
  const found = PROBLEM_COPY[status]
    .actions({
      supplier: "BoltWorks BV",
      po: "PO 4091678643",
      supplierId: "sup-1",
      orderId: "ord-1",
      serverMessage: null,
      readOnly: false,
      atOrderLimit: false,
      processingPaused: false,
    })
    .find((a) => a.kind === "post" && a.op === op);
  if (!found || found.kind !== "post") throw new Error(`${status} no longer offers ${op}`);
  return found.label;
}

describe("the exceptions article describes the recovery we actually ship", () => {
  test("it no longer claims the order screen cannot requeue an out-of-retries order", () => {
    expect(article).not.toMatch(/can'?t be retried from the order screen/i);
    expect(article).not.toMatch(/that path is deliberately closed/i);
  });

  test("it names the button the order screen really carries", () => {
    // Derived, not typed: rename "Start sending again" in problemCopy.ts and this
    // fails, which is the only way a doc and a button stay in step.
    const label = actionLabel("delivery_dead_letter", "requeueDelivery");
    expect(label).toBe("Start sending again");
    expect(article).toContain(label);
  });

  test("it still points at System health as the bulk path, not the only path", () => {
    expect(article).toMatch(/System health/i);
    // "Instead, go to…" was the false instruction. The article may mention Health,
    // but never as the sole route out.
    expect(article).not.toMatch(/Instead, go to \*\*Operations/i);
  });

  test("the parked-order section matches the three-answer resolver, not two bare buttons", () => {
    // WP-24 §5: the screen asks what the supplier said BEFORE offering anything.
    // The old copy promised "From the order page you get two ways to resolve it".
    expect(article).not.toMatch(/you get two ways to resolve it/i);
    expect(article).toContain("Send it to them again");
    expect(article).toContain("Mark it as delivered");
    expect(article).toMatch(/haven'?t been able to reach them/i);
  });

  test("no banned engine vocabulary survives anywhere in the article", () => {
    // Including the metadata description, which ships to search results and the
    // help index — the one place a vocabulary sweep of the BODY misses.
    const hits = [...article.matchAll(/dead[\s-]?letter(ed|s)?/gi)].map((m) => m[0]);
    expect(hits, `banned vocabulary in ${ARTICLE}: ${hits.join(", ")}`).toEqual([]);
  });
});
