import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/guides";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { NEVER_CLAIM } from "@/lib/neverClaim";
import { stripComments } from "@/test/sourceScan";

const HELP_DIR = join(process.cwd(), "src", "app", "(marketing)", "help");

const mdxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdxFiles(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The page without its metadata export and imports: what a reader gets after the lead. */
const body = (path: string) =>
  readFileSync(path, "utf8").replace(/export const metadata = [\s\S]*?\n\}\);\n/, "").replace(/^import .*$/gm, "");

// Each help-content task adds its own slugs; the last one flips this to every registered page.
const WRITTEN = {
  articles: ["how-proculink-works", "documents-and-statuses", "what-we-read", "checks", "flows", "senders"],
  guides: ["set-up-your-first-flow", "check-and-send-a-document", "teach-a-value", "publish-a-flow-version"],
};

describe("help content", () => {
  it("leaves no written page as a stub", () => {
    const pages = [
      ...WRITTEN.articles.map((slug) => ({ slug, path: join(HELP_DIR, slug, "page.mdx"), stub: HELP_ARTICLES.find((a) => a.slug === slug) })),
      ...WRITTEN.guides.map((slug) => ({ slug, path: join(HELP_DIR, "guides", slug, "page.mdx"), stub: GUIDES.find((g) => g.slug === slug) })),
    ];
    for (const { slug, path, stub } of pages) {
      expect(stub, `${slug} is not registered`).toBeDefined();
      // A stub is a title and a one-line lead; an article is several times that.
      expect(words(body(path)), `${slug} is still a stub`).toBeGreaterThan(4 * words(`${stub!.title} ${stub!.blurb}`));
    }
  });

  const files = mdxFiles(HELP_DIR);

  it("claims nothing the document engine does not do", () => {
    expect(files.length, "the walk must really be reading the help pages").toBeGreaterThanOrEqual(25);
    const hits = files.flatMap((f) => {
      const text = stripComments(readFileSync(f, "utf8"), "mdx");
      return NEVER_CLAIM.filter(({ pattern }) => pattern.test(text)).map(({ label }) => `${f}: ${label}`);
    });
    expect(hits).toEqual([]);
  });
});
