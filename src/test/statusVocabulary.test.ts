import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { STATUS_LABELS } from "@/components/bridge/UnifiedStatusBadge";
import { PROBLEM_COPY, PROBLEM_STATUSES } from "@/components/bridge/problem/problemCopy";
import { TILES } from "@/app/(app)/operations/health/healthTiles";
import { recentStatusFromOrder } from "@/components/bridge/UploadWorkbench";
import { deliveryNote } from "@/components/bridge/ExceptionDetail";
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
// This file is the missing type-check, done the only way prose can be checked —
// by DERIVING the expected words from the one registry that owns them and
// asserting every other surface repeats them.
//
// THE SOURCE OF TRUTH is STATUS_META in src/components/bridge/UnifiedStatusBadge.tsx,
// re-exported here as STATUS_LABELS. It is the source of truth because
// DESIGN-DB-1 §6.4 says what each label must be and STATUS_META is the only
// place in the frontend that says the same thing. Every assertion below reads
// STATUS_LABELS rather than repeating a label, so renaming a status in the
// registry moves this gate with it instead of breaking it.
//
// The one place literals ARE written down is RETIRED_LABELS — the words that
// must never come back. Those cannot be derived from anything, because their
// defining property is that they are absent.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every status the API can put on an order, from
 * ProcuLink.Core/Constants/OrderStatusConstants.cs (backend repo).
 *
 * Hand-copied because it lives in another repo and another language — so it is
 * pinned as a LIST here and the first test asserts the frontend can label all of
 * them. A status added to the backend and not to STATUS_META falls through to
 * humanize() and ships the raw key with underscores swapped for spaces
 * ("Delivery dead letter"), which is how `unrouted` once rendered as a neutral
 * badge that disagreed with its own row.
 */
const BACKEND_STATUSES = [
  "pending_parse",
  "parsing",
  "unrouted",
  "pending_review",
  "ready",
  "transforming",
  "ready_to_deliver",
  "delivery_held",
  "delivering",
  "delivered",
  "delivery_failed",
  "delivery_unconfirmed",
  "delivery_dead_letter",
  "transform_failed",
  "rejected_by_supplier",
  "failed",
] as const;

/**
 * OrderStatusConstants.FailureBucket — the five statuses the inbox collapses
 * into one red "Failed" pill. Every one of them is a state an operator has to
 * act on, so every one needs its own name everywhere the operator can land.
 */
const FAILURE_BUCKET = [
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_dead_letter",
  "rejected_by_supplier",
] as const;

/**
 * The statuses OrderExceptionService.ProblemFor opens an exception for
 * (ProcuLink.Infrastructure/Services/OrderExceptionService.cs:31-61). These are
 * exactly the rows a user meets on /operations/exceptions, so the exceptions
 * article has to name all eight — the old article named six and silently
 * dropped the routing hold and the unknown-outcome park.
 */
const EXCEPTION_STATUSES = [
  "unrouted",
  "pending_review",
  "failed",
  "transform_failed",
  "delivery_failed",
  "delivery_unconfirmed",
  "rejected_by_supplier",
  "delivery_dead_letter",
] as const;

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
  { phrase: "Parse failed", re: /Parse failed/g, wasAt: "help/exceptions-and-stuck-orders", nowUse: STATUS_LABELS.failed },
  { phrase: "Transform failed", re: /Transform failed/g, wasAt: "BridgeDashboard.neededFor + two help articles", nowUse: STATUS_LABELS.transform_failed },
  { phrase: "Delivery failed", re: /Delivery failed/g, wasAt: "ExceptionDetail, BridgeTopbar, problemCopy, healthTiles", nowUse: STATUS_LABELS.delivery_failed },
  { phrase: "Rejected by supplier", re: /Rejected by supplier/g, wasAt: "ExceptionDetail, OrderPassport, help/exceptions-and-stuck-orders", nowUse: STATUS_LABELS.rejected_by_supplier },
  { phrase: "Output failed", re: /Output failed/g, wasAt: "problemCopy, healthTiles", nowUse: STATUS_LABELS.transform_failed },
  { phrase: "Supplier refused it", re: /Supplier refused it/g, wasAt: "problemCopy, healthTiles", nowUse: STATUS_LABELS.rejected_by_supplier },
  // The near-miss: one article-word away from the registry, which is exactly the
  // kind of drift a reviewer reads straight past.
  { phrase: "Couldn't read the file", re: /Couldn't read the file/g, wasAt: "problemCopy, healthTiles", nowUse: STATUS_LABELS.failed },
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
    nowUse: STATUS_LABELS.delivery_dead_letter,
  },
];

const HELP = "src/app/(marketing)/help";
const ARTICLE_STATUSES = `${HELP}/dashboard-and-statuses/page.mdx`;
const ARTICLE_EXCEPTIONS = `${HELP}/exceptions-and-stuck-orders/page.mdx`;
const ARTICLE_INBOX = `${HELP}/inbox-basics/page.mdx`;

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

describe("every status the API returns has a canonical frontend label", () => {
  test.each(BACKEND_STATUSES)("%s is in STATUS_META", (status) => {
    expect(
      Object.prototype.hasOwnProperty.call(STATUS_LABELS, status),
      `${status} falls through to humanize() and would ship its raw key`,
    ).toBe(true);
    expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
  });

  test("no two failure states share a label", () => {
    // The five failure statuses need five distinct names: the whole reason a
    // second vocabulary was survivable is that "Delivery failed" was used for
    // three of them at once, so an operator could not tell which had happened.
    const labels = FAILURE_BUCKET.map((s) => STATUS_LABELS[s]);
    expect(new Set(labels).size).toBe(FAILURE_BUCKET.length);
  });

  test("`ready` and `ready_to_deliver` stay distinct (DESIGN-DB-1 §6.4 rows 57-58)", () => {
    expect(STATUS_LABELS.ready).not.toBe(STATUS_LABELS.ready_to_deliver);
  });

  /**
   * Keys that are two spellings of ONE user-visible state. Call sites rewrite
   * between them (operations/health/page.tsx mapped `rejected_by_supplier` to
   * `rejected` for years, on a comment claiming STATUS_META lacked the first),
   * so the two must resolve identically or such a rewrite silently changes what
   * an operator reads.
   */
  test.each([
    ["failed", "parse_failed"],
    ["rejected_by_supplier", "rejected"],
    ["delivered", "sent"],
    ["ready_to_deliver", "transformed"],
    ["parsing", "extracting"],
    ["parsing", "normalizing"],
    ["pending_review", "review"],
    ["pending_review", "needs_review"],
  ])("%s and %s are the same state and read the same", (a, b) => {
    expect(STATUS_LABELS[a]).toBe(STATUS_LABELS[b]);
  });
});

describe("the order screen's problem panel repeats the registry, never re-invents it", () => {
  // problemCopy.ts documents `badge` as "The status pill's words. Mirrors
  // UnifiedStatusBadge; never re-invented here." That sentence was false for
  // four of the eight states, and nothing noticed, because a comment asserting
  // something about the code beside it is not checked against that code. This
  // is the assertion that makes it true.
  test.each(PROBLEM_STATUSES)("%s badge equals the registry label", (status) => {
    expect(PROBLEM_COPY[status].badge).toBe(STATUS_LABELS[status]);
  });
});

describe("a health tile names the same thing the inbox it opens will show", () => {
  /**
   * Two tiles legitimately do NOT name a status: they count orders STUCK in an
   * in-progress one, which is a different fact from the status itself. An order
   * that is merely "Extracting" is fine; one that has been extracting past the
   * threshold is the problem the tile exists to surface.
   */
  const STUCKNESS_TILES = new Set(["parsingStuck", "deliveringStuck"]);

  const statusTiles = TILES.map((t) => ({ ...t, status: /[?&]status=([a-z_]+)/.exec(t.href)?.[1] }))
    .filter((t) => t.status && Object.prototype.hasOwnProperty.call(STATUS_LABELS, t.status))
    .filter((t) => !STUCKNESS_TILES.has(t.key as string));

  test("the derivation found the status tiles (guards against an empty each-loop)", () => {
    // Without this, renaming `href` or the query parameter would empty the list
    // above and every assertion below would pass by iterating nothing.
    expect(statusTiles.length).toBeGreaterThanOrEqual(6);
  });

  test.each(statusTiles.map((t) => [t.status as string, t.label] as const))(
    "the %s tile is labelled with the registry label",
    (status, label) => {
      expect(label).toBe(STATUS_LABELS[status]);
    },
  );
});

describe("the issues article teaches the labels the product renders", () => {
  /**
   * SCOPE. This covers `exceptions-and-stuck-orders` ONLY.
   *
   * `dashboard-and-statuses` and `inbox-basics` belong to FE #75
   * (`claude/help-status-copy`), which rewrites both and ships
   * src/test/help-status-labels.test.ts to hold them. That test is the better
   * one for those two files and this test deliberately does not duplicate it: it
   * derives the inbox chip list and the bulk-send rule by scanning
   * `InboxView.FILTER_CHIPS` and `inboxSend.BULK_SELECTABLE_STATUSES` at source,
   * and it asserts the harder direction — every label an article TEACHES must be
   * one the product prints, which catches an invented label as well as a stale
   * one. Two tests for one invariant is how they drift apart.
   *
   * The division is by FILE, so there is exactly one owner per article:
   *   #75  →  dashboard-and-statuses, inbox-basics
   *   here →  exceptions-and-stuck-orders, and every RENDER site
   */

  /**
   * `**Label**`, not a bare substring. An article that happens to contain the
   * word "Delivered" inside a sentence has not TAUGHT the status; the article
   * writes every status it defines as a bold term in a bullet, so requiring the
   * bold is what separates "teaches it" from "mentions something that looks like
   * it".
   */
  const teaches = (article: string, label: string) => article.includes(`**${label}**`);

  test.each(EXCEPTION_STATUSES)(
    "the issues article teaches %s by its shipped label",
    (status) => {
      expect(
        teaches(read(ARTICLE_EXCEPTIONS), STATUS_LABELS[status]),
        `${ARTICLE_EXCEPTIONS} never defines "**${STATUS_LABELS[status]}**"`,
      ).toBe(true);
    },
  );
});

describe("the surfaces that name a status read the registry to do it", () => {
  /**
   * A phrase ban catches a REGRESSION to the old words. It cannot catch the
   * INVENTION of new wrong ones — hard-coding `{"Draft"}` where
   * `statusLabel(row.rawStatus)` used to be passes every check above, because
   * "Draft" is a perfectly good label for a different thing. Found by mutating
   * exactly that and watching the gate stay green.
   *
   * This is the structural half: a file that puts an order's state in front of a
   * user has to get the words from the registry, not from a literal. It is a
   * source-text check and therefore weaker than a render test — a file could
   * keep one call and hard-code a second — so it is a floor, not a proof.
   */
  const STATUS_RENDERERS = [
    "src/components/bridge/UploadWorkbench.tsx",
    "src/components/bridge/BridgeTopbar.tsx",
    "src/components/bridge/CommandPalette.tsx",
    "src/components/bridge/BridgeDashboard.tsx",
    "src/components/bridge/ExceptionDetail.tsx",
    "src/app/(app)/operations/health/page.tsx",
  ];

  test.each(STATUS_RENDERERS)("%s names statuses via statusLabel/UnifiedStatusBadge", (rel) => {
    const code = stripComments(read(rel), syntaxFor(rel));
    expect(/statusLabel\s*\(|<UnifiedStatusBadge/.test(code)).toBe(true);
  });

  test.each(BACKEND_STATUSES)(
    "the upload page gives %s an honest tone instead of the unknown-status bucket",
    (status) => {
      // `draft` is the fallback for a status this list has never heard of. Five
      // real ones landed in it — including a supplier REJECTION, which read
      // "Draft" on /upload while the inbox called it what it was.
      expect(recentStatusFromOrder(status)).not.toBe("draft");
    },
  );

  test("every failure state reads as a failure on the upload page", () => {
    for (const status of FAILURE_BUCKET) {
      expect(recentStatusFromOrder(status), `${status} is not toned as a failure`).toBe("failed");
    }
  });
});

describe("a sentence only promises a re-send when the product can re-send", () => {
  /**
   * The half a phrase ban cannot reach.
   *
   * Everything above checks WORDS. This checks a CLAIM, because the two fail
   * differently: a retired word is a stale label, but a sentence saying "fix the
   * cause and send it again" on a `rejected_by_supplier` order sends an operator
   * hunting for a control that cannot exist. No delivery claim set admits that
   * status — OrderStatusMachine is explicit that re-sending the refused bytes is
   * deliberately not an exit — and `problemCopy` says so in its own copy
   * ("Sending the same file again would be refused the same way") while offering
   * "Start a corrected order" instead. The exceptions screen said the opposite.
   *
   * Found by mutation: reverting that one sentence left every other assertion in
   * this file green, which is TRAP 25 in miniature. This closes THAT INSTANCE.
   * It does not close the class — prose is still not type-checked against
   * behaviour, and the only general defence is reading the merged copy.
   */
  const RESENDABLE = new Set([
    // POST /redeliver — inboxSend.REDELIVERABLE_STATUSES, mirroring the backend's
    // OrderStatusMachine.RedeliverableFrom.
    "ready_to_deliver",
    "delivery_failed",
    "delivery_unconfirmed",
    // Not redeliverable, but the order screen carries the ops requeue as
    // "Start sending again" (problemCopy delivery_dead_letter), so a sentence
    // pointing there is true.
    "delivery_dead_letter",
  ]);

  /** An imperative promise to send THIS order again. Deliberately does not match
   *  a DENIAL of one ("Sending the same file again would be refused"). */
  const PROMISES_RESEND = /\b(send it again|send the order again|send this order again|re-?send|try sending)\b/i;

  test.each(BACKEND_STATUSES.filter((s) => !RESENDABLE.has(s)))(
    "the %s sentence does not tell the operator to send it again",
    (status) => {
      const { detail } = deliveryNote(status, null);
      expect(
        PROMISES_RESEND.test(detail),
        `${status} cannot be re-sent, but its sentence promises it: "${detail}"`,
      ).toBe(false);
    },
  );

  test("the check is not vacuous — a re-sendable status is allowed to say it", () => {
    expect(PROMISES_RESEND.test(deliveryNote("delivery_failed", null).detail)).toBe(true);
  });

  /**
   * The other half of the same claim, and the reason it is here rather than in a
   * comment: having said "you cannot re-send it", the sentence goes on to name
   * what you CAN do — start a corrected order — and that is a promise about a
   * control in `problemCopy`, in a different file, which another packet is
   * editing right now.
   *
   * That edit will not conflict: it touches the `href` and leaves the label
   * alone, so git auto-merges, TypeScript compiles, and nothing would notice if
   * the action were renamed or dropped out from under this sentence. This is the
   * notice.
   */
  test("the refused-order sentence names an action the order screen really offers", () => {
    const offered = PROBLEM_COPY.rejected_by_supplier.actions({
      supplier: "BoltWorks BV",
      po: "PO 4091678643",
      supplierId: "sup-1",
      orderId: "ord-1",
      serverMessage: null,
      // WP-19 added these two to ProblemCtx. Null is the "no named cause" path,
      // which is what a refused order carries — the cause slugs describe delivery
      // failures, not a supplier's business rejection.
      failureCause: null,
      retryAfterSeconds: null,
      readOnly: false,
      accountStatus: null,
      atOrderLimit: false,
      processingPaused: false,
    });
    const corrected = offered.find((a) => a.kind === "link" && /corrected/i.test(a.label));
    expect(
      corrected,
      "problemCopy no longer offers a 'corrected order' action — ExceptionDetail's sentence for a refused order promises one",
    ).toBeTruthy();
    expect(deliveryNote("rejected_by_supplier", null).detail).toMatch(/corrected/i);
  });
});

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
    expect(files).toContain("src/components/bridge/ExceptionDetail.tsx");
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
