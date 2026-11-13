import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { ROOT } from "./appRoutes";
import { stripComments, syntaxFor } from "./sourceScan";

// ─────────────────────────────────────────────────────────────────────────────
// The status-vocabulary gate.
//
// WHY THIS FILE EXISTS. The product shipped TWO failure vocabularies at once —
// the engine-stage names ("Parse failed", "Transform failed", "Delivery failed",
// "Rejected by supplier") and the plain-procurement renames DESIGN-DB-1 §6.4
// rows 70-75 specified ("Couldn't read file", "Couldn't build output",
// "Couldn't send", "Supplier rejected"). Both were live at the same moment on
// the same screen: /operations/exceptions rendered the badge from STATUS_META
// and, one span to its right, a second hand-written label from a private map in
// ExceptionDetail.tsx — so a parse failure was captioned "Delivery failed".
//
// Nothing mechanical caught it, and nothing could have: copy asserting something
// about behaviour is not type-checked against that behaviour. A help article can
// teach a label the product has not used for months and every suite stays green.
// This file was the missing type-check, done the only way prose can be checked —
// by DERIVING the expected words from the one registry that owned them and
// asserting every other surface repeated them.
//
// THE SOURCE OF TRUTH was STATUS_META in src/components/bridge/UnifiedStatusBadge.tsx,
// because DESIGN-DB-1 §6.4 says what each label must be and STATUS_META was the
// only place in the frontend that said the same thing. It is gone (see below).
//
// What this file holds now is RETIRED_LABELS — the words that must never come
// back. Those cannot be derived from anything, because their defining property
// is that they are absent, so they are the one place literals are written down.
//
// 2026-11-13: STATUS_META went with UnifiedStatusBadge and the order screens
// that rendered it, and so did every describe that read it (the label registry,
// the problem panel's parity with it, the issues article, the status renderers
// and the upload page's tone). What is left is the retired-vocabulary scan; its
// `nowUse` hints are the last labels that registry held, written down.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Labels the product used to ship and must never ship again.
 *
 * The stage-name labels are matched CASE-SENSITIVELY and as whole title-case
 * phrases, because that is the form a LABEL takes. Lowercase "delivery failed"
 * mid-sentence is ordinary English ("the delivery failed at 14:02") and stays
 * allowed on purpose — banning it would push authors into worse sentences to
 * satisfy a gate, which is how a gate starts getting worked around.
 *
 * Each entry names the surface that carried it, so a future reader can tell a
 * regression from a fresh mistake.
 */
const RETIRED_LABELS: Array<{ phrase: string; re: RegExp; wasAt: string; nowUse: string }> = [
  { phrase: "Parse failed", re: /Parse failed/g, wasAt: "help/exceptions-and-stuck-orders", nowUse: "Couldn't read file" },
  { phrase: "Transform failed", re: /Transform failed/g, wasAt: "BridgeDashboard.neededFor + two help articles", nowUse: "Couldn't build output" },
  { phrase: "Delivery failed", re: /Delivery failed/g, wasAt: "ExceptionDetail, BridgeTopbar, problemCopy, healthTiles", nowUse: "Couldn't send" },
  { phrase: "Rejected by supplier", re: /Rejected by supplier/g, wasAt: "ExceptionDetail, OrderPassport, help/exceptions-and-stuck-orders", nowUse: "Supplier rejected" },
  { phrase: "Output failed", re: /Output failed/g, wasAt: "problemCopy, healthTiles", nowUse: "Couldn't build output" },
  { phrase: "Supplier refused it", re: /Supplier refused it/g, wasAt: "problemCopy, healthTiles", nowUse: "Supplier rejected" },
  // The near-miss: one article-word away from the registry, which is exactly the
  // kind of drift a reviewer reads straight past.
  { phrase: "Couldn't read the file", re: /Couldn't read the file/g, wasAt: "problemCopy, healthTiles", nowUse: "Couldn't read file" },
  {
    // DESIGN-DB-1 §6.5 row 85. scripts/check-vocabulary.mjs already bans this
    // everywhere it can SEE — but it exempts the whole help centre and
    // src/lib/help-articles.ts, and it reads .ts files only through label-ish
    // keys, so a bare `return "…the dead-letter queue…"` was invisible to it.
    // Both blind spots were occupied. This covers them.
    //
    // The lookarounds keep API FACTS out: `/api/ops/dead-letter`,
    // `queryKey: ["ops-dead-letter"]` and `dead-letter-count` are a route, a
    // cache key and an endpoint — renaming them would break the client, and
    // they are not words anybody reads. A `/`, `-` or word character on either
    // side means the token is part of a path or identifier, not a sentence.
    phrase: "dead-letter (as a word, not as a route or cache key)",
    re: /(?<![\w/-])dead[- ]letter(ed|s)?(?![\w-])/gi,
    wasAt: "help articles, help-articles.ts search keywords, useOrderReview",
    nowUse: "Out of retries",
  },
];

const HELP = "src/app/(marketing)/help";
const ARTICLE_EXCEPTIONS = `${HELP}/exceptions-and-stuck-orders/page.mdx`;

const readRaw = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * A file's RENDERED copy — everything except the help registry's `keywords`
 * arrays.
 *
 * Those are a Fuse search index (src/lib/help-search.ts weights them at 0.15)
 * and are never printed anywhere. Banning a retired word there would cost the
 * one thing it is good for — an operator who learned the old vocabulary, or an
 * engineer reading a backend log, still finds the article by typing "dead
 * letter" — and would buy nothing, because nobody reads them. The `title` and
 * `blurb` beside them DO render, on the help index card and in every search
 * result, and stay in scope.
 */
const read = (rel: string) => readRaw(rel).replace(/keywords:\s*\[[^\]]*\]/g, "keywords: []");

/**
 * Every source file that can put words in front of a user: the app, the
 * marketing site (help included), the components, and the top-level lib
 * registries. Tests, fixtures and mocks are excluded — a test may name a
 * retired label in order to assert it is gone, and this file does exactly that.
 */
function copyBearingFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "mocks" || entry === "node_modules" || entry === "__snapshots__") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mdx)$/.test(entry)) continue;
      if (/\.(test|spec|stories)\.(ts|tsx)$/.test(entry)) continue;
      out.push(relative(ROOT, full).replace(/\\/g, "/"));
    }
  };
  walk(join(ROOT, "src"));
  // This gate lists the retired words in order to ban them, and the shared
  // scanners it borrows are not copy either.
  return out.filter((f) => !f.startsWith("src/test/") && !OWNED_BY_HELP_COPY_PACKET.includes(f));
}

/**
 * The two articles FE #75 (`claude/help-status-copy`) rewrites, deferred to it
 * rather than fixed twice.
 *
 * Both still carry a retired word on `main` — that is exactly what #75 is for —
 * and a second, competing rewrite of the same file is worth less than the
 * conflict it costs. So the scan skips them and this packet keeps the surfaces
 * #75 does not touch.
 *
 * DELIBERATELY NOT A SILENT SKIP. An exemption that outlives its reason is a
 * hole, and this one has an expiry nothing would otherwise notice. The test
 * below asserts each entry is STILL DIRTY, so the moment #75 lands and cleans a
 * file, that entry fails and has to be deleted — which puts the file back under
 * the scan in the same commit.
 */
const OWNED_BY_HELP_COPY_PACKET = [
  // dashboard-and-statuses/page.mdx was here and is now scanned normally: this IS
  // the help-copy packet, so on this branch the file is already rewritten. The
  // guard below caught its own exemption outliving its reason, exactly as its
  // comment promised — which is why it is removed rather than silenced.
  "src/app/(marketing)/help/inbox-basics/page.mdx",
];

describe("the retired vocabulary is gone from every surface that renders words", () => {
  const files = copyBearingFiles();

  test.each(OWNED_BY_HELP_COPY_PACKET)(
    "%s is still dirty, so deferring it to FE #75 is still the right call",
    (rel) => {
      // Fails the day #75 lands and cleans the file. That failure is the point:
      // delete the entry, and the file rejoins the scan in the same commit.
      const copy = stripComments(read(rel), syntaxFor(rel));
      const still = RETIRED_LABELS.filter(({ re }) => {
        re.lastIndex = 0;
        return re.test(copy);
      }).map((r) => r.phrase);
      expect(
        still,
        `${rel} is clean — FE #75 has landed. Remove it from OWNED_BY_HELP_COPY_PACKET.`,
      ).not.toEqual([]);
    },
  );

  test("the scan reaches the files it claims to (guards against an empty walk)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(ARTICLE_EXCEPTIONS);
    expect(files).toContain("src/lib/help-articles.ts");
  });

  test.each(RETIRED_LABELS)("$phrase is nowhere in shipped copy (use $nowUse)", ({ phrase, re, nowUse }) => {
    const hits: string[] = [];
    for (const rel of files) {
      // Comments are not copy. A comment explaining WHY a word was retired is
      // the most useful place for it to survive, so stripping is what lets the
      // ban be absolute in the text a user can actually read.
      const code = stripComments(read(rel), syntaxFor(rel));
      code.split(/\r?\n/).forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
    expect(hits, `"${phrase}" is retired — use "${nowUse}":\n${hits.join("\n")}`).toEqual([]);
  });
});
