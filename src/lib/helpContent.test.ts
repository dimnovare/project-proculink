import { existsSync, readdirSync, readFileSync } from "fs";
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

// Every registered page, derived from the two registries. The live client guides are the ones served under
// /help/guides; admin runbooks are served elsewhere and are not help pages.
const PAGES = [
  ...HELP_ARTICLES.map((a) => ({ slug: a.slug, path: join(HELP_DIR, a.slug, "page.mdx"), stub: a })),
  ...GUIDES.filter((g) => g.audience === "client" && g.status === "live").map((g) => ({
    slug: g.slug, path: join(HELP_DIR, "guides", g.slug, "page.mdx"), stub: g,
  })),
];

describe("help content", () => {
  it("leaves no registered page as a stub", () => {
    // Anti-vacuity: the walk must cover every page on disk, so a page nobody registered cannot hide.
    expect(PAGES.length, "registered pages and mdx files on disk disagree").toBe(mdxFiles(HELP_DIR).length);
    for (const { slug, path, stub } of PAGES) {
      // A stub is a title and a one-line lead; an article is several times that.
      expect(words(body(path)), `${slug} is still a stub`).toBeGreaterThan(4 * words(`${stub.title} ${stub.blurb}`));
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

describe("never-claim destination patterns", () => {
  const pattern = (label: string) => NEVER_CLAIM.find((n) => n.label === label)!.pattern;
  const CASES: [label: string, text: string, hit: boolean][] = [
    ["OneDrive or SharePoint (except on request)", "Send it to OneDrive", true],
    ["OneDrive or SharePoint (except on request)", "We deliver to SharePoint. Ask us.", true],
    ["OneDrive or SharePoint (except on request)", "Microsoft OneDrive and SharePoint: on request", false],
    ["plain-FTP destination", "Deliver via FTP", true],
    ["plain-FTP destination", "We deliver it to your FTP server.", true],
    ["plain-FTP destination", "Upload a file to your FTP server and we collect it", false],
    ["plain-FTP destination", "Send to an SFTP or FTPS server", false],
    ["plain-FTP destination", "Destinations: email, an SFTP or FTPS server, or a download.", false],
    ["totals check", "We flag a total that doesn't add up", true],
    ["totals check", "Checks the totals before it sends", true],
    ["totals check", "A totals check runs on every plan", true],
    ["totals check", "One puts the total top right, another at the bottom.", false],
    ["totals check", "Add a field called Total and we find it.", false],
  ];
  it.each(CASES)("%s: %s", (label, text, hit) => {
    expect(pattern(label).test(text)).toBe(hit);
  });
});

describe("the checks claim", () => {
  const BACKEND = process.env.PROCULINK_BACKEND_PATH;
  const job = BACKEND && join(BACKEND, "ProcuLink.Api/Jobs/SendDocumentJob.cs");

  it("fails rather than skips when CI required the mirror", () => {
    // CI checks the backend out, so there "no checkout" is a failure and not a reason to skip.
    if (process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1") expect(job && existsSync(job), "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout").toBeTruthy();
  });

  // The articles say checks never stop you sending, and only a repeated document number holds an AUTOMATIC send.
  // `SendDocumentJob.ShouldSend` is where that is decided, and the UI says the first half in `states.tsx`.
  it.skipIf(!job || !existsSync(job))("matches the rule the automatic send and the UI really use", () => {
    const send = readFileSync(job as string, "utf8");
    const rule = send.slice(send.indexOf("ShouldSend(FlowDocument"));
    const codes = [...rule.slice(0, rule.indexOf("public static")).matchAll(/DocumentChecks\.(\w+)/g)].map((m) => m[1]);
    expect(codes, "ShouldSend must look at exactly one check: the duplicate number").toEqual(["Duplicate"]);
    expect(readFileSync(join(process.cwd(), "src/components/flows/states.tsx"), "utf8")).toContain("they never stop you sending");
    const article = readFileSync(join(HELP_DIR, "checks", "page.mdx"), "utf8");
    expect(article).toContain("never stop you sending");
    expect(article).toContain("always waits for you");
  });
});
