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

/** A module path (`import … from "x"`, `export … from "x"`, `import("x")`, `require("x")`, the type `import("x").T`),
 *  decided by its parent node. */
const isModulePath = (n: ts.Node) => {
  const p = n.parent;
  return ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n)
    || (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent) && p.parent.argument === p)
    || (ts.isCallExpression(p) && p.arguments[0] === n
      && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === "require")));
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
      if (isModulePath(n)) return;
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
const APP_DIRS = ["src/components/flows", "src/components/destinations", "src/components/lookups", "src/components/activity", "src/app/(app)", "src/components/help"];
const inDir = (dir: string) => (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
  .map((f) => `${dir}/${f.replace(/\\/g, "/")}`)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

/** The Advanced view's mapper: it is mounted only inside a flow (`AdvancedView`), so its words are a document's words,
 *  toolbar and orientation included (they are hidden there today, and would be read if shown). */
const MAPPER = inDir("src/components/bridge/mapper");
/** Files outside the mapper folder whose strings the mapper draws: the Advanced view's model and adapter (what the
 *  panes are fed), and the lib module that resolves the received pane's view. The standards catalog is not read whole:
 *  the panes take only field labels from it, and the rest of it is developer notes. */
const MAPPER_FED = [
  "src/components/flows/advanced/flowMapperModel.ts",
  // Not flowMapperAdapter.ts: it has no words of its own; the errors it passes to the panes are documentRefusals.ts's.
  "src/lib/documentRefusals.ts",
  "src/lib/sourceDocument.ts",
];

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

/** Every file read. The operator screens under `admin/` speak to ProcuLink staff in their own terms (the retention
 *  sweep's "generated output", a Stripe "draft" invoice), so they are not read. */
const CORPUS = [...APP_DIRS.flatMap(inDir).filter((f) => !f.startsWith("src/app/(app)/admin/")), ...OTHER_FILES, ...HELP_PAGES];

/** The shell files that draw the page's name, read only for this rule. */
const SHELL = ["src/components/bridge/BridgeSidebar.tsx", "src/components/bridge/CommandPalette.tsx",
  "src/components/bridge/BottomTabBar.tsx", "src/components/bridge/BridgeTopbar.tsx", "src/lib/pageTitles.ts",
  "src/components/bridge/HelpPanel.tsx", "src/components/bridge/ShortcutsSheet.tsx", "src/components/bridge/UserChipMenu.tsx",
  "src/components/bridge/OrgSwitcher.tsx", "src/lib/shortcuts.ts", ...inDir("src/components/settings"), ...inDir("src/components/pwa"), MANIFEST];

const RETIRED: { word: RegExp; files: string[] }[] = [
  { word: /\boutputs?\b/i, files: CORPUS },
  // The manifest's labels are read for the release words only: its "output" label belongs to the archived order
  // pipeline's status vocabulary (problemCopy.ts, statusVocabulary.test.ts), outside this piece.
  // "publish" with no leading boundary, so "Republish" and "unpublished" are caught too. "draft" since Task 6: the
  // screens say "changes" and "not in use yet"; code names such as useDraftPart and FlowDraftProvider are not words.
  { word: /publish|\bdiscard|\bdrafts?\b|\blive, version\b|\bis live\b/i, files: [...CORPUS, ...MAPPER, MANIFEST] },
  // The mapper speaks of the document and the file: no order, supplier, output or engine words (plan 16a R19, R20).
  { word: /\b(orders?|suppliers?|canonical|deterministic|outputs?)\b/i, files: [...MAPPER, ...MAPPER_FED] },
  // The History page is never called Activity. "Activity records" is the retention term (billing FAQ, privacy).
  { word: /\bactivit(y|ies)\b(?! records\b)/i, files: [...CORPUS, ...SHELL] },
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

  it("no person-read word in the Advanced view's mapper says order, supplier or output", () => {
    expect(hitsFor(RETIRED[2])).toEqual([]);
  });

  it("no person-read word names the History page Activity", () => {
    expect(hitsFor(RETIRED[3])).toEqual([]);
  });

  it("sees the defect it guards against, and reads enough", () => {
    expect(personText(`const a = <h2>Add an output</h2>; // an output in a comment\nconst k = ["outputs", id];`)).toEqual(["Add an output"]);
    expect(mdxText("Press **Add an output**. See [the guide](/help/guides/build-an-output).")).toEqual(["Press **Add an output**. See the guide."]);
    expect(mdxText(`export const metadata = m({\n  slug: "outputs",\n  title: "Output formats",\n});\n\n# Output formats`)).toEqual(["# Output formats", "Output formats"]);
    expect(personText("<Button>Publish changes</Button>").filter((t) => RETIRED[1].word.test(t))).toEqual(["Publish changes"]);
    expect(["Republish", "3 unpublished changes", "This flow is live.", "In use"].filter((t) => RETIRED[1].word.test(t))).toEqual(["Republish", "3 unpublished changes", "This flow is live."]);
    expect(["Changes save as a draft.", "Drafts", "useDraftPart needs a FlowDraftProvider."].filter((t) => RETIRED[1].word.test(t))).toEqual(["Changes save as a draft.", "Drafts"]);
    // Through the extractor, as the mapper's files are read: JSX text, a string literal, and a sentence that must pass.
    expect(personText('const a = <p>This order arrived already-structured</p>; const t = "Supplier-ready output preview"; const b = <span>Show the file this document arrived as</span>;')
      .filter((t) => RETIRED[2].word.test(t))).toEqual(["This order arrived already-structured", "Supplier-ready output preview"]);
    expect(labels(`{ action: "flow.published", label: "Version published", note: "was published" }`)).toEqual(["Version published"]);
    expect(personText("const s = `${n} outputs`;")).toEqual(["outputs"]);
    expect(personText('const s = `${n} output${n === 1 ? "" : "s"}`;').filter((t) => RETIRED[0].word.test(t))).toEqual(["output"]);
    expect(personText('const a = <p>{n} output{n === 1 ? "" : "s"} use this</p>;').filter((t) => RETIRED[0].word.test(t))).toEqual(["output"]);
    expect(personText('const a = ["Output:", "Outputs."];')).toEqual(["Output:", "Outputs."]);
    expect(personText("const s = `Output: ${name}`; const r = `/flows/${id}/outputs/${o}`;")).toEqual(["Output:"]);
    expect(personText('const n = [{ label: "Activity", href: "/operations/log" }]; const a = <PageHeader title="Activity" />;')
      .filter((t) => RETIRED[3].word.test(t))).toEqual(["Activity", "Activity"]);
    expect(["Open Activity", "Activity records such as delivery attempts are removed", "History"].filter((t) => RETIRED[3].word.test(t))).toEqual(["Open Activity"]);
    for (const f of SHELL) expect(textOf(f).length, `${f} yields person-read text`).toBeGreaterThan(0);
    expect(personText('import A from "@/components/activity/ActivityPage"; export { b } from "@/lib/activityRows"; const C = dynamic(() => import("@/components/activity/ActivityPage")); const d = require("@/components/activity/x"); type T = import("@/components/activity/x").Y;')).toEqual([]);
    expect(personText('type T = import("@/lib/x").Box<"Open Activity">;')).toEqual(["Open Activity"]);
    expect(mdxText("Activity is open to everyone.").filter((t) => RETIRED[3].word.test(t))).toEqual(["Activity is open to everyone."]);
    // Anti-vacuity: every folder yields a file, and the corpus yields person-read text to check.
    for (const dir of [...APP_DIRS, HELP]) expect(CORPUS.some((f) => f.startsWith(dir.replace(/\\/g, "/") + "/")), dir).toBe(true);
    // Measured 2026-11-16: 5,079 person-read strings (the Advanced view read since Task 9; the signed-in pages and the help components since the final review), 759 for the mapper rule (its folder and the files that feed it), and 31 help pages. Raise these floors when the corpus grows; never lower them (corrected once on 2026-11-16 when module paths stopped counting: see below).
    // Re-measured 2026-11-16 (plan 16b S11): the old floors counted module paths as read text (664 of 5,161; 34 of 759 for
    // the mapper). Without them: 4,497, and 808 for the mapper with documentRefusals.ts in place of the adapter (S12), so
    // the floors are 4,300 and 700 (the measure minus 3%, rounded down to a hundred). Re-measured 2026-11-17 with type-level
    // `import("x")` paths skipped too: 4,491 (the History tabs went) and 807; the floors stand.
    expect(CORPUS.flatMap(textOf).length).toBeGreaterThanOrEqual(4300);
    expect(MAPPER).toContain("src/components/bridge/mapper/MapperWorkbench.tsx");
    expect([...MAPPER, ...MAPPER_FED].flatMap(textOf).length).toBeGreaterThanOrEqual(700);
    for (const f of MAPPER_FED) expect(textOf(f).length, `${f} yields person-read text`).toBeGreaterThan(0);
    expect(HELP_PAGES.filter((f) => f.endsWith(".mdx")).length).toBeGreaterThanOrEqual(30);
  });
});
