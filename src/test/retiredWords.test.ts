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

/** A key, a route (query string included) or an id. A capitalised single word ("Outputs") is a label, not a key, and so
 *  is any single word with punctuation after it ("Output:", "outputs."). */
const looksLikeCode = (t: string) => {
  const word = t.replace(/[.:,;!?]+$/, "");
  if (word !== t && /^[A-Za-z]+$/.test(word)) return false;
  return /^[\w./\-[\]:?=&#]+$/.test(t) && !/^[A-Z][a-z]+$/.test(t);
};

/** Person-read text of a source file: string literals, template-literal text and JSX text, comments stripped.
 *  Only a WHOLE string literal with no space that looks like code is a key, a route or an id. A piece of a template
 *  literal (`${n} outputs`) and JSX text are always read: a piece is part of a sentence, whatever its shape. */
export function personText(source: string): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const t = n.text.trim();
      if (t && !looksLikeCode(t)) out.push(t);
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      // looksLikeCode never runs here. The one piece left out is one with no whitespace at all, glued to `${}` by a
      // route or key separator (`/outputs/`, `?tab=outputs`, `output:`, `output-preview-`): a path or id, not words.
      const t = n.text.trim();
      if (t && !/^\S*[/?=&#:-]\S*$/.test(n.text)) out.push(t);
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

/** The signed-in flow area, read whole: every source file under these folders, test files excluded. */
const APP_DIRS = ["src/components/flows", "src/components/destinations", "src/components/lookups", "src/components/activity"];
const inDir = (dir: string) => (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
  .map((f) => `${dir}/${f.replace(/\\/g, "/")}`)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

/** Files whose old "output" words a LATER task of plan 16a removes; the release words are read in them too.
 *  Nothing else may be listed here. */
const LATER = (f: string) =>
  f === "src/components/lookups/LookupPage.tsx" ||         // Task 8: the unused-lookup sentence
  f.startsWith("src/components/flows/advanced/");          // Task 9: the Advanced view and its mapper words

/** Person-read files outside those folders that this guard read before it was widened. */
const OTHER_FILES = [
  "src/components/bridge/BillingSection.tsx",
  "src/lib/documentRefusals.ts",
  "src/lib/destinations.ts",
  "src/lib/guides.ts",
  "src/lib/help-articles.ts",
  "src/lib/section-guides.ts",
  "src/lib/activityRows.ts",
];

/** The audit manifest's notes are for developers; only its labels reach a person. */
const MANIFEST = "src/lib/auditActionManifest.ts";
const labels = (source: string) => [...source.matchAll(/\blabel: "([^"]*)"/g)].map((m) => m[1]);

/** Every file read, LATER ones included: the release words were all renamed by Task 2, so only "output" waits. */
const ALL = [...APP_DIRS.flatMap(inDir), ...OTHER_FILES, ...HELP_PAGES];
const CORPUS = ALL.filter((f) => !LATER(f));

const RETIRED: { word: RegExp; files: string[] }[] = [
  { word: /\boutputs?\b/i, files: CORPUS },
  // The manifest's labels are read for the release words only: its "output" label belongs to the archived order
  // pipeline's status vocabulary (problemCopy.ts, statusVocabulary.test.ts), outside this piece.
  // "publish" with no leading boundary, so "Republish" and "unpublished" are caught too. "draft" since Task 6: the
  // screens say "changes" and "not in use yet"; code names such as useDraftPart and FlowDraftProvider are not words.
  { word: /publish|\bdiscard|\bdrafts?\b|\blive, version\b|\bis live\b/i, files: [...ALL, MANIFEST] },
];

const textOf = (f: string) => (f.endsWith(".mdx") ? mdxText : f === MANIFEST ? labels : personText)(read(f));
const hitsFor = ({ word, files }: (typeof RETIRED)[number]) =>
  files.flatMap((f) => textOf(f).filter((t) => word.test(t)).map((t) => `${f}: ${t}`));

describe("retired words stay retired in what a person reads", () => {
  it("no person-read word says output", () => {
    expect(hitsFor(RETIRED[0])).toEqual([]);
  });

  it("no person-read word says publish", () => {
    expect(hitsFor(RETIRED[1])).toEqual([]);
  });

  it("sees the defect it guards against, and reads enough", () => {
    expect(personText(`const a = <h2>Add an output</h2>; // an output in a comment\nconst k = ["outputs", id];`)).toEqual(["Add an output"]);
    expect(mdxText("Press **Add an output**. See [the guide](/help/guides/build-an-output).")).toEqual(["Press **Add an output**. See the guide."]);
    expect(mdxText(`export const metadata = m({\n  slug: "outputs",\n  title: "Output formats",\n});\n\n# Output formats`)).toEqual(["# Output formats", "Output formats"]);
    expect(personText("<Button>Publish changes</Button>").filter((t) => RETIRED[1].word.test(t))).toEqual(["Publish changes"]);
    expect(["Republish", "3 unpublished changes", "This flow is live.", "In use"].filter((t) => RETIRED[1].word.test(t))).toEqual(["Republish", "3 unpublished changes", "This flow is live."]);
    expect(["Changes save as a draft.", "Drafts", "useDraftPart needs a FlowDraftProvider."].filter((t) => RETIRED[1].word.test(t))).toEqual(["Changes save as a draft.", "Drafts"]);
    expect(labels(`{ action: "flow.published", label: "Version published", note: "was published" }`)).toEqual(["Version published"]);
    expect(personText("const s = `${n} outputs`;")).toEqual(["outputs"]);
    expect(personText('const s = `${n} output${n === 1 ? "" : "s"}`;').filter((t) => RETIRED[0].word.test(t))).toEqual(["output"]);
    expect(personText('const a = <p>{n} output{n === 1 ? "" : "s"} use this</p>;').filter((t) => RETIRED[0].word.test(t))).toEqual(["output"]);
    expect(personText('const a = ["Output:", "Outputs."];')).toEqual(["Output:", "Outputs."]);
    expect(personText("const s = `Output: ${name}`; const r = `/flows/${id}/outputs/${o}`;")).toEqual(["Output:"]);
    // Anti-vacuity: every folder yields a file, and the corpus yields person-read text to check.
    for (const dir of [...APP_DIRS, HELP]) expect(CORPUS.some((f) => f.startsWith(dir.replace(/\\/g, "/") + "/")), dir).toBe(true);
    // Measured 2026-11-16: 4,401 person-read strings (FlowValues.tsx's drop zone since Task 6) and 31 help pages. Raise these floors when the corpus grows; never lower them.
    expect(CORPUS.flatMap(textOf).length).toBeGreaterThanOrEqual(3960);
    expect(HELP_PAGES.filter((f) => f.endsWith(".mdx")).length).toBeGreaterThanOrEqual(30);
  });
});
