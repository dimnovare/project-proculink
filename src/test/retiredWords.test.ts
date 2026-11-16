import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * A word the product retired must not come back in anything a person reads: one thing, one name.
 * Code keeps its names (identifiers, routes, query keys, test ids), so the walk reads only person-read text.
 */

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** A key, a route (query string included) or an id. A capitalised single word ("Outputs") is a label, not a key. */
const looksLikeCode = (t: string) => /^[\w./\-[\]:?=&#]+$/.test(t) && !/^[A-Z][a-z]+$/.test(t);

/** Person-read text of a source file: string literals, template-literal text and JSX text, comments stripped.
 *  A literal with no space that looks like code (`/^[\w./\-\[\]:]+$/`) is a key, a route or an id, not words. */
export function personText(source: string): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = n.text.trim();
      if (t && !looksLikeCode(t)) out.push(t);
    }
    ts.forEachChild(n, walk);
  };
  walk(ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return out;
}

/** Visible text of an MDX page: code fences, inline code, link targets, `href=`/`src=` values, import/export lines removed.
 *  An `export` statement (the page's metadata) is read as code, so its title is checked and its slug is not. */
export function mdxText(source: string): string[] {
  const exports: string[] = [];
  const text = source
    .replace(/\r\n/g, "\n")
    .replace(/^export .*;[ \t]*$|^export [\s\S]*?^[})]\)?;?[ \t]*$/gm, (m) => (exports.push(m), ""))
    .replace(/^import .*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/\[([^\]]*)\]/g, "$1")
    .replace(/\s(?:href|src)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "");
  return [...text.split("\n").map((l) => l.trim()).filter(Boolean), ...exports.flatMap(personText)];
}

const HELP = join("src", "app", "(marketing)", "help");
const HELP_PAGES = (readdirSync(join(ROOT, HELP), { recursive: true }) as string[])
  .map((f) => join(HELP, f).replace(/\\/g, "/"))
  .filter((f) => !f.includes("/old-orders/") && (f.endsWith("/page.mdx") || (f.endsWith(".tsx") && !/\.test\./.test(f))));

const FLOW_FILES = [
  "src/components/flows/FlowOutputs.tsx",
  "src/components/flows/FlowPage.tsx",
  "src/components/flows/OutputEditor.tsx",
  "src/components/flows/DocumentOutputsPanel.tsx",
  "src/components/flows/DraftReview.tsx",
  "src/components/flows/advanced/AdvancedView.tsx",
  "src/components/flows/DocumentScreen.tsx",
  "src/components/destinations/DestinationsSection.tsx",
  "src/components/bridge/BillingSection.tsx",
  "src/lib/documentRefusals.ts",
  "src/lib/destinations.ts",
  "src/lib/guides.ts",
  "src/lib/help-articles.ts",
  "src/lib/section-guides.ts",
  "src/lib/activityRows.ts",
];

const RETIRED: { word: RegExp; files: string[] }[] = [{ word: /\boutputs?\b/i, files: [...FLOW_FILES, ...HELP_PAGES] }];

describe("retired words stay retired in what a person reads", () => {
  it("no person-read word says output", () => {
    const hits = RETIRED[0].files.flatMap((f) =>
      (f.endsWith(".mdx") ? mdxText : personText)(read(f)).filter((t) => RETIRED[0].word.test(t)).map((t) => `${f}: ${t}`),
    );
    expect(hits).toEqual([]);
  });

  it("sees the defect it guards against, and reads enough", () => {
    expect(personText(`const a = <h2>Add an output</h2>; // an output in a comment\nconst k = ["outputs", id];`)).toEqual(["Add an output"]);
    expect(mdxText("Press **Add an output**. See [the guide](/help/guides/build-an-output).")).toEqual(["Press **Add an output**. See the guide."]);
    expect(mdxText(`export const metadata = m({\n  slug: "outputs",\n  title: "Output formats",\n});\n\n# Output formats`)).toEqual(["# Output formats", "Output formats"]);
    expect(RETIRED[0].files.length).toBeGreaterThanOrEqual(35); // anti-vacuity floor: the source files + the help pages
    expect(HELP_PAGES.length).toBeGreaterThanOrEqual(30);
  });
});
