import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confidenceTier } from "@/lib/ds-tokens";

/**
 * The help articles that explain what a confidence percentage means must describe the ramp the product
 * renders. An earlier article taught a retired 85/70 ladder while the chip painted 90/75, so an 87% read
 * "high confidence" in the text and amber on screen.
 *
 * The floors are found by asking `confidenceTier` (the function `ConfidenceChip` renders with), never typed
 * here: move a threshold and this fails and names the article.
 */

const HELP = join(process.cwd(), "src", "app", "(marketing)", "help");

/** Lowest whole percent in each tier, found by asking the shipped function. */
const floor = (tier: "ok" | "warn") => {
  for (let pct = 0; pct <= 100; pct++) if (confidenceTier(pct) === tier) return pct;
  throw new Error(`no percent tiers as ${tier}`);
};
const green = floor("ok");
const amber = floor("warn");

const mdx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdx(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );

describe("help articles describe the confidence ramp the code renders", () => {
  it("the two articles that explain the ramp state both floors and the bands between them", () => {
    for (const slug of ["ai-in-proculink", "what-we-read"]) {
      const body = readFileSync(join(HELP, slug, "page.mdx"), "utf8");
      expect(body, `${slug}: green floor`).toContain(`${green}% or more is green`);
      expect(body, `${slug}: amber band`).toContain(`${amber}% to ${green - 1}% is amber`);
      expect(body, `${slug}: red band`).toContain(`Below ${amber}% is red`);
    }
  });

  it("every percentage threshold in any help article is one of the two floors", () => {
    const stated = mdx(HELP).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:(\d+)% or more|[Bb]elow (\d+)%|less than (\d+)%|(\d+)% to (\d+)%)/g)].map((m) => ({
        file,
        numbers: m.slice(1).filter(Boolean).map(Number),
      })),
    );
    // Anti-vacuity: the two ramp articles alone state four thresholds each.
    expect(stated.length, "the walk must really find the thresholds").toBeGreaterThanOrEqual(6);
    const known = new Set([green, amber, green - 1]);
    const wrong = stated.filter(({ numbers }) => numbers.some((n) => !known.has(n))).map(({ file, numbers }) => `${file}: ${numbers}`);
    expect(wrong, "a threshold that is not a floor of the shipped ramp").toEqual([]);
  });
});
