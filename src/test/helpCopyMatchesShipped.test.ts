import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { COPY, canRetryRead, readFailureMessage } from "@/lib/documentRefusals";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { publicGuides } from "@/lib/guides";

/**
 * The troubleshooting article is a promise about what the screens say and which buttons they carry, so it
 * fails the way a button does: silently, and only for the person acting on it.
 *
 * Both directions are read from the product, never typed here:
 *   - every sentence the article quotes and every label it bolds must appear in the shipped copy;
 *   - every read failure the product treats as final (no **Try again**) must be quoted by the article.
 *
 * The shipped copy is the source text of the screens a reader sees (the flow and document components, the
 * refusal table, the status manifest and the app navigation), so renaming a button breaks the article's test
 * instead of quietly making the article wrong.
 */

const ROOT = process.cwd();
const ARTICLE = join(ROOT, "src", "app", "(marketing)", "help", "troubleshooting", "page.mdx");
const FLOWS = join(ROOT, "src", "components", "flows");

const SHIPPED = [
  ...readdirSync(FLOWS).filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f)).map((f) => join(FLOWS, f)),
  join(ROOT, "src", "lib", "documentRefusals.ts"),
  join(ROOT, "src", "lib", "documentStatusManifest.ts"),
  join(ROOT, "src", "lib", "flowSteps.ts"),   // the flow page's step names
  join(ROOT, "src", "components", "bridge", "BridgeSidebar.tsx"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** A label must be a whole string or whole JSX text in the corpus, never a fragment of a longer sentence. */
const whole = (label: string, corpus: string) => {
  const l = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[>"'\`]\\s*${l}\\s*[<"'\`]|^\\s*${l}\\s*$`, "m").test(corpus);
};

const body = readFileSync(ARTICLE, "utf8").split("# Troubleshooting")[1] ?? "";
const quoted = [...body.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
const bold = [...body.matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => m[1]);

describe("the troubleshooting article quotes and names what the product shows", () => {
  it("every quoted sentence and every bold label is in the shipped copy", () => {
    // Anti-vacuity: the article quotes a dozen messages and bolds a dozen labels; an empty walk proves nothing.
    expect(quoted.length, "no quoted messages found").toBeGreaterThanOrEqual(10);
    expect(bold.length, "no bold labels found").toBeGreaterThanOrEqual(10);
    // Sentences match as substrings of the shipped copy. A bold label must be a whole string or whole JSX text
    // there (`>Label<`, "Label", 'Label', `Label` or a line of its own), so a short label such as Send cannot
    // survive a rename by matching a longer sentence.
    const missing = [...quoted.filter((q) => !SHIPPED.includes(q)), ...bold.filter((b) => !whole(b, SHIPPED))];
    expect(missing, "in the article but not in the shipped copy").toEqual([]);
  });

  it("every read failure the product treats as final is quoted, and so is the fallback", () => {
    const final = Object.keys(COPY).filter((reason) => !canRetryRead(reason));
    expect(final.length, "the product has final read failures").toBeGreaterThanOrEqual(3);
    for (const reason of [...final, null]) {
      expect(quoted, `the article never quotes the message for ${reason}`).toContain(readFailureMessage(reason));
    }
  });
});

/**
 * Every public help page, not just troubleshooting: a control a page names in bold must be a label the app
 * really shows, so renaming a button in the app fails here instead of leaving a help sentence quietly false.
 *
 * The app copy is every non-test source file under src/components, src/lib and src/app/(app), with comments
 * stripped (a label must not survive a rename by matching its own old doc comment) and without help's own
 * files (a bold topic name would otherwise match its own registry title).
 *
 * The first bold span on a line or list item is a lead-in term (`- **FTPS.** The same...`), not a control,
 * and is skipped. Known limit: lower-case emphasis can match an attribute value (`**username**` matches
 * `autoComplete="username"`), so this proves a label exists somewhere in app source, not on the screen the
 * sentence describes.
 */
const HELP_DIR = join(ROOT, "src", "app", "(marketing)", "help");
const HELP_PAGES = (readdirSync(HELP_DIR, { recursive: true }) as string[])
  .filter((f) => f.replace(/\\/g, "/").split("/").pop() === "page.mdx")
  .map((f) => join(HELP_DIR, f));

const HELP_OWN = /^src\/(components\/help\/|lib\/(help-articles|guides|section-guides|help-search)\.ts$)/;
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const APP_COPY = [join("src", "components"), join("src", "lib"), join("src", "app", "(app)")]
  .flatMap((d) => (readdirSync(join(ROOT, d), { recursive: true }) as string[]).map((f) => join(d, f).replace(/\\/g, "/")))
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f) && !HELP_OWN.test(f))
  .map((f) => stripComments(readFileSync(join(ROOT, f), "utf8")).replace(/&apos;/g, "'")) // JSX writes I&apos;ve
  .join("\n");

const labelsIn = (mdx: string) =>
  mdx
    .replace(/export const metadata[\s\S]*?\n};?\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .flatMap((line) => {
      const l = line.replace(/`[^`]*`/g, "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
      const spans = [...l.matchAll(/\*\*([^*\n]+)\*\*/g)];
      return (l.startsWith("**") ? spans.slice(1) : spans).map((m) => m[1].trim());
    });

// Measured on the unedited help text (2026-11-16): 430 bold labels, rounded down to a multiple of 50.
const LABEL_FLOOR = 400;

describe("every public help page names only controls the app shows", () => {
  it("every bold label in a public help page is a label the app shows", () => {
    expect(HELP_PAGES.length).toBeGreaterThanOrEqual(
      HELP_ARTICLES.length + publicGuides().filter((g) => g.status === "live").length,
    );
    const misses = HELP_PAGES.flatMap((f) =>
      labelsIn(readFileSync(f, "utf8"))
        .filter((l) => !whole(l, APP_COPY))
        .map((l) => `${relative(ROOT, f).replace(/\\/g, "/")}: **${l}**`),
    );
    const total = HELP_PAGES.reduce((n, f) => n + labelsIn(readFileSync(f, "utf8")).length, 0);
    expect(total, "the walk found almost no bold labels").toBeGreaterThanOrEqual(LABEL_FLOOR);
    expect(misses, "a help page names a control the app does not show; fix the help sentence (or the label, if the app is wrong)").toEqual([]);
  });
});