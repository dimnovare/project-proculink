import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";

import { ROOT } from "./appRoutes";
import { isOperatorSentence, scanUserFacingCopy, USER_FACING_SOURCES, BLOCKING_TIERS } from "./backendUserCopy";
import { baselineKey, KNOWN_BACKEND_COPY_VIOLATIONS } from "./backendUserCopy.baseline";
import { GLOSS, JARGON, METAPHOR, TIERS, termPattern } from "../../scripts/lib/vocabularyTerms.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// The BACKEND half of the vocabulary gate.
//
// `scripts/check-vocabulary.mjs` polices frontend source. `OrderProblemPanel` renders
// `order.errorMessage` — a sentence composed in C#, in another repo — verbatim into the
// operator's explanation block. So half the user-facing copy in this product was outside
// the reach of the rule that governs it. src/test/backendUserCopy.ts carries the render
// path hop by hop and the corpus that follows from it; this file is the check.
//
// ONE VOCABULARY, NOT TWO. Both consumers read scripts/lib/vocabularyTerms.mjs. Two
// hand-maintained copies of one rule is the drift this repo keeps paying for, and it would
// be worse here than usual: the two copies would be in different languages, so nothing
// short of reading both files would reveal that a word banned on one side of the wire is
// allowed on the other.
//
// Same honesty rules as src/test/backendMirror.test.ts, which this file sits beside in the
// `backend-mirror` CI job:
//
//   • The FILTER and the SCANNER are exercised against inline fixtures on EVERY run,
//     everywhere. A filter that quietly stopped matching would otherwise "confirm" the
//     corpus by finding nothing.
//   • The DIFF runs whenever a backend checkout is reachable.
//   • In CI it is MANDATORY: PROCULINK_REQUIRE_BACKEND_MIRROR=1 turns "no backend" from a
//     legitimate skip into a failure.
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bun run test src/test/backendCopyVocabulary.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/** The backend checkout, or null. Same walk-up as the three sibling mirror suites. */
function findBackendRoot(): string | null {
  const probe = USER_FACING_SOURCES[0].file;
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, probe))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, probe))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/**
 * Corpus files that legitimately contain NO operator sentence.
 *
 * They are in the corpus because they THROW `TransformValidationException` with line
 * numbers only — the prose is composed in the exception itself — so they carry the render
 * path without carrying copy. Listed rather than tolerated, because "this file yielded
 * nothing" is otherwise indistinguishable from "the reader broke on this file", and the
 * latter is precisely the silent hole this suite exists to close: if
 * DeliveryService.cs ever drops to zero sentences, that is a parse failure, not a cleanup.
 */
const EXPECTED_SENTENCE_FREE: readonly string[] = [
  "ProcuLink.Transform/Output/XmlTransformService.cs",
  "ProcuLink.Transform/Output/JsonTransformService.cs",
  "ProcuLink.Transform/Output/CsvTransformService.cs",
  "ProcuLink.Infrastructure/Services/Dispatchers/ErpDeliveryDispatchers.cs",
];

/**
 * The floor for the whole corpus. 247 sentences at the provenance SHA.
 *
 * Sized well below that, because ordinary backend churn moves it and a floor that fails on
 * a normal week gets raised until it means nothing. It is not decoration: a broken path
 * resolution, a reader that stopped reading, or a filter inverted by a careless edit all
 * land at or near zero, and every one of those would otherwise report "no violations" and
 * go green — the vacuous pass this repo has shipped more than once.
 */
const MIN_SENTENCES = 150;

// ── Always-on: the vocabulary itself is real ─────────────────────────────────

describe("the shared vocabulary is non-vacuous", () => {
  test("all three tiers carry words, and the block/warn split is declared once", () => {
    // Guards everything below: an emptied list matches nothing, and "nothing matched" is
    // indistinguishable from "everything is clean".
    expect(METAPHOR.length).toBeGreaterThan(10);
    expect(JARGON.length).toBeGreaterThan(30);
    expect(GLOSS.length).toBeGreaterThan(20);
    expect(TIERS.map((t) => t.name)).toEqual(["metaphor", "jargon", "gloss"]);
    expect(BLOCKING_TIERS).toEqual(["metaphor", "jargon"]);
  });

  test("termPattern matches whole words only", () => {
    const re = () => termPattern(JARGON);
    expect(re().test("No outbound artifact found.")).toBe(true);
    expect(re().test("Order is in dead-letter state.")).toBe(true);
    // The whole-word rule is what keeps this list usable: substring matching would report
    // "artifactory" and "unroutedly", and a gate with false positives gets switched off.
    expect(re().test("artifactory is a package host")).toBe(false);
    expect(re().test("bindings")).toBe(true);
    expect(re().test("rebindings")).toBe(false);
  });
});

// ── Always-on: the filter does what the corpus depends on ────────────────────

describe("isOperatorSentence separates operator copy from log lines", () => {
  test("a real operator sentence is kept", () => {
    expect(isOperatorSentence("No outbound artifact found. Transform the order before retrying delivery.")).toBe(true);
    expect(isOperatorSentence("Cannot transform: lines {} still need review.")).toBe(true);
    // Opens on an interpolated value — the shape of every wrapper that splices ex.Message.
    expect(isOperatorSentence("{} could not be applied, so the order was not delivered.")).toBe(true);
  });

  test("an ILogger message template is dropped", () => {
    // THE LOAD-BEARING CASE. A plain (non-$) C# string keeps its hole NAMES, and every
    // structured log line in the backend has them; an interpolated operator sentence is
    // normalised to `{}` by the reader. Without this the corpus-wide scan reports 229
    // block-tier hits instead of 19, and 212 of those are `_logger.Log*` arguments.
    expect(isOperatorSentence("Delivery {OrderId}: downloading artifact {FileKey} ({Protocol})")).toBe(false);
    expect(isOperatorSentence("Order {OrderId} (org {OrgId}) TRANSFORM FAILED terminally: {Error}.")).toBe(false);
  });

  test("code-shaped literals are dropped", () => {
    expect(isOperatorSentence("application/json")).toBe(false);
    expect(isOperatorSentence("delivery_dead_letter")).toBe(false);
    expect(isOperatorSentence("https://example.invalid/orders")).toBe(false);
    expect(isOperatorSentence("<cXML payloadID=\"x\">")).toBe(false);
    expect(isOperatorSentence("ok")).toBe(false);
    expect(isOperatorSentence("Two words")).toBe(false); // under the three-word floor
  });
});

describe("the scanner finds what it is pointed at", () => {
  test("reads a C# sentence, joins a + run, and reports its tier and line", () => {
    // Exercised through the REAL scanner against a temporary corpus, so the fixture proves
    // the same code path CI runs — not a re-implementation of it beside the thing it tests.
    const scan = scanUserFacingCopy(join(ROOT, "src", "test", "fixtures", "backendCopy"), [
      { file: "SampleService.cs", carrier: "OrderDto.ErrorMessage", why: "fixture" },
    ]);

    const keys = scan.violations.map((v) => `${v.tier}:${v.term}`);
    // The `+`-joined pair reads as ONE sentence: a matcher for "dead-letter" spanning the
    // join finds nothing if the two halves are reported separately.
    expect(keys).toContain("jargon:dead-letter");
    expect(scan.violations.find((v) => v.term === "dead-letter")!.text).toBe(
      "This order is in dead-letter state, so nothing further will be attempted.",
    );
    // Interpolation holes are normalised, and the `", "` INSIDE one did not end the string.
    expect(scan.violations.some((v) => v.text === "Cannot transform: lines {} still need review.")).toBe(true);
    expect(keys).toContain("gloss:transform");
    // A comment quoting a banned word is not a sentence the service writes.
    expect(scan.violations.some((v) => v.text.includes("commented-out"))).toBe(false);
    // …and the log template in the fixture was dropped rather than scanned.
    expect(scan.violations.some((v) => v.text.includes("{OrderId}"))).toBe(false);
    expect(scan.sentenceCount).toBeGreaterThan(0);
    expect(scan.literalCount).toBeGreaterThan(scan.sentenceCount);
  });
});

// ── Always-on: the baseline is itself well-formed ────────────────────────────

describe("the baseline is a real list", () => {
  test("it is non-empty, block-tier only, and has no duplicate identities", () => {
    expect(KNOWN_BACKEND_COPY_VIOLATIONS.length).toBeGreaterThan(0);
    for (const v of KNOWN_BACKEND_COPY_VIOLATIONS) {
      expect(BLOCKING_TIERS, `${v.file} pins a non-blocking tier: ${v.tier}`).toContain(v.tier);
      expect(v.lines.length, `${v.file} "${v.term}" cites no line`).toBeGreaterThan(0);
      expect(
        USER_FACING_SOURCES.map((s) => s.file),
        `${v.file} is pinned but is not in the corpus, so nothing would ever re-check it`,
      ).toContain(v.file);
      // The pinned term must really be in the pinned text. A typo here would make the entry
      // unmatchable, and an unmatchable entry reads as "already fixed" forever.
      expect(termPattern([v.term]).test(v.text), `${v.file}: "${v.term}" is not in the pinned text`).toBe(true);
    }
    const keys = KNOWN_BACKEND_COPY_VIOLATIONS.map(baselineKey);
    expect(new Set(keys).size, "two baseline entries share an identity").toBe(keys.length);
  });

  test("every corpus entry names a carrier and a hop", () => {
    expect(USER_FACING_SOURCES.length).toBeGreaterThan(15);
    for (const s of USER_FACING_SOURCES) {
      expect(s.file).toMatch(/^ProcuLink\.[\w.]+\/[\w./]+\.cs$/);
      expect(s.carrier.length, `${s.file} names no carrier`).toBeGreaterThan(3);
      expect(s.why.length, `${s.file} names no hop`).toBeGreaterThan(30);
    }
    expect(new Set(USER_FACING_SOURCES.map((s) => s.file)).size).toBe(USER_FACING_SOURCES.length);
  });
});

// ── Always-on: the render path this whole suite rests on still exists ────────

describe("the render path is still what the corpus claims", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  test("OrderProblemPanel still prints the server's own sentence", () => {
    const panel = read("src/components/bridge/problem/OrderProblemPanel.tsx");
    // The three candidates, the sanitiser, and the render of the result. If this stops
    // being true the corpus is answering a question nobody is asking any more — which is a
    // reason to re-scope the guard, not to let it keep passing.
    expect(panel).toContain("serverMessage: order.errorMessage?.trim()");
    expect(panel).toContain("[rejectionReason, attemptMessage, ctx.serverMessage]");
    expect(panel).toContain(".map(supplierReasonText)");
    expect(panel).toContain("{detail}");
  });

  test("supplierReasonText returns a plain sentence UNCHANGED", () => {
    // The single most important fact behind this suite: the one function between the wire
    // and the DOM is a markup stripper, not a rewriter. If it ever started substituting
    // frontend copy for backend prose, this guard would be measuring nothing.
    const src = read("src/components/bridge/problem/supplierReasonText.ts");
    expect(src).toContain("if (!looksLikeMarkupOrPayload(trimmed)) return clamp(trimmed);");
  });

  test("the transform cause table augments the copy around the sentence, never replaces it", () => {
    // `detail` is not a member of ProblemCopy, so `withTransformCause` cannot override it.
    // Asserted on the source because that is where the invariant lives.
    const copy = read("src/components/bridge/problem/problemCopy.ts");
    const start = copy.indexOf("function withTransformCause");
    expect(start, "withTransformCause is gone — re-derive whether the raw message still renders").toBeGreaterThan(0);
    const body = copy.slice(start, copy.indexOf("\n}", start));
    expect(body).not.toContain("detail");
  });
});

// ── The mirror gate ──────────────────────────────────────────────────────────

describe("the backend copy vocabulary holds", () => {
  test("this run either scanned, or was allowed not to", () => {
    if (BACKEND) return;
    expect(
      REQUIRE_MIRROR,
      "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so no backend copy was " +
        "scanned. This run proves nothing about what the order screen prints. Set PROCULINK_BACKEND_PATH to a " +
        "ProcuLink checkout (the `backend-mirror` job in .github/workflows/ci.yml does this with " +
        "actions/checkout), or unset PROCULINK_REQUIRE_BACKEND_MIRROR if this run is genuinely not meant to " +
        "enforce it.",
    ).toBe(false);
  });

  test.skipIf(!BACKEND)("every corpus file still exists", () => {
    // A corpus file that moved is DRIFT, not "nothing to scan". Silently scanning 23 files
    // instead of 24 is how a whole writer disappears from the guard without a word.
    const missing = USER_FACING_SOURCES.filter((s) => !existsSync(join(BACKEND!, s.file))).map((s) => s.file);
    expect(
      missing,
      `USER_FACING_SOURCES cites ${missing.join(", ")}, which the backend no longer has. Re-derive the render ` +
        "path for those carriers and update the corpus — do not just delete the row.",
    ).toEqual([]);
  });

  test.skipIf(!BACKEND)("the scan read a corpus of roughly the expected size", () => {
    const scan = scanUserFacingCopy(BACKEND!);
    expect(
      scan.sentenceCount,
      `scanned only ${scan.sentenceCount} operator sentence(s) across ${USER_FACING_SOURCES.length} files. ` +
        "A run this small has not checked the backend's copy — the literal reader, the path resolution or " +
        "isOperatorSentence has broken, and 'no violations' would be a vacuous pass.",
    ).toBeGreaterThanOrEqual(MIN_SENTENCES);

    // Which files are ALLOWED to be silent is declared, so a rich file falling to zero is a
    // failure rather than a quietly smaller corpus.
    const silent = Object.entries(scan.sentencesByFile)
      .filter(([, n]) => n === 0)
      .map(([f]) => f)
      .sort();
    expect(
      silent,
      "a corpus file yielded no operator sentence. If it genuinely carries none, add it to " +
        "EXPECTED_SENTENCE_FREE with the reason; if it used to carry some, the reader broke on it.",
    ).toEqual([...EXPECTED_SENTENCE_FREE].sort());
  });

  test.skipIf(!BACKEND)("no NEW banned word has reached an operator's screen", () => {
    const scan = scanUserFacingCopy(BACKEND!);
    const known = new Set(KNOWN_BACKEND_COPY_VIOLATIONS.map(baselineKey));
    const unexpected = scan.violations
      .filter((v) => BLOCKING_TIERS.includes(v.tier))
      .filter((v) => !known.has(baselineKey(v)));

    expect(
      unexpected.map((v) => `${v.file}:${v.line} [${v.tier}:${v.term}] ${JSON.stringify(v.text)}`),
      "A backend sentence uses a word ProcuLink does not ship to users, and it renders VERBATIM in the order " +
        "problem panel (OrderProblemPanel.tsx:289-305). Fix the sentence in the backend repo — see " +
        "src/test/backendUserCopy.ts for the render path and scripts/lib/vocabularyTerms.mjs for the " +
        "replacement words. Pin it in src/test/backendUserCopy.baseline.ts ONLY if it cannot be fixed now.",
    ).toEqual([]);
  });

  test.skipIf(!BACKEND)("no baseline entry has gone stale", () => {
    // THE DIRECTION MOST GUARDS FORGET. A fixed violation that stays pinned means the next
    // reader believes it is still broken, and the list stops being a work item and becomes
    // furniture. This is also the mutation this guard was checked against.
    const scan = scanUserFacingCopy(BACKEND!);
    const live = new Set(scan.violations.filter((v) => BLOCKING_TIERS.includes(v.tier)).map(baselineKey));
    const stale = KNOWN_BACKEND_COPY_VIOLATIONS.filter((v) => !live.has(baselineKey(v)));

    expect(
      stale.map((v) => `${v.file}:${v.lines.join(",")} [${v.tier}:${v.term}] ${JSON.stringify(v.text)}`),
      "A pinned violation is no longer in the backend — either it was fixed, or the sentence was reworded. " +
        "Delete the entry from src/test/backendUserCopy.baseline.ts (that deletion IS the second half of the " +
        "fix). If it was reworded and still carries the banned word, the scan will report it as new; update " +
        "the entry's text rather than removing it.",
    ).toEqual([]);
  });

  test.skipIf(!BACKEND)("the baseline is exactly the live block-tier set", () => {
    // Both directions in one assertion, so neither can be satisfied by weakening the other.
    const scan = scanUserFacingCopy(BACKEND!);
    const live = [...new Set(scan.violations.filter((v) => BLOCKING_TIERS.includes(v.tier)).map(baselineKey))].sort();
    const pinned = [...new Set(KNOWN_BACKEND_COPY_VIOLATIONS.map(baselineKey))].sort();
    expect(live.length, "the scan found no block-tier violation at all — that is a broken scan, not a clean repo")
      .toBeGreaterThan(0);
    expect(live).toEqual(pinned);
  });
});
