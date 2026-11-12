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

// Each help-content task adds its own slugs; the last one flips this to every registered page.
const WRITTEN = {
  articles: [
    "how-proculink-works", "documents-and-statuses", "what-we-read", "checks", "flows", "senders", // Task 6
    "intake-channels", "outputs", "destinations", "destination-sign-in", "lookups", // Task 7
  ],
  guides: [
    "set-up-your-first-flow", "check-and-send-a-document", "teach-a-value", "publish-a-flow-version", // Task 6
    "receive-documents-by-email", "collect-from-a-mailbox", "collect-from-a-server", "collect-from-s3", "build-an-output", // Task 7
    "build-an-output-from-a-sample", "build-an-output-from-documentation", "send-to-a-destination", "import-a-lookup",
  ],
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

describe("never-claim destination patterns", () => {
  const pattern = (label: string) => NEVER_CLAIM.find((n) => n.label === label)!.pattern;
  const CASES: [label: string, text: string, hit: boolean][] = [
    ["S3 destination", "Outputs go to S3", true],
    ["S3 destination", "Send to SFTP, FTPS or S3", true],
    ["S3 destination", "Send the output to an S3 bucket.", true],
    ["S3 destination", "Collect documents from an S3 bucket", false],
    ["S3 destination", "Send documents in by S3 pickup", false],
    ["plain-FTP destination", "Deliver via FTP", true],
    ["plain-FTP destination", "We deliver it to your FTP server.", true],
    ["plain-FTP destination", "Upload a file to your FTP server and we collect it", false],
    ["plain-FTP destination", "Send to an SFTP or FTPS server", false],
    ["plain-FTP destination", "Destinations: email, an SFTP or FTPS server, or a download.", false],
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
