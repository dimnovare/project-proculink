import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_CONFIDENCE } from "@/lib/reviewMarks";

/**
 * The help articles that explain how sure we are must describe what the review screen draws. An earlier
 * article taught a retired 85/70 ladder while the chip painted 90/75; since plan 14.3 the review screen
 * paints no percentage chip at all (only a value that needs a look says how sure we are, in amber), so a
 * green/amber/red band list in help would describe a screen that no longer exists.
 *
 * The one threshold help may state is the review threshold, read from `REVIEW_CONFIDENCE` (mirrored from
 * the backend and pinned by backendMirror.test.ts), never typed here: move it and this fails and names
 * the article.
 */

const HELP = join(process.cwd(), "src", "app", "(marketing)", "help");
const review = Math.round(REVIEW_CONFIDENCE * 100);

const mdx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdx(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );

describe("help articles describe the confidence the review screen shows", () => {
  it("the two articles that explain how sure we are describe the amber mark, not a band per colour", () => {
    for (const slug of ["ai-in-proculink", "what-we-read"]) {
      const body = readFileSync(join(HELP, slug, "page.mdx"), "utf8");
      expect(body, `${slug}: the mark`).toContain("A value we are not sure about is marked in amber and says how sure we are.");
      expect(body, `${slug}: no colour bands`).not.toMatch(/% or more is green|% is amber|% is red/);
    }
  });

  it("every percentage threshold in any help article is the review threshold", () => {
    const stated = mdx(HELP).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:(\d+)% or more|[Bb]elow (\d+)%|less than (\d+)%|(\d+)% to (\d+)%)/g)].map((m) => ({
        file,
        numbers: m.slice(1).filter(Boolean).map(Number),
      })),
    );
    // Anti-vacuity: ai-in-proculink and checks each state the review threshold.
    expect(stated.length, "the walk must really find the thresholds").toBeGreaterThanOrEqual(2);
    const wrong = stated.filter(({ numbers }) => numbers.some((n) => n !== review)).map(({ file, numbers }) => `${file}: ${numbers}`);
    expect(wrong, "a threshold that is not the review threshold").toEqual([]);
  });
});
