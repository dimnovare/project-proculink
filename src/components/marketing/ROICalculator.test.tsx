import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { stripComments, syntaxFor } from "@/test/sourceScan";
import { OVERAGE_PER_ORDER_EUR } from "@/lib/plans";
import { ROICalculator, DEFAULT_AUTOMATION_PCT } from "./ROICalculator";

// WP-40 — the 70% automation assumption.
//
// `const monthlySavings = totalPain * 0.7` drove the headline savings, the
// annual figure and the 3-year ROI percentage. The fine print half-disclosed it
// correctly ("not a measured customer outcome") and then sourced it:
//
//   "an illustrative default based on our analysis of typical manual
//    reformatting effort"
//
// There is no such analysis. The only occurrences of 70% in either repository
// were the constant and the labels describing it, and src/lib/plans.ts records
// a 2026-07-30 production census in which exactly one org has ever held an
// order — the founder's own. "Typical" was a second claim on top of the first:
// a population statement about an industry we have measured nothing about.
//
// The founder rule is that a fix which makes a false claim MORE PRECISE is
// worse than the claim it replaced, so this is not a rewording guard. The
// clause is gone, and the number it defended is now the reader's own slider —
// which is what "an assumption you can change" has to mean to be true.
//
// Anti-vacuity, because a copy assertion that renders nothing passes forever:
// every guard below reads text this component actually RENDERED, and the
// slider test moves the control and asserts the money changed with it.

const SRC = join(__dirname, "ROICalculator.tsx");

/** Rendered text as a visitor reads it — text nodes joined by a space, so a
 *  \b-anchored assertion cannot stop matching at a JSX seam. Same reasoning as
 *  src/app/(marketing)/legalCommitments.test.tsx.
 *
 *  Reads the container that is ALREADY mounted. Re-rendering to re-read would
 *  mount a second calculator at its defaults, and the interaction test below
 *  would then compare a moved slider against a fresh one and pass on nothing. */
function textOf(container: HTMLElement): string {
  container.querySelectorAll("style,script").forEach((el) => el.remove());
  const parts: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function mount() {
  const { container } = render(<ROICalculator />);
  return { container, read: () => textOf(container) };
}

const rendered = () => mount().read();

function automationSlider(): HTMLInputElement {
  return screen.getByRole("slider", { name: /ProcuLink to remove/i }) as HTMLInputElement;
}

/** The automation share the fine print currently claims, read back out of the
 *  rendered sentence. Fails loudly if the sentence stops carrying a number at
 *  all, which is how this guard would otherwise go quiet. */
function disclosedPct(text: string): number {
  // `\s*` before the %: the number is its own JSX expression, so joining text
  // nodes with a space (see textOf) puts one between "70" and "%". The browser
  // renders them adjacent — this is an artefact of reading, not of the copy.
  const m = text.match(/removes (\d+)\s*% of the manual reformatting/);
  expect(m, "the fine print no longer states the automation share it used").toBeTruthy();
  return Number(m![1]);
}

afterEach(cleanup);

describe("ROI calculator — the automation assumption is disclosed as an assumption", () => {
  it("does not source the 70% to an analysis that was never done", () => {
    const text = rendered();
    expect(text).not.toMatch(/our analysis/i);
    expect(text).not.toMatch(/analysis of typical/i);
    // "typical" is the population claim, not just the wording of it: we have no
    // industry data, so no copy here may describe an industry norm.
    expect(text).not.toMatch(/typical/i);
    expect(text).not.toMatch(/\bindustry (average|standard|benchmark)/i);
  });

  it("keeps the half that was already honest", () => {
    expect(rendered()).toMatch(/not a measured customer outcome/i);
  });

  it("says whose assumption the share is", () => {
    expect(rendered()).toMatch(/you set that share yourself/i);
  });
});

describe("ROI calculator — the share is an input, not a buried constant", () => {
  it("ships the automation share as a slider, defaulted but not fixed", () => {
    mount();
    const slider = automationSlider();
    expect(slider.value).toBe(String(DEFAULT_AUTOMATION_PCT));
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
  });

  it("moves the money when the reader moves it", () => {
    const { read } = mount();
    const before = read();
    expect(disclosedPct(before)).toBe(DEFAULT_AUTOMATION_PCT);
    const beforeSavings = before.match(/Net monthly savings \(after plan cost\) (€[\d,]+)/);
    expect(beforeSavings, "the net monthly savings figure").toBeTruthy();

    fireEvent.change(automationSlider(), { target: { value: "30" } });

    const after = read();
    expect(disclosedPct(after)).toBe(30);
    const afterSavings = after.match(/Net monthly savings \(after plan cost\) (€[\d,]+)/);
    expect(afterSavings, "the net monthly savings figure").toBeTruthy();
    // Halving the assumption must move the headline. If these are equal the
    // slider is decorative and the constant is still buried somewhere.
    expect(afterSavings![1]).not.toBe(beforeSavings![1]);
  });

  it("leaves no automation percentage in the source that the slider does not drive", () => {
    // The default lives in exactly one place. A second hand-typed 70 anywhere in
    // the component is a label that will drift away from the control.
    const code = stripComments(readFileSync(SRC, "utf8"), syntaxFor(SRC));
    const bare = code.match(/\b70\s*%|\*\s*0\.7\b/g) ?? [];
    expect(bare, `hand-typed automation share in ${SRC}: ${bare.join(", ")}`).toEqual([]);
  });
});

describe("ROI calculator — the overage rate derives from the plan ladder", () => {
  const rate = OVERAGE_PER_ORDER_EUR.toLocaleString("en-GB", {
    style: "currency",
    currency: "EUR",
  });

  it("prints the rate the billing constant actually sets", () => {
    expect(rendered()).toContain(`${rate}/order`);
  });

  it("types no euro rate of its own", () => {
    // €0.50 was hardcoded in the fine print while the overage panel 60 lines up
    // already used OVERAGE_PER_ORDER_EUR. Whole-euro placeholders ("€0") are
    // fine; a decimal euro literal is a price this file has no business owning.
    const code = stripComments(readFileSync(SRC, "utf8"), syntaxFor(SRC));
    const literals = code.match(/€\s?\d+[.,]\d+/g) ?? [];
    expect(literals, `hardcoded euro amounts in ${SRC}: ${literals.join(", ")}`).toEqual([]);
  });
});
