import { afterAll, describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  DECLARED_TERMINAL,
  FAILURE_STATUSES,
  OP_GUARDS,
  ORDER_STATUSES,
  RESOLVE_HELD_FROM,
} from "@/lib/orderStatusManifest";
import { ROOT } from "./appRoutes";
import { DOCUMENT_STATUSES } from "@/lib/documentStatusManifest";
import { FIELD_MEANINGS } from "@/lib/fieldMeanings";
import { FORMATS } from "@/components/flows/OutputEditor";
import { PREVIEW_FORMATS } from "@/lib/api/types";
import { STANDARDS } from "@/lib/standards/catalog";
import {
  TRANSFORM_CAUSE_MATCHERS,
  TRANSFORM_CAUSE_NAMES,
  transformCauseNameFor,
  type TransformCauseName,
} from "@/components/bridge/problem/problemCopy";
// The C# string-literal reader this file introduced now has a second consumer
// (src/test/backendCopyVocabulary.test.ts), so it lives in one place rather than two.
// Its own header explains why a `grep` cannot replace it.
import { parseCsStringExpressions, stripCsComments } from "./csLiterals";
import { MINIMUM_PLAN } from "@/lib/gatedCapabilities";
import { OVERAGE_PER_ORDER_EUR, PLAN_BY_ID } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// The cross-repo mirror check.
//
// `src/lib/orderStatusManifest.ts` is a hand-kept copy of C# constants that live
// in another repo and another language. Every previous copy of those constants in
// this codebase carried a comment naming the symbol it mirrored, and a comment is
// not a check: `OP_ALLOWED_FROM.retryDelivery` cited `ClaimableForRetryFrom` while
// the endpoint is guarded by `RetryableFrom`, a strictly smaller set, and the one
// test that existed to catch mirror drift compared the frontend Set against a
// hand-typed array in the test file — so it asserted the drift as the contract and
// both halves were green together.
//
// This file parses the real C# and diffs it.
//
//   • The PARSER is tested against an inline fixture on EVERY run, everywhere. A
//     parser that quietly stopped matching would otherwise "confirm" the mirror by
//     finding nothing, which is the vacuous-pass shape WP-02 exists to prevent.
//   • The DIFF runs whenever a backend checkout is reachable — the env var
//     PROCULINK_BACKEND_PATH, or a sibling `ProcuLink` directory found by walking
//     up from this repo. Locally that is the normal case.
//   • In CI the diff is MANDATORY. The `backend-mirror` job in .github/workflows/ci.yml
//     checks the backend repo out and sets PROCULINK_REQUIRE_BACKEND_MIRROR=1, and
//     under that flag a run that cannot reach a backend FAILS instead of skipping.
//
// WHY THE REQUIRE FLAG EXISTS AT ALL — this is the defect the flag was added for.
// For as long as this file has existed the diff was `test.skipIf(!BACKEND)` and the
// frontend workflow neither checked the backend out nor set PROCULINK_BACKEND_PATH.
// So every CI run reported `backendMirror.test.ts (22 tests | 12 skipped)` and went
// green: the one mechanism that makes the manifest checkable rather than annotated
// had never executed once in CI. An annotation that reports itself as a passing test
// is worse than no test, because it retires the question. A skip is only honest while
// something, somewhere, is obliged to un-skip it.
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bun run test src/test/backendMirror.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const CONSTANTS_REL = "ProcuLink.Core/Constants/OrderStatusConstants.cs";
const MACHINE_REL = "ProcuLink.Core/Constants/OrderStatusMachine.cs";
const TRANSFORM_SERVICE_REL = "ProcuLink.Api/Services/Orders/OrderTransformService.cs";
/**
 * THE list of outbound transforms the solution ships. `OutputTransformRegistry.All` is what both
 * hosts register (via `AddOutputTransforms()`) AND what `OutputTransformRegistry.Catalog` derives
 * the buildable-format allow-list from, so it is the one place a transform can be added or removed.
 */
const TRANSFORM_REGISTRY_REL = "ProcuLink.Transform/Output/OutputTransformRegistry.cs";
/** Where each registered transform's own `CanTransform` arm lives, keyed by class name. */
const TRANSFORM_OUTPUT_DIR = "ProcuLink.Transform/Output";
/** Declares `enum OutputFormat` — the members, buildable and not, that `CanTransform` is asked about. */
const OUTPUT_FORMAT_ENUM_REL = "ProcuLink.Core/Services/ITransformService.cs";
/**
 * The API DI composition root. No longer read for individual `ITransformService` registrations —
 * BE #182 replaced those with a single `AddOutputTransforms()` — but still read to confirm the host
 * really delegates to the registry rather than hand-listing transforms beside it.
 */
const PROGRAM_REL = "ProcuLink.Api/Program.cs";
/** The worker host. Registers the same transform layer; `TransformOrderJob` is where transform runs. */
const WORKER_PROGRAM_REL = "ProcuLink.Worker/Program.cs";
/**
 * Declares `PlanConstants.MinimumPlan` — the price list, in code. Which tier a gated
 * capability starts on is a COMMERCIAL decision, and `src/lib/gatedCapabilities.ts`
 * re-types the whole table by hand so marketing and help copy can derive tier names.
 */
const PLAN_CONSTANTS_REL = "ProcuLink.Core/Constants/PlanConstants.cs";
const DOCUMENT_STATUS_REL = "ProcuLink.Core/Documents/DocumentStatus.cs";

/**
 * Every C# file this suite parses.
 *
 * A checkout that resolves but is missing one of these is DRIFT, not "no backend" —
 * the manifest cites the file by path, so the path going away is exactly the thing
 * worth failing over. It is listed here rather than left to each test because a
 * missing file used to read as `skipIf` and skip green: a readability flag computed
 * from `existsSync` meant renaming a mirrored file retired its own diffs silently
 * while the rest of the suite stayed green.
 */
const PARSED_FILES = [
  CONSTANTS_REL,
  MACHINE_REL,
  TRANSFORM_SERVICE_REL,
  TRANSFORM_REGISTRY_REL,
  OUTPUT_FORMAT_ENUM_REL,
  PROGRAM_REL,
  WORKER_PROGRAM_REL,
  PLAN_CONSTANTS_REL,
  DOCUMENT_STATUS_REL,
] as const;

/**
 * The backend checkout, or null.
 *
 * Walks up from this repo looking for a sibling `ProcuLink` that contains the two
 * files we parse — the frontend is often opened as a git worktree several levels
 * below its own repo root, so a fixed `../ProcuLink` does not resolve.
 */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, CONSTANTS_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, CONSTANTS_REL)) && existsSync(join(candidate, MACHINE_REL))) {
      return candidate;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();

/**
 * Set by the `backend-mirror` CI job. When true, "no backend checkout" stops being a
 * legitimate reason to skip and becomes a build failure.
 *
 * Deliberately opt-IN rather than opt-out. A developer who has not cloned the backend
 * still gets the parser tests, which is the honest amount of coverage available on
 * that machine. CI has no such excuse: the job exists to check the backend out.
 */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/** The files a resolved backend must contain, of `PARSED_FILES`. */
export function missingParsedFiles(backendRoot: string, exists: (p: string) => boolean): string[] {
  return PARSED_FILES.filter((rel) => !exists(join(backendRoot, rel)));
}

/**
 * Why this run is not allowed to proceed, or null.
 *
 * Pure, and unit-tested below against both branches — the branch that matters cannot
 * be exercised by running this suite on a machine that HAS the backend cloned, which
 * is every machine the file was written on. That is precisely how the CI gap survived.
 */
export function mirrorGateFailure(input: {
  backendRoot: string | null;
  missing: readonly string[];
  required: boolean;
}): string | null {
  if (input.backendRoot === null) {
    if (!input.required) return null;
    return (
      "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so the " +
      "cross-repo diff did not run. This run proves nothing about src/lib/orderStatusManifest.ts. " +
      "Set PROCULINK_BACKEND_PATH to a ProcuLink checkout (the `backend-mirror` job in " +
      ".github/workflows/ci.yml does this with actions/checkout), or unset " +
      "PROCULINK_REQUIRE_BACKEND_MIRROR if this run is genuinely not meant to enforce the mirror."
    );
  }
  if (input.missing.length > 0) {
    return (
      `The backend checkout at ${input.backendRoot} is missing ${input.missing.join(", ")}. ` +
      "src/lib/orderStatusManifest.ts cites those paths, so a path that no longer exists is " +
      "drift the manifest has to answer for — it is not a reason to skip the diff."
    );
  }
  return null;
}

// ── Anti-vacuity: prove the diff actually diffed something ───────────────────
//
// Counting is not decoration. Every silent-green shape this file has ever had was a
// run where the assertions were present and simply never reached: 12 skipped tests in
// CI, a `skipIf` on a file-exists probe, a regex that matches nothing and answers an
// empty list that compares equal to an empty list. So each real comparison is routed
// through one function that refuses an empty backend side and increments a counter,
// and `afterAll` asserts the counter reached the number of comparisons this file
// declares. A run that resolved a backend and compared nothing is a FAILURE.

/**
 * The op guards, each against the symbol its own row names.
 *
 * Every row names a set now: `assignSupplier`, the one inline-literal guard this filter
 * existed to exclude, went with its endpoint in plan 13b (2026-11-13).
 *
 * Module scope rather than describe scope, because the vacuity floor at the bottom of
 * the file sizes itself from this list.
 */
const NAMED_GUARDS = Object.entries(OP_GUARDS).filter(([, g]) => /^OrderStatusMachine\.\w+$/.test(g.backendSymbol));

let comparisonsRun = 0;

/**
 * One mirror comparison, counted.
 *
 * `backendValues` is what was actually read out of the C#. Empty is refused before the
 * equality runs, because `[]` equals `[]`: an emptied frontend constant would otherwise
 * "mirror" a backend symbol the parser failed to read.
 */
function recordComparison(label: string, backendValues: readonly string[], frontend: readonly string[], why: string): void {
  expect(
    backendValues.length,
    `${label}: the C# side parsed to an empty list, so this comparison would have proved nothing`,
  ).toBeGreaterThan(0);
  comparisonsRun += 1;
  expect(sorted(backendValues), why).toEqual(sorted(frontend));
}

// ── The parsers ──────────────────────────────────────────────────────────────
// Deliberately small and total. Each returns what it found; the callers assert on
// the contents, so "found nothing" fails loudly rather than passing quietly.

/** `public const string PendingParse = "pending_parse";` → { PendingParse: "pending_parse" } */
export function parseStatusConstants(cs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cs.matchAll(/public\s+const\s+string\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/**
 * A `Set(A, B, C)` initialiser for a named readonly set:
 *
 *   public static readonly IReadOnlySet<string> RetryableFrom =
 *       Set(DeliveryFailed);
 *
 * Returns the C# identifiers, unresolved — the caller maps them through the
 * constants table, so a renamed constant surfaces as an unknown identifier rather
 * than as a silently dropped member.
 */
export function parseNamedSet(cs: string, name: string): string[] | null {
  const re = new RegExp(
    `IReadOnlySet<string>\\s+${name}\\s*=\\s*(?:new\\s+HashSet<string>\\([^)]*\\)\\s*)?(?:Set\\s*\\(([^)]*)\\)|\\{([^}]*)\\})\\s*;`,
    "s",
  );
  const m = re.exec(cs);
  if (!m) return null;
  const body = m[1] ?? m[2] ?? "";
  return body
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^\w+$/.test(s));
}

/** The keys of the `Transitions` dictionary: `[PendingParse] = Set(...)`. */
export function parseTransitionKeys(cs: string): string[] {
  const start = cs.indexOf("Transitions =");
  if (start < 0) return [];
  const region = cs.slice(start, cs.indexOf("public static IReadOnlyCollection<string> AllStatuses", start));
  return [...region.matchAll(/^\s*\[(\w+)\]\s*=/gm)].map((m) => m[1]);
}

function resolveAll(identifiers: readonly string[], constants: Record<string, string>): string[] {
  return identifiers.map((id) => {
    const value = constants[id];
    if (!value) throw new Error(`C# identifier ${id} is not a status constant — the parser or the backend moved`);
    return value;
  });
}

const sorted = (xs: readonly string[]) => [...xs].sort();

// ── Always-on: the parsers work ──────────────────────────────────────────────

describe("the C# parsers actually parse (so a green diff means something)", () => {
  const FIXTURE_CONSTANTS = `
namespace ProcuLink.Core.Constants;
public static class OrderStatusConstants
{
    public const string PendingParse = "pending_parse";
    /// <summary>Some doc comment with "quotes" in it.</summary>
    public const string DeliveryFailed = "delivery_failed";
    public const string Failed = "failed";
    public static readonly IReadOnlySet<string> FailureBucket = new HashSet<string>(StringComparer.Ordinal)
    {
        Failed,
        DeliveryFailed,
    };
}`;

  const FIXTURE_MACHINE = `
public static class OrderStatusMachine
{
    public static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> Transitions =
        new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            [PendingParse]   = Set(Parsing),
            // a comment between rows
            [DeliveryFailed] = Set(Delivering, Ready),
        };

    public static IReadOnlyCollection<string> AllStatuses => (IReadOnlyCollection<string>)Transitions.Keys;

    /// <summary>Doc.</summary>
    public static readonly IReadOnlySet<string> RetryableFrom =
        Set(DeliveryFailed);
}`;

  test("constants are read with their values", () => {
    const consts = parseStatusConstants(FIXTURE_CONSTANTS);
    expect(consts.PendingParse).toBe("pending_parse");
    expect(consts.DeliveryFailed).toBe("delivery_failed");
    expect(Object.keys(consts)).toHaveLength(3);
  });

  test("a brace-initialised set is read", () => {
    expect(parseNamedSet(FIXTURE_CONSTANTS, "FailureBucket")).toEqual(["Failed", "DeliveryFailed"]);
  });

  test("a Set(...)-initialised set is read across a line break", () => {
    expect(parseNamedSet(FIXTURE_MACHINE, "RetryableFrom")).toEqual(["DeliveryFailed"]);
  });

  test("a set that does not exist answers null, not an empty set", () => {
    // The difference decides whether a missing symbol reads as "the backend
    // renamed it" or as "the backend admits nothing from anywhere".
    expect(parseNamedSet(FIXTURE_MACHINE, "NoSuchSetFrom")).toBeNull();
  });

  test("transition keys are read and stop at AllStatuses", () => {
    expect(parseTransitionKeys(FIXTURE_MACHINE)).toEqual(["PendingParse", "DeliveryFailed"]);
  });

  test("an unresolvable identifier throws instead of being dropped", () => {
    expect(() => resolveAll(["Nope"], { Failed: "failed" })).toThrow(/not a status constant/);
  });
});

// ── Always-on: the gate that decides whether a skip is allowed ───────────────
//
// These run everywhere, including on a machine with the backend cloned, which is the
// point. The branch that matters — "required to diff, and could not" — is unreachable
// by simply running this suite on a developer's box, because `findBackendRoot` finds
// the sibling checkout there every time. Being unable to exercise the failing branch
// is precisely how the CI gap went unnoticed, so the decision is a pure function and
// both branches are asserted directly.

describe("the mirror gate decides correctly", () => {
  const complete = { missing: [] as string[] };

  test("no backend and no requirement: a skip is allowed", () => {
    expect(mirrorGateFailure({ backendRoot: null, ...complete, required: false })).toBeNull();
  });

  test("no backend but REQUIRED: fails, and names what to set", () => {
    const failure = mirrorGateFailure({ backendRoot: null, ...complete, required: true });
    expect(failure).not.toBeNull();
    expect(failure).toContain("PROCULINK_BACKEND_PATH");
    expect(failure).toContain("did not run");
  });

  test("a resolved backend missing a parsed file fails EVEN WHEN not required", () => {
    // Not required ≠ free to ignore a checkout that cannot answer the question. A
    // missing file here is drift in the manifest's own citations.
    const failure = mirrorGateFailure({
      backendRoot: "/tmp/backend",
      missing: [MACHINE_REL],
      required: false,
    });
    expect(failure).not.toBeNull();
    expect(failure).toContain(MACHINE_REL);
  });

  test("a complete backend passes, required or not", () => {
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", ...complete, required: true })).toBeNull();
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", ...complete, required: false })).toBeNull();
  });

  test("missingParsedFiles reports every file the checkout lacks", () => {
    const present = new Set([join("/tmp/backend", CONSTANTS_REL)]);
    expect(missingParsedFiles("/tmp/backend", (p) => present.has(p))).toEqual([
      MACHINE_REL,
      TRANSFORM_SERVICE_REL,
      TRANSFORM_REGISTRY_REL,
      OUTPUT_FORMAT_ENUM_REL,
      PROGRAM_REL,
      WORKER_PROGRAM_REL,
      PLAN_CONSTANTS_REL,
      DOCUMENT_STATUS_REL,
    ]);
    expect(missingParsedFiles("/tmp/backend", () => true)).toEqual([]);
    // A checkout with nothing in it must report all three, not zero.
    expect(missingParsedFiles("/tmp/backend", () => false)).toHaveLength(PARSED_FILES.length);
  });
});

// ── The diff, when a backend checkout is reachable ───────────────────────────

describe("the manifest matches the C# it claims to mirror", () => {
  test("the mirror gate: this run either diffed, or was allowed not to", () => {
    // ALWAYS runs, and unlike the version this replaced it can fail. The old one
    // asserted that its own skip-reason string contained the words "PROCULINK_BACKEND_PATH",
    // which is true of the string literal on the line above it and of nothing else —
    // green whether or not a single byte of C# had been read.
    const failure = mirrorGateFailure({
      backendRoot: BACKEND,
      missing: BACKEND ? missingParsedFiles(BACKEND, existsSync) : [],
      required: REQUIRE_MIRROR,
    });
    expect(failure, failure ?? "").toBeNull();
  });

  test.skipIf(!BACKEND)("every status the machine keys is in the manifest, and vice versa", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const keys = parseTransitionKeys(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"));
    expect(keys.length, "parsed no transition keys — the parser has drifted from the C#").toBeGreaterThan(10);
    recordComparison(
      "OrderStatusMachine.Transitions keys",
      resolveAll(keys, constants),
      ORDER_STATUSES,
      "ORDER_STATUSES drifted from the statuses the machine actually keys.",
    );
  });

  test.skipIf(!BACKEND)("FailureBucket matches", () => {
    const cs = readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8");
    const members = parseNamedSet(cs, "FailureBucket");
    expect(members, "FailureBucket not found in OrderStatusConstants.cs").not.toBeNull();
    recordComparison(
      "OrderStatusConstants.FailureBucket",
      resolveAll(members!, parseStatusConstants(cs)),
      FAILURE_STATUSES,
      "FAILURE_STATUSES drifted. The inbox collapses this set into one red pill and `?status=failed` expands it server-side.",
    );
  });

  test.skipIf(!BACKEND)("DeclaredTerminal matches", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), "DeclaredTerminal");
    expect(members, "DeclaredTerminal not found in OrderStatusMachine.cs").not.toBeNull();
    recordComparison(
      "OrderStatusMachine.DeclaredTerminal",
      resolveAll(members!, constants),
      DECLARED_TERMINAL,
      "DECLARED_TERMINAL drifted. A status wrongly called terminal is one the product offers no way out of.",
    );
  });

  test.skipIf(!BACKEND)("ResolveHeldFrom matches", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), "ResolveHeldFrom");
    expect(members, "ResolveHeldFrom not found in OrderStatusMachine.cs").not.toBeNull();
    recordComparison(
      "OrderStatusMachine.ResolveHeldFrom",
      resolveAll(members!, constants),
      RESOLVE_HELD_FROM,
      "RESOLVE_HELD_FROM drifted. Every entry is a status where running the resolve recompute destroys something.",
    );
  });

  // NAMED_GUARDS is built at module scope — see its doc comment there.
  test("the guard walk is not empty", () => {
    expect(NAMED_GUARDS.length).toBe(4);
  });

  test.skipIf(!BACKEND).each(NAMED_GUARDS)("%s mirrors its named C# set exactly", (op, guard) => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const symbol = guard.backendSymbol.split(".")[1];
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), symbol);
    expect(members, `${op} cites ${guard.backendSymbol}, which is not in OrderStatusMachine.cs`).not.toBeNull();
    recordComparison(
      `${op} → ${guard.backendSymbol}`,
      resolveAll(members!, constants),
      guard.allowedFrom,
      `${op} mirrors ${guard.backendSymbol}. Manifest says [${sorted(guard.allowedFrom)}]; the C# says otherwise. A control offered on a status the endpoint refuses can only answer 400.`,
    );
  });

  test.skipIf(!BACKEND)("the file:line each guard cites still points at that guard's symbol", () => {
    // The line number is documentation and will rot; the FILE must at least still
    // reference the symbol, or the citation is sending the next reader nowhere.
    //
    // The symbol is taken from the LAST dotted identifier in `backendSymbol`, which
    // is why the pattern is anchored rather than split-and-pop: `assignSupplier`'s
    // entry is a sentence, not a symbol — "OrdersController.AssignSupplier inline
    // literal (OrderStatusConstants.Unrouted)" — and popping on "." yields
    // `Unrouted)` with the bracket attached. That happened to pass, because the C#
    // really does contain `…Unrouted)` inside a call. A check that is right by
    // accident on the one row it was written for is not a check.
    const rows = Object.entries(OP_GUARDS);
    expect(rows.length, "OP_GUARDS is empty, so this walk would check nothing").toBeGreaterThan(0);
    for (const [op, guard] of rows) {
      const [file] = guard.backendSite.split(":");
      const path = join(BACKEND!, file);
      expect(existsSync(path), `${op} cites ${file}, which does not exist`).toBe(true);
      const identifiers = [...guard.backendSymbol.matchAll(/\b[A-Z]\w*\.([A-Z]\w*)\b/g)].map((m) => m[1]);
      expect(identifiers.length, `${op}'s backendSymbol names no C# identifier: "${guard.backendSymbol}"`).toBeGreaterThan(0);
      const cs = readFileSync(path, "utf8");
      for (const symbol of identifiers) {
        expect(cs, `${op} cites ${symbol}, which ${file} no longer mentions`).toContain(symbol);
      }
    }
    comparisonsRun += 1;
  });
});

/** Production C# projects. Test projects are excluded — they set statuses no user ever sees. */
const BACKEND_PRODUCTION_PROJECTS = [
  "ProcuLink.Core",
  "ProcuLink.Infrastructure",
  "ProcuLink.Api",
  "ProcuLink.Worker",
  "ProcuLink.Transform",
];

/** Every production `.cs` under `roots`, skipping build output and generated migrations. */
export function collectCsFiles(base: string, roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a project that does not exist in this checkout is not a failure here
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        // `Migrations` holds EF-generated snapshots: the property name appears in
        // hundreds of them as a column declaration, and none of them write a status.
        if (name === "obj" || name === "bin" || name === "Migrations" || name.includes("Tests")) continue;
        walk(full);
      } else if (name.endsWith(".cs")) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(join(base, root));
  return out;
}

/**
 * Every `…LastSyncStatus = "value"` in the given source, values only.
 *
 * Matches an ASSIGNMENT, so a comparison (`LastSyncStatus == "running"`) and a pattern
 * (`LastSyncStatus is "ok" or …`) are not collected: reading a value proves nothing about
 * whether a writer can produce it, and this table is about what can reach a screen.
 */
export function parseAssignedStatusLiterals(cs: string, property: string): string[] {
  return [...cs.matchAll(new RegExp(`${property}\\s*=\\s*"([^"]*)"`, "g"))].map((m) => m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// The transform-failure MESSAGE mirror.
//
// `TRANSFORM_CAUSES` in src/components/bridge/problem/problemCopy.ts decides what
// the order screen tells an operator to do, and it decides it by running six
// hand-written regexes against an English sentence composed in another repo. There
// is no machine-readable cause for a transform failure — `failureCause` is
// populated for delivery only — so the prose IS the contract.
//
// Nothing pinned it. A backend reword did not break a build, did not fail a test
// and did not show up on screen as an error: the matcher simply stopped matching,
// the panel fell through to its unrecognised copy, and the operator lost the one
// sentence that named the fix. That is the same shape as every other mirror in this
// file — a comment citing a symbol in another language, checked by nobody.
//
// WHY A LITERAL READER AND NOT A `grep`. The five original sentences are written
// four different ways in the C#: a `const string` split across two concatenated
// literals, two `$"…{hole}…"` interpolations, a bare literal in a ternary branch,
// and three wrapper messages that end in `: {ex.Message}`. A substring search would
// need the same sentence typed here a second time — which is the defect this file
// exists to catch, not a way to catch it. Reading the literals means the assertion
// is "this pattern still matches something the service really writes", with the
// sentence itself never retyped on this side.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many sentences in OrderTransformService.cs each cause is allowed to claim.
 *
 * EXACT, not a floor. Zero means the backend reworded and the panel has silently
 * lost that cause's copy — the defect this section exists for. More than the
 * declared number means the pattern has widened onto a sentence it was not written
 * for, which is how an ordered first-match table starts eating its neighbours. A
 * genuinely new site is a number to change deliberately, with the copy re-read.
 */
const TRANSFORM_CAUSE_SITES: Record<TransformCauseName, number> = {
  // Three wrappers: the output tree, the pinned revision's mapping, the supplier's.
  output_mapping_failed: 3,
  unresolved_lines: 1,
  preparation_failed: 1,
  no_builder_for_format: 1,
  rules_check_failed: 1,
  rules_refused: 1,
};

describe("the transform-failure copy still matches the sentences the backend writes", () => {
  test("the literal reader actually reads (so a green diff means something)", () => {
    const fixture = [
      "public class Svc",
      "{",
      "    // const string reason = \"a sentence that was reworded away\";",
      "    /* \"and one in a block comment\" */",
      "    public void Go()",
      "    {",
      "        const string reason =",
      '            "Something went wrong, so it wasn\'t sent. "',
      '          + "Try again in a moment.";',
      '        var listed = $"Unresolved: {string.Join(", ", lines)}.";',
      "        var ch = '\"';",
      '        var picked = flag ? "the fallback sentence." : other;',
      '        var esc = "a \\"quoted\\" word";',
      "    }",
      "}",
    ].join("\n");

    const found = parseCsStringExpressions(fixture);

    // The two-part const reads as ONE sentence, which is the whole point: matched
    // against either half alone, a pattern spanning the join would find nothing.
    expect(found).toContain("Something went wrong, so it wasn't sent. Try again in a moment.");
    // The interpolation hole is normalised, and the `", "` INSIDE it did not end
    // the string early or leak in as a fragment.
    expect(found).toContain("Unresolved: {}.");
    expect(found).not.toContain(", ");
    expect(found).toContain("the fallback sentence.");
    expect(found).toContain('a "quoted" word');
    // Comments are not sentences the service writes. A reader that collected them
    // would confirm a message that no longer exists.
    expect(found.join("\n")).not.toContain("reworded away");
    expect(found.join("\n")).not.toContain("block comment");
  });

  test("the frontend table is itself non-vacuous", () => {
    // Guards the walk below: an emptied matcher list claims nothing, and "nothing
    // failed to match" is indistinguishable from "everything matched".
    expect(TRANSFORM_CAUSE_MATCHERS).toHaveLength(6);
    expect(sorted(TRANSFORM_CAUSE_MATCHERS.map((m) => m.cause))).toEqual(sorted(Object.keys(TRANSFORM_CAUSE_SITES)));
    expect(sorted([...TRANSFORM_CAUSE_NAMES])).toEqual(sorted(Object.keys(TRANSFORM_CAUSE_SITES)));
  });

  test.skipIf(!BACKEND)("the service still writes sentences at all", () => {
    const sentences = parseCsStringExpressions(readFileSync(join(BACKEND!, TRANSFORM_SERVICE_REL), "utf8"));
    expect(
      sentences.length,
      "parsed OrderTransformService.cs and found almost no string literals — the reader or the file moved",
    ).toBeGreaterThan(30);
  });

  test.skipIf(!BACKEND)("every cause matches the C# it was written against, and only that", () => {
    const sentences = parseCsStringExpressions(readFileSync(join(BACKEND!, TRANSFORM_SERVICE_REL), "utf8"));
    const claimed = new Map<string, string[]>();

    for (const { cause, match } of TRANSFORM_CAUSE_MATCHERS) {
      const hits = sentences.filter((s) => match.test(s));
      claimed.set(cause, hits);
      expect(
        hits.length,
        `${cause}: ${match} matches ${hits.length} sentence(s) in ${TRANSFORM_SERVICE_REL}, expected `
          + `${TRANSFORM_CAUSE_SITES[cause as TransformCauseName]}. Zero means the backend reworded the message and `
          + `the order screen quietly stopped naming this cause — an operator now gets the unrecognised copy `
          + `instead of the fix. More than expected means the pattern widened onto a sentence it was not `
          + `written for.\nMatched:\n  ${hits.join("\n  ")}`,
      ).toBe(TRANSFORM_CAUSE_SITES[cause as TransformCauseName]);
    }

    // Disjoint against the REAL sentences, not against the fixtures. The table is
    // ordered and first-match-wins, so a widened pattern does not fail on its own
    // message — it silently eats whichever cause is declared after it.
    for (const [cause, hits] of claimed) {
      for (const [other, otherHits] of claimed) {
        if (cause === other) continue;
        const shared = hits.filter((h) => otherHits.includes(h));
        expect(shared, `"${cause}" and "${other}" both claim:\n  ${shared.join("\n  ")}`).toEqual([]);
      }
    }
    comparisonsRun += 1;
  });

  test.skipIf(!BACKEND)("the panel routes every matched sentence to that cause end to end", () => {
    // The walk above proves each PATTERN still matches. This proves the LOOKUP the
    // panel actually calls returns the right cause for the real sentence — the two
    // differ the moment ordering changes, because `transformCauseNameFor` returns
    // the first match and the walk above scores each pattern in isolation.
    const sentences = parseCsStringExpressions(readFileSync(join(BACKEND!, TRANSFORM_SERVICE_REL), "utf8"));
    let routed = 0;
    for (const { cause, match } of TRANSFORM_CAUSE_MATCHERS) {
      for (const sentence of sentences.filter((s) => match.test(s))) {
        expect(transformCauseNameFor(sentence), `"${sentence}" routes to the wrong cause`).toBe(cause);
        routed += 1;
      }
    }
    expect(routed, "routed nothing — the sentences went missing between the two walks").toBe(
      Object.values(TRANSFORM_CAUSE_SITES).reduce((a, b) => a + b, 0),
    );
    comparisonsRun += 1;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Which formats ProcuLink can actually PRODUCE.
//
// WHY THIS IS A MIRROR AND NOT A LIST. `/formats` sold an outbound EDIFACT transformer
// ("Outbound EDIFACT transformer on request"), `/library/standards` offered EDIFACT in a
// format chooser, and the output designer told authors "ProcuLink builds EDIFACT itself".
// None of it was true: there is no EDIFACT `ITransformService`, no class implementing one,
// and no `CanTransform` arm answering `OutputFormat.EdifactOrders`. An order that reaches
// transform in that format is parked in terminal `transform_failed`.
//
// `src/test/gatedCapabilityClaims.test.ts` now refuses that claim on every surface, and it
// derives the verdict from two frontend registries: `STANDARDS[].transform` (the standards
// catalog) and `PREVIEW_FORMATS` (the output-format mirror). Both are hand-kept copies of a
// fact that lives in C#. Guarding the copy without checking it against the original is how
// `OP_ALLOWED_FROM.retryDelivery` cited the wrong C# symbol for as long as it did — the
// frontend was self-consistent and wrong together.
//
// So this diffs both registries against the C# itself. A seventh transform reddens here and
// names the registry that has to follow, rather than silently making the copy-guard's verdict
// stale — which is exactly what a hand-typed list of six transformer names would have done.
//
// WHAT MOVED, AND WHY THE FACT MIRRORED HERE CHANGED. Until BE #182 this block read
// `ProcuLink.Api/Program.cs` for `AddSingleton<ITransformService, …>` lines. #182 replaced those
// with one `AddOutputTransforms()` call over `OutputTransformRegistry.All`, so the old parser
// found ZERO registrations — and said so, loudly, instead of confirming an empty C# side. That
// refusal is the only reason this was a one-hour fix rather than a shipped lie.
//
// Repointing it also corrects what was being mirrored. The old parser read REGISTRATIONS — C#
// class names — and then leaned on a hand-typed map to say which FORMAT each class builds. Those
// are not the same fact, and #182 is the proof: `UblOrderTransformService.CanTransform` answers
// `OutputFormat.Ubl`, NOT `OutputFormat.UblOrder`, so of nine enum members only six are buildable
// and three (`UblOrder`, `X12_850`, `EdifactOrders`) are format-shaped names nothing can produce.
// The class-name → format leg was never checked against C#: had that map said `previewFormat:
// "ublorder"`, every assertion here would have stayed green while the frontend advertised a format
// that dies at transform. Buildable is the fact the surfaces actually claim, so buildable is what
// is mirrored now — derived the same way `OutputFormatCatalog` derives it, by reading each
// registered transform's own `CanTransform` arm rather than trusting its class name.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The class names in `OutputTransformRegistry.All`:
 *
 *   public static IReadOnlyList<ITransformService> All { get; } = new ITransformService[]
 *   {
 *       new XmlTransformService(),
 *       new UblOrderTransformService(), // Group M Phase 1 — …
 *   };
 *
 *   → ["XmlTransformService", "UblOrderTransformService"]
 *
 * Scoped to the `All` initialiser rather than run over the whole file, so an unrelated `new X()`
 * elsewhere in the registry cannot inflate the set, and comment-stripped so an inline note naming
 * a REMOVED transform cannot keep it alive.
 */
export function parseRegisteredTransforms(cs: string): string[] {
  const src = stripCsComments(cs);
  const start = src.search(/IReadOnlyList\s*<\s*ITransformService\s*>\s+All\b/);
  if (start < 0) return [];
  const open = src.indexOf("{", src.indexOf("=", start));
  if (open < 0) return [];
  const close = src.indexOf("}", open);
  if (close < 0) return [];
  return [...src.slice(open, close).matchAll(/new\s+(\w+)\s*\(\s*\)/g)].map((m) => m[1]);
}

/**
 * The `OutputFormat` members one transform's `CanTransform` answers true for:
 *
 *   public bool CanTransform(OutputFormat format) => format == OutputFormat.Ubl;  → ["Ubl"]
 *
 * Returns a list, not a single value, because nothing stops a transform from answering for more
 * than one format — and a reader that assumed one would silently drop the others. The arm is read
 * rather than inferred from the class name: `UblOrderTransformService` builds `Ubl`, and that gap
 * between what a class is CALLED and what it can BUILD is the whole reason this is parsed.
 */
export function parseCanTransformFormats(cs: string): string[] {
  const src = stripCsComments(cs);
  const m = /\bCanTransform\s*\([^)]*\)\s*(?:=>([^;]*);|\{([\s\S]*?)\n\s*\})/.exec(src);
  if (!m) return [];
  return [...(m[1] ?? m[2] ?? "").matchAll(/OutputFormat\s*\.\s*(\w+)/g)].map((x) => x[1]);
}

/** `enum OutputFormat { Xml, Csv, … }` → ["Xml", "Csv", …]. Comment-stripped for the same reason. */
export function parseOutputFormatMembers(cs: string): string[] {
  const src = stripCsComments(cs);
  const start = src.search(/\benum\s+OutputFormat\b/);
  if (start < 0) return [];
  const open = src.indexOf("{", start);
  const close = src.indexOf("}", open);
  if (open < 0 || close < 0) return [];
  return src
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\w+$/.test(s));
}

/**
 * The persisted token for an `OutputFormat` member — `OutputFormatCatalog.Token`, which is
 * `format.ToString().ToLowerInvariant()`. The one spelling the delivery-config and
 * connection-revision columns store, and the one `PREVIEW_FORMATS` uses.
 */
function formatToken(member: string): string {
  return member.toLowerCase();
}

/**
 * The enum members no transform can build, per BE #182.
 *
 * `UblOrder` and `X12_850` NAME a conformance profile, and `EdifactOrders` is inbound-only —
 * `EdifactOrderParser` reads it and no `ITransformService` writes it. Pinned by name rather than
 * left to the count alone, because "6 of 9" would still hold if the buildable and unbuildable
 * halves swapped members.
 */
const UNBUILDABLE_OUTPUT_FORMATS = ["UblOrder", "X12_850", "EdifactOrders"] as const;

/**
 * What each BUILDABLE output format means on this side, keyed by its persisted token.
 *
 * `catalogId` is the standards-catalog row the format produces, or null when it has no standards
 * row to have one — generic XML is a shape, not a published standard, and `/formats` carries it as
 * a hand-typed row for that reason.
 *
 * Keyed by FORMAT rather than by transform class name, deliberately. The class name is an
 * implementation detail: renaming `X12TransformService` changes no capability and must not redden
 * a claim guard, exactly as the old parser was lifetime-agnostic so Singleton→Scoped would not read
 * as the capability disappearing. What a surface may advertise is the format.
 *
 * This map is hand-written, and that is the point rather than a compromise: its KEYS are diffed
 * against the real C# below, so a seventh buildable format cannot be absorbed silently. Someone has
 * to come here and say which standard it emits, which is the moment the marketing catalog and the
 * designer's emitted-format set need updating too.
 */
const BUILDABLE_FORMATS: Record<string, { catalogId: string | null }> = {
  xml: { catalogId: null },
  csv: { catalogId: "csv" },
  cxml: { catalogId: "cxml-1-2" },
  json: { catalogId: "json-rest" },
  ubl: { catalogId: "ubl-2-1-order" },
  x12: { catalogId: "x12-850" },
  // One clean A4 copy (DocumentPdfOutput). No catalog row: `pdf-text` is the PDF intake standard.
  pdf: { catalogId: null },
};

/**
 * The buildable format tokens, derived from the backend the way `OutputFormatCatalog` derives
 * them: take the registered transforms, ask each one's `CanTransform` arm which `OutputFormat` it
 * answers for, keep those.
 *
 * Every failure mode names WHICH read came back empty, because "the parser broke" and "the backend
 * ships nothing" produce the same empty list and only one of them is a real finding.
 */
function readBuildableFormats(backend: string): { services: string[]; tokens: string[] } {
  const registryCs = readFileSync(join(backend, TRANSFORM_REGISTRY_REL), "utf8");
  const services = parseRegisteredTransforms(registryCs);
  expect(
    services.length,
    `${TRANSFORM_REGISTRY_REL} parsed to zero entries in OutputTransformRegistry.All. That is the ` +
      "parser failing, not the backend shipping no transforms — and an empty C# side would " +
      "'confirm' whatever this side declares. The backend refuses this state too: " +
      "OutputFormatCatalog throws at construction when the derived set is empty.",
  ).toBeGreaterThan(0);

  const tokens: string[] = [];
  for (const service of services) {
    const path = join(backend, TRANSFORM_OUTPUT_DIR, `${service}.cs`);
    expect(
      existsSync(path),
      `OutputTransformRegistry.All registers ${service}, but ${TRANSFORM_OUTPUT_DIR}/${service}.cs ` +
        "does not exist. Either the file moved and this reader has to follow it, or the registry " +
        "names a transform that is not there.",
    ).toBe(true);

    const formats = parseCanTransformFormats(readFileSync(path, "utf8"));
    expect(
      formats.length,
      `${service}.cs parsed to zero OutputFormat members in its CanTransform arm. A registered ` +
        "transform that can build nothing is either a reader that stopped matching or a real " +
        "break — and silently dropping it would understate what this build can produce.",
    ).toBeGreaterThan(0);
    tokens.push(...formats.map(formatToken));
  }
  return { services, tokens: [...new Set(tokens)] };
}

describe("the formats we advertise as output are the formats a transform exists for", () => {
  test("the parsers actually parse (so a green diff means something)", () => {
    // Runs everywhere, backend or not. A parser that quietly stopped matching would otherwise
    // "confirm" an empty registered set, and an empty set makes every claim below vacuous.
    const registry = `
      public static class OutputTransformRegistry
      {
          public static IReadOnlyList<ITransformService> All { get; } = new ITransformService[]
          {
              new XmlTransformService(),
              new CsvTransformService(),   // trailing note
              new UblOrderTransformService(),
              // new EdifactOrderTransformService(), — commented out, must NOT count
          };
          public static OutputFormatCatalog Catalog { get; } = new(All);
      }
    `;
    expect(parseRegisteredTransforms(registry)).toEqual([
      "XmlTransformService",
      "CsvTransformService",
      "UblOrderTransformService",
    ]);
    // A transform named in a comment is not a transform that ships, and treating it as one is
    // exactly the drift this block exists to prevent.
    expect(parseRegisteredTransforms(registry)).not.toContain("EdifactOrderTransformService");
    // `Catalog` is derived FROM `All` on the backend side; it must not be read as a second entry.
    expect(parseRegisteredTransforms(registry)).not.toContain("OutputFormatCatalog");
    expect(parseRegisteredTransforms("no registry here")).toEqual([]);

    // The class name is not the format. This case is the defect BE #182 documented.
    expect(
      parseCanTransformFormats(
        "public bool CanTransform(OutputFormat format) => format == OutputFormat.Ubl;",
      ),
    ).toEqual(["Ubl"]);
    expect(
      parseCanTransformFormats(`
        // CanTransform(OutputFormat format) => format == OutputFormat.EdifactOrders;
        public bool CanTransform(OutputFormat format)
        {
            return format == OutputFormat.X12 || format == OutputFormat.X12_850;
        }
      `),
    ).toEqual(["X12", "X12_850"]);
    expect(parseCanTransformFormats("no arm here")).toEqual([]);

    expect(
      parseOutputFormatMembers(`
        public enum OutputFormat
        {
            // ── Entity-based outbound transforms ──
            Xml,
            Ubl,
            UblOrder, // profile identifier, not a transform
        }
      `),
    ).toEqual(["Xml", "Ubl", "UblOrder"]);
    expect(parseOutputFormatMembers("enum SomethingElse { A }")).toEqual([]);
  });

  test("the frontend registries are themselves non-vacuous", () => {
    expect(Object.keys(BUILDABLE_FORMATS).length).toBeGreaterThan(0);
    expect(PREVIEW_FORMATS.length).toBeGreaterThan(0);
    expect(STANDARDS.length).toBeGreaterThan(0);
    expect(
      STANDARDS.filter((s) => s.transform === "supported").length,
      "no standard is marked emitted — the claim guard would pass by forbidding everything",
    ).toBeGreaterThan(0);
  });

  test.skipIf(!BACKEND)("the hosts register the transform layer from the registry, not beside it", () => {
    // The registry is only THE list while the hosts actually delegate to it. A host that went back
    // to hand-listing `AddSingleton<ITransformService, …>` would put a transform into DI that
    // `OutputTransformRegistry.Catalog` — and therefore this whole block — cannot see.
    for (const rel of [PROGRAM_REL, WORKER_PROGRAM_REL]) {
      const cs = stripCsComments(readFileSync(join(BACKEND!, rel), "utf8"));
      expect(
        cs,
        `${rel} no longer calls AddOutputTransforms(). If the transform layer is registered some ` +
          "other way now, this file's reader has to follow it — the buildable set below is derived " +
          `from ${TRANSFORM_REGISTRY_REL} and would otherwise describe a list nothing uses.`,
      ).toContain("AddOutputTransforms()");
      expect(
        [...cs.matchAll(/Add(?:Singleton|Scoped|Transient)\s*<\s*ITransformService\s*[,>]/g)],
        `${rel} hand-lists an ITransformService registration beside AddOutputTransforms(). A ` +
          "transform registered there is invisible to OutputTransformRegistry.Catalog, so the " +
          "backend's own write-path allow-list would refuse the format it can build.",
      ).toHaveLength(0);
    }
  });

  test.skipIf(!BACKEND)("exactly the OutputFormat members with a transform behind them are buildable", () => {
    const { tokens } = readBuildableFormats(BACKEND!);
    const members = parseOutputFormatMembers(readFileSync(join(BACKEND!, OUTPUT_FORMAT_ENUM_REL), "utf8"));
    expect(
      members.length,
      `${OUTPUT_FORMAT_ENUM_REL} parsed to zero OutputFormat members — the reader or the file moved.`,
    ).toBeGreaterThan(0);

    // The floor BE #182 pinned: a format-shaped enum name is not evidence a document can be built
    // for it. Asserted by NAME, so the two halves cannot swap members and still satisfy a count.
    const unbuildable = members.filter((m) => !tokens.includes(formatToken(m)));
    expect(
      sorted(unbuildable),
      "the set of OutputFormat members no transform can build has changed. These are the names " +
        "`Enum.TryParse(ignoreCase: true)` re-hydrates and no transform answers for — a config " +
        "pinned to one dies in OrderTransformService with \"No transform service registered for " +
        "format '…'\". If a transform was added for one of them, it belongs in BUILDABLE_FORMATS " +
        "and in the surfaces below; if a new profile-only name was added, add it here.",
    ).toEqual(sorted([...UNBUILDABLE_OUTPUT_FORMATS]));

    expect(
      tokens,
      "EDIFACT is inbound-only — EdifactOrderParser reads it and no ITransformService writes it. " +
        "If that changed, it is a capability this app may finally advertise; until then it must " +
        "not appear among the buildable formats.",
    ).not.toContain("edifactorders");
  });

  test.skipIf(!BACKEND)("every buildable output format is accounted for, and no other", () => {
    const { services, tokens } = readBuildableFormats(BACKEND!);
    expect(services.length, "no transforms parsed — this comparison would prove nothing").toBeGreaterThan(0);
    expect(tokens.length, "no buildable formats derived — this comparison would prove nothing").toBeGreaterThan(0);

    recordComparison(
      "buildable output formats",
      tokens,
      Object.keys(BUILDABLE_FORMATS),
      "OutputTransformRegistry.All + each transform's CanTransform derive a different set of " +
        "buildable formats than BUILDABLE_FORMATS above declares. If a transform was ADDED, add " +
        "its row here and then follow it through: src/lib/standards/catalog.ts must mark that " +
        'standard `transform: "supported"`, and PREVIEW_FORMATS in src/lib/api/types.ts must ' +
        "offer it — those two are what src/test/gatedCapabilityClaims.test.ts reads to decide " +
        "whether a surface may advertise the format. If one was REMOVED, the same three places " +
        "have to stop advertising it.",
    );
  });

  test.skipIf(!BACKEND)("the standards catalog marks emitted exactly the standards a transform produces", () => {
    const { tokens } = readBuildableFormats(BACKEND!);

    // Derived from the C# side, not from the map's own declaration: only formats a registered
    // transform really answers `CanTransform` for contribute a standard.
    const producible = tokens
      .map((token) => BUILDABLE_FORMATS[token]?.catalogId)
      .filter((id): id is string => typeof id === "string");

    const advertised = STANDARDS.filter((s) => s.transform === "supported").map((s) => s.id);

    recordComparison(
      "emitted standards",
      producible,
      advertised,
      "src/lib/standards/catalog.ts and the buildable formats disagree about which standards " +
        "ProcuLink can produce. A standard marked `transform: \"supported\"` with no transform " +
        "behind it is the EDIFACT defect exactly — every surface that derives from this catalog " +
        "starts advertising a format that dies at transform. The reverse is an under-claim: a " +
        "shipped transform nothing is allowed to mention.",
    );

    // Named explicitly, because this is the row the packet was about and a set comparison
    // reports it only as a diff line.
    expect(
      producible,
      "no registered transform produces EDIFACT — it must not appear among the emitted standards",
    ).not.toContain("edifact-orders");
  });

  test.skipIf(!BACKEND)("the output-format picker offers exactly the formats a transform produces", () => {
    const { tokens } = readBuildableFormats(BACKEND!);
    expect(tokens.length, "no buildable formats derived — this comparison would prove nothing").toBeGreaterThan(0);

    // PDF is built but binary, and the live preview renders text, so the picker does not offer it yet.
    const NOT_PREVIEWED = ["pdf"];
    recordComparison(
      "PREVIEW_FORMATS",
      tokens.filter((t) => !NOT_PREVIEWED.includes(t)),
      PREVIEW_FORMATS.map((f) => f.value),
      "PREVIEW_FORMATS in src/lib/api/types.ts is this app's mirror of the buildable formats, " +
        "and the mapper's live preview offers every one of them as a format to render. A " +
        "format offered here with no transform behind it is a preview that cannot work. The " +
        "values are OutputFormatCatalog.Token spellings: OutputFormat.ToString().ToLowerInvariant().",
    );
  });
});

/** `SftpIngestion` -> `sftpIngestion`, the key MINIMUM_PLAN mirrors that feature under. */
const featureKey = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

// ─────────────────────────────────────────────────────────────────────────────
// `PlanConstants.MinimumPlan` — the price list, diffed.
//
// WHAT WAS UNPROTECTED. `MINIMUM_PLAN` in src/lib/gatedCapabilities.ts is a hand-typed
// copy of a C# dictionary, and it is the single input to `requiresPlan()` /
// `minimumPlanName()` — every tier name in marketing and help copy is derived from it.
// It carried a comment naming the C# symbol and no check, which is the exact shape the
// header of this file was written about.
//
// Worse, the value was unpinned on BOTH sides. On the backend,
// `BillingGateEnforcementIsRealTests` proves via IL only that a gate is PRESENT and
// reaches `HasFeatureAsync` — its `Site` record carries no tier — and
// `BillingFeatureGateCoverageTests` asserts only RELATIVE shape (on at the minimum, off
// on the tier directly below, monotone above, off on Pilot), all of it derived from
// `GetMinimumPlan(feature)` and therefore moving with the value. So re-tiering
// `CustomSupplierRules` from Enterprise to Growth — giving away a €2,500/mo capability —
// left every backend billing test green and every frontend test green. Two repos, full
// suites, and nothing anywhere held the number.
//
// The backend now pins the absolute tiers itself (`PlanLadderTierTests`). This diff is
// the other half: it makes the frontend's copy answerable to the C#, so a re-tier that
// is made deliberately on one side cannot silently disagree with the other.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `MinimumPlan` rows: `[BillingFeature.BulkMapping] = Operations,`
 *   → `{ BulkMapping: "Operations" }`
 *
 * Plan names come back UNRESOLVED (the C# identifier, not `"operations"`), so a renamed
 * plan constant surfaces at the call site as an unknown identifier rather than as a
 * silently dropped row. Null when the dictionary is absent, so "found nothing" fails
 * loudly instead of diffing an empty map against an empty map.
 */
export function parseMinimumPlanRows(cs: string): Record<string, string> | null {
  // Comments are stripped first: a commented-out row is not a gate, and this file has
  // several paragraphs of prose sitting inside the dictionary body.
  const src = stripCsComments(cs);
  const start = src.search(/IReadOnlyDictionary<BillingFeature,\s*string>\s+MinimumPlan\s*=/);
  if (start < 0) return null;
  const end = src.indexOf("};", start);
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (const m of src.slice(start, end).matchAll(/\[BillingFeature\.(\w+)\]\s*=\s*(\w+)\s*,?/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("the frontend's minimum-plan table mirrors PlanConstants.MinimumPlan", () => {
  test("the row parser actually parses (so a green diff means something)", () => {
    const fixture = `
public static class PlanConstants
{
    public const string Growth      = "growth";
    public const string Enterprise  = "enterprise";

    // A commented-out row is not a gate:
    // [BillingFeature.Ghost] = Growth,
    private static readonly IReadOnlyDictionary<BillingFeature, string> MinimumPlan =
        new Dictionary<BillingFeature, string>
        {
            [BillingFeature.BulkMapping]        = Operations,
            // prose between rows
            [BillingFeature.CustomSupplierRules]= Enterprise,
        };
}`;
    expect(parseMinimumPlanRows(fixture)).toEqual({
      BulkMapping: "Operations",
      CustomSupplierRules: "Enterprise",
    });
    expect(parseStatusConstants(fixture).Growth).toBe("growth");
    // Absent dictionary answers null, not {} — the difference decides whether a missing
    // symbol reads as "the backend renamed it" or as "the backend gates nothing".
    expect(parseMinimumPlanRows("public static class PlanConstants { }")).toBeNull();
  });

  test.skipIf(!BACKEND)("every gated capability starts on the same tier in both repos", () => {
    const cs = readFileSync(join(BACKEND!, PLAN_CONSTANTS_REL), "utf8");
    const rows = parseMinimumPlanRows(cs);
    expect(
      rows,
      `${PLAN_CONSTANTS_REL} no longer declares an IReadOnlyDictionary<BillingFeature, string> ` +
        "MinimumPlan. src/lib/gatedCapabilities.ts names that symbol as its source of truth, so " +
        "the symbol moving is drift the mirror has to answer for — not a reason to pass.",
    ).not.toBeNull();

    const planValues = parseStatusConstants(cs);
    const backendPairs = Object.entries(rows!).map(([feature, planIdentifier]) => {
      const value = planValues[planIdentifier];
      if (!value) {
        throw new Error(
          `BillingFeature.${feature} is gated to the C# identifier \`${planIdentifier}\`, which is ` +
            `not a plan constant in ${PLAN_CONSTANTS_REL}. The parser or the backend moved.`,
        );
      }
      return `${featureKey(feature)}=${value}`;
    });

    recordComparison(
      "PlanConstants.MinimumPlan",
      backendPairs,
      Object.entries(MINIMUM_PLAN).map(([capability, plan]) => `${capability}=${plan}`),
      "src/lib/gatedCapabilities.ts MINIMUM_PLAN disagrees with PlanConstants.MinimumPlan. Every " +
        "tier name in marketing and help copy is derived from that table via requiresPlan(), so a " +
        "row that drifts either sells a capability below the tier that enforces it, or tells a " +
        "customer to buy a tier they do not need. Fix whichever side is wrong — a re-tier is a " +
        "commercial decision and has to be made in both repos on purpose.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `PlanConstants.Limits`, `MonthlyPriceEur` and `OveragePerOrderEur` — the ladder's
// NUMBERS, diffed.
//
// WHAT WAS UNPROTECTED. The mirror above covers which TIER a gated capability starts
// on. It says nothing about the figures beside them, and those are mirrored in two
// repos with nothing holding them together: `src/lib/plans.ts` re-types every order
// allowance, supplier allowance, monthly price and the per-order overage rate by hand,
// under a comment that says "These MUST match the backend `PlanConstants`" — a comment
// naming the symbol it mirrors, which is the shape the header of this file was written
// about.
//
// Both sides are load-bearing and neither side pins the other:
//   • `orderLimit` / `supplierLimit` are what /pricing sells, what the ROI calculator
//     computes an upgrade recommendation from, and what the upload and supplier-limit
//     banners quote back to a customer who has just been refused.
//   • `priceMonthly` is the number a buyer reads before entering a card, while the
//     amount actually charged comes from Stripe. A price raised in the backend's MRR
//     table and not here does not fail anything — it just quietly undersells.
//   • `OVERAGE_PER_ORDER_EUR` is quoted as a promise in marketing fine print, in the
//     billing FAQ and in the in-app over-cap notice; the backend meters the real charge.
//
// So this diff makes the frontend's copy answerable to the C#, in both directions: a
// plan present on one side and not the other fails too, because the comparison is over
// the row keys as well as the values.
//
// TWO SENTINELS, named rather than assumed. The backend spells "no fixed cap" as
// `int.MaxValue` and the frontend spells it `null`; both normalise to the token
// `custom` below. `MonthlyPriceEur` additionally uses `0m` for two different meanings —
// Pilot is genuinely free, Enterprise has no list price ("custom — not a fixed list
// price", its own comment) — and only the frontend distinguishes them (`0` vs `null`).
// The Enterprise carve-out is therefore conditional on the value STILL being zero: give
// Enterprise a real list price in the C# and the number is emitted and the diff fails,
// rather than being silently absorbed into "custom".
// ─────────────────────────────────────────────────────────────────────────────

/** The normalised token both repos' "no fixed number here" sentinels collapse to. */
const CUSTOM = "custom";

/**
 * Plans whose backend `MonthlyPriceEur` entry of `0m` means "contact sales, no list
 * price" rather than "free". Enterprise only — and the arm that uses this checks the
 * value is really 0 before honouring it.
 */
const BACKEND_NO_LIST_PRICE_PLANS = new Set(["enterprise"]);

/** `public const int PilotOrderLimit = 20;` → { PilotOrderLimit: 20 }. Digit separators allowed. */
export function parseIntConstants(cs: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of stripCsComments(cs).matchAll(/public\s+const\s+int\s+(\w+)\s*=\s*(-?[0-9_]+)\s*;/g)) {
    out[m[1]] = Number(m[2].replace(/_/g, ""));
  }
  return out;
}

/**
 * The `Limits` rows: `[Growth] = (150, 5),` → `{ Growth: { orders: "150", suppliers: "5" } }`.
 *
 * Operands come back UNRESOLVED — they may be a literal (`150`, `1_500`), a named int
 * constant (`PilotOrderLimit`) or the `int.MaxValue` sentinel — so the caller resolves
 * them and a renamed constant surfaces as an unknown identifier rather than as a
 * silently dropped row. Null when the dictionary is absent.
 */
export function parsePlanLimitRows(cs: string): Record<string, { orders: string; suppliers: string }> | null {
  // Comments first: `PlanConstants` carries prose INSIDE this dictionary body, including
  // a line that mentions `1_000 → 1_500`.
  const src = stripCsComments(cs);
  const start = src.search(/IReadOnlyDictionary<string,\s*\(int\s+Orders,\s*int\s+Suppliers\)>\s+Limits\s*=/);
  if (start < 0) return null;
  const end = src.indexOf("};", start);
  if (end < 0) return null;
  const out: Record<string, { orders: string; suppliers: string }> = {};
  for (const m of src.slice(start, end).matchAll(/\[(\w+)\]\s*=\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g)) {
    out[m[1]] = { orders: m[2], suppliers: m[3] };
  }
  return out;
}

/**
 * The rows of a numeric plan dictionary: `[Growth] = 149m,` → `{ Growth: 149 }`. Null when absent.
 *
 * Scoped to the named dictionary body on purpose — `PlanConstants` holds several
 * `[Plan] = value` dictionaries (AI token budgets among them) whose rows look identical.
 */
export function parseNumberRows(cs: string, valueType: string, name: string): Record<string, number> | null {
  const src = stripCsComments(cs);
  const start = src.search(new RegExp(`IReadOnlyDictionary<string,\\s*${valueType}>\\s+${name}\\s*=`));
  if (start < 0) return null;
  const end = src.indexOf("};", start);
  if (end < 0) return null;
  const out: Record<string, number> = {};
  for (const m of src.slice(start, end).matchAll(/\[(\w+)\]\s*=\s*([0-9_]+(?:\.[0-9]+)?)m?/g)) {
    out[m[1]] = Number(m[2].replace(/_/g, ""));
  }
  return out;
}

export const parseMonthlyPriceRows = (cs: string) => parseNumberRows(cs, "decimal", "MonthlyPriceEur");

/** `public const decimal OveragePerOrderEur = 0.50m;` → 0.5. Null when absent. */
export function parseDecimalConstant(cs: string, name: string): number | null {
  const m = new RegExp(`public\\s+const\\s+decimal\\s+${name}\\s*=\\s*([0-9_]*\\.?[0-9_]+)m\\s*;`).exec(
    stripCsComments(cs),
  );
  return m ? Number(m[1].replace(/_/g, "")) : null;
}

/**
 * One `Limits` operand as a comparable token: a number, or `custom` for the
 * no-fixed-cap sentinel. Throws on anything else, so an operand this parser does not
 * understand fails the run instead of comparing as a raw identifier.
 */
function resolveLimitOperand(token: string, intConstants: Record<string, number>, where: string): string {
  const t = token.trim();
  if (t === "int.MaxValue") return CUSTOM;
  if (/^-?[0-9_]+$/.test(t)) return String(Number(t.replace(/_/g, "")));
  if (t in intConstants) return String(intConstants[t]);
  throw new Error(
    `${where}: the limit operand \`${t}\` is neither a numeric literal, the int.MaxValue sentinel, ` +
      `nor a \`public const int\` in ${PLAN_CONSTANTS_REL}. The parser or the backend moved.`,
  );
}

/** A plan's frontend allowance as the same token: the number, or `custom` for null. */
const frontendAllowance = (n: number | null) => (n == null ? CUSTOM : String(n));

describe("the frontend's plan ladder mirrors the numbers in PlanConstants", () => {
  test("the limit / price / overage parsers actually parse (so a green diff means something)", () => {
    const fixture = `
public static class PlanConstants
{
    public const string Pilot      = "pilot";
    public const string Growth     = "growth";
    public const string Enterprise = "enterprise";

    public const int PilotOrderLimit    = 20;
    public const int PilotSupplierLimit = 1;

    public static readonly IReadOnlyDictionary<string, (int Orders, int Suppliers)> Limits =
        new Dictionary<string, (int, int)>
        {
            [Pilot]      = (PilotOrderLimit,  PilotSupplierLimit),
            // a comment mentioning 1_000 -> 1_500 is not a row
            [Growth]     = (1_500,            5),
            [Enterprise] = (int.MaxValue,     int.MaxValue),
        };

    // A DIFFERENT dictionary with identically-shaped rows must not be read as prices:
    public static readonly IReadOnlyDictionary<string, long> AiMonthlyTokenLimits =
        new Dictionary<string, long>
        {
            [Growth] = 1_000_000,
        };

    public static readonly IReadOnlyDictionary<string, decimal> MonthlyPriceEur =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            [Pilot]      = 0m,
            [Growth]     = 1_499m,
            [Enterprise] = 0m,   // custom — not a fixed list price
        };

    public const decimal OveragePerOrderEur = 0.50m;
}`;
    expect(parseIntConstants(fixture)).toEqual({ PilotOrderLimit: 20, PilotSupplierLimit: 1 });
    expect(parsePlanLimitRows(fixture)).toEqual({
      Pilot: { orders: "PilotOrderLimit", suppliers: "PilotSupplierLimit" },
      Growth: { orders: "1_500", suppliers: "5" },
      Enterprise: { orders: "int.MaxValue", suppliers: "int.MaxValue" },
    });
    expect(parseMonthlyPriceRows(fixture)).toEqual({ Pilot: 0, Growth: 1499, Enterprise: 0 });
    expect(parseNumberRows(fixture, "long", "AiMonthlyTokenLimits")).toEqual({ Growth: 1_000_000 });
    expect(parseDecimalConstant(fixture, "OveragePerOrderEur")).toBe(0.5);

    const ints = parseIntConstants(fixture);
    expect(resolveLimitOperand("PilotOrderLimit", ints, "fixture")).toBe("20");
    expect(resolveLimitOperand("1_500", ints, "fixture")).toBe("1500");
    expect(resolveLimitOperand("int.MaxValue", ints, "fixture")).toBe(CUSTOM);
    expect(() => resolveLimitOperand("SomeOtherCap", ints, "fixture")).toThrow(/neither a numeric literal/);

    // Absent symbols answer null, not {} / 0 — the difference decides whether a moved
    // symbol reads as drift or as "the backend charges nothing and caps nothing".
    const empty = "public static class PlanConstants { }";
    expect(parsePlanLimitRows(empty)).toBeNull();
    expect(parseMonthlyPriceRows(empty)).toBeNull();
    expect(parseDecimalConstant(empty, "OveragePerOrderEur")).toBeNull();
    expect(parseIntConstants(empty)).toEqual({});
  });

  test.skipIf(!BACKEND)("every plan's order and supplier allowance matches the C#", () => {
    const cs = readFileSync(join(BACKEND!, PLAN_CONSTANTS_REL), "utf8");
    const rows = parsePlanLimitRows(cs);
    expect(
      rows,
      `${PLAN_CONSTANTS_REL} no longer declares the IReadOnlyDictionary<string, (int Orders, int ` +
        "Suppliers)> Limits dictionary. src/lib/plans.ts names PlanConstants as the ladder it " +
        "mirrors, so the symbol moving is drift the mirror has to answer for — not a reason to pass.",
    ).not.toBeNull();

    const planValues = parseStatusConstants(cs);
    const intConstants = parseIntConstants(cs);
    const backendPairs: string[] = [];
    for (const [planIdentifier, operands] of Object.entries(rows!)) {
      const plan = planValues[planIdentifier];
      if (!plan) {
        throw new Error(
          `Limits has a row for the C# identifier \`${planIdentifier}\`, which is not a plan constant ` +
            `in ${PLAN_CONSTANTS_REL}. The parser or the backend moved.`,
        );
      }
      const where = `Limits[${planIdentifier}]`;
      backendPairs.push(`${plan} orders=${resolveLimitOperand(operands.orders, intConstants, where)}`);
      backendPairs.push(`${plan} suppliers=${resolveLimitOperand(operands.suppliers, intConstants, where)}`);
    }

    recordComparison(
      "PlanConstants.Limits",
      backendPairs,
      Object.values(PLAN_BY_ID).flatMap((p) => [
        `${p.id} orders=${frontendAllowance(p.orderLimit)}`,
        `${p.id} suppliers=${frontendAllowance(p.supplierLimit)}`,
      ]),
      "src/lib/plans.ts disagrees with PlanConstants.Limits about how much a plan includes. Those " +
        "numbers are what /pricing sells, what the ROI calculator recommends from, and what the " +
        "upload and supplier-limit banners quote back to a customer who has just been refused — so " +
        "a row that drifts either promises volume the backend will not allow, or refuses volume the " +
        "customer paid for. Fix whichever side is wrong; a re-size is a commercial decision and has " +
        "to be made in both repos on purpose.",
    );
  });

  test.skipIf(!BACKEND)("every plan's monthly list price matches the C#", () => {
    const cs = readFileSync(join(BACKEND!, PLAN_CONSTANTS_REL), "utf8");
    const rows = parseMonthlyPriceRows(cs);
    expect(
      rows,
      `${PLAN_CONSTANTS_REL} no longer declares the IReadOnlyDictionary<string, decimal> ` +
        "MonthlyPriceEur dictionary. src/lib/plans.ts mirrors those amounts, so the symbol moving " +
        "is drift the mirror has to answer for — not a reason to pass.",
    ).not.toBeNull();

    const planValues = parseStatusConstants(cs);
    const backendPairs = Object.entries(rows!).map(([planIdentifier, amount]) => {
      const plan = planValues[planIdentifier];
      if (!plan) {
        throw new Error(
          `MonthlyPriceEur has a row for the C# identifier \`${planIdentifier}\`, which is not a plan ` +
            `constant in ${PLAN_CONSTANTS_REL}. The parser or the backend moved.`,
        );
      }
      // The conditional carve-out described above: `0m` on a no-list-price plan is the
      // sentinel the frontend spells `null`. Any other amount is emitted as itself.
      const token = BACKEND_NO_LIST_PRICE_PLANS.has(plan) && amount === 0 ? CUSTOM : String(amount);
      return `${plan}=${token}`;
    });

    recordComparison(
      "PlanConstants.MonthlyPriceEur",
      backendPairs,
      Object.values(PLAN_BY_ID).map((p) => `${p.id}=${p.priceMonthly == null ? CUSTOM : String(p.priceMonthly)}`),
      "src/lib/plans.ts disagrees with PlanConstants.MonthlyPriceEur. The frontend amount is the " +
        "one a buyer reads before entering a card; the backend's is what the MRR estimate is built " +
        "from. Nothing fails when they part company — the price is simply advertised at one number " +
        "and reasoned about at another. Fix whichever side is wrong.",
    );
  });

  test.skipIf(!BACKEND)("the per-order overage rate matches the C#", () => {
    const cs = readFileSync(join(BACKEND!, PLAN_CONSTANTS_REL), "utf8");
    const overage = parseDecimalConstant(cs, "OveragePerOrderEur");
    expect(
      overage,
      `${PLAN_CONSTANTS_REL} no longer declares \`public const decimal OveragePerOrderEur\`. ` +
        "src/lib/plans.ts names that symbol as the source of OVERAGE_PER_ORDER_EUR, so the symbol " +
        "moving is drift — not a reason to pass.",
    ).not.toBeNull();

    recordComparison(
      "PlanConstants.OveragePerOrderEur",
      [`OveragePerOrderEur=${overage}`],
      [`OveragePerOrderEur=${OVERAGE_PER_ORDER_EUR}`],
      "src/lib/plans.ts OVERAGE_PER_ORDER_EUR disagrees with PlanConstants.OveragePerOrderEur. That " +
        "rate is quoted as a promise in the pricing fine print, the billing FAQ and the in-app " +
        "over-cap notice, while the backend meters the charge that actually reaches the invoice — " +
        "so a drift here is a quoted price the customer is not billed at.",
    );
  });

  // A plan with no row means "no cap" / "no overage" on both sides (the frontend spells it
  // null), so the diff is over the rows present — and a row on one side only is drift.
  test.skipIf(!BACKEND).each([
    ["FlowLimits", "int", "flowLimit"],
    ["OverageRatesEur", "decimal", "overageEur"],
  ] as const)("every plan's %s row matches the C#", (table, valueType, field) => {
    const cs = readFileSync(join(BACKEND!, PLAN_CONSTANTS_REL), "utf8");
    const rows = parseNumberRows(cs, valueType, table);
    expect(rows, `${PLAN_CONSTANTS_REL} no longer declares ${table}, which src/lib/plans.ts mirrors.`).not.toBeNull();
    const planValues = parseStatusConstants(cs);
    recordComparison(
      `PlanConstants.${table}`,
      Object.entries(rows!).map(([planIdentifier, n]) => `${planValues[planIdentifier] ?? planIdentifier}=${n}`),
      Object.values(PLAN_BY_ID)
        .filter((p) => p[field] != null)
        .map((p) => `${p.id}=${p[field]}`),
      `src/lib/plans.ts ${field} disagrees with PlanConstants.${table}. Fix whichever side is wrong.`,
    );
  });
});

// ── The vacuity floor ────────────────────────────────────────────────────────
//
// Runs after every test in the file, so it is independent of test ORDER — which a
// trailing `test()` would not be. A run that resolved a backend and then compared
// fewer things than this file declares has not verified the manifest, and saying so
// is the entire point: "the file was found but zero anchors were checked" is the exact
// shape that let 12 skipped tests read as a pass for as long as they did.

const EXPECTED_COMPARISONS =
  4 + // Transitions keys, FailureBucket, DeclaredTerminal, ResolveHeldFrom
  NAMED_GUARDS.length + // one per op guard that names a C# symbol
  1 + // the backendSite citation walk over every OP_GUARDS row
  2 + // transform causes: the per-pattern site count, and the end-to-end routing walk
  3 + // output formats: the buildable set, the standards catalog, PREVIEW_FORMATS
  1 + // MINIMUM_PLAN against PlanConstants.MinimumPlan
  5 + // the ladder's numbers: Limits, MonthlyPriceEur, OveragePerOrderEur, FlowLimits, OverageRatesEur
  1 + // document statuses
  1; // field meanings

afterAll(() => {
  if (!BACKEND) return; // the mirror gate already ruled on whether that was allowed
  if (comparisonsRun >= EXPECTED_COMPARISONS) return;
  throw new Error(
    `The backend mirror resolved a checkout at ${BACKEND} but only ran ${comparisonsRun} of ` +
      `${EXPECTED_COMPARISONS} declared comparisons. Some part of the diff did not execute, so this run ` +
      `does NOT verify src/lib/orderStatusManifest.ts against the C#. Treat it as a failure, not a pass.`,
  );
});

describe("document statuses mirror the backend", () => {
  // BE ⊆ FE, not equality: the FE PR merges first, and CI reads the BE default branch, which lacks the newest formats until its PR lands.
  test.skipIf(!BACKEND)("every backend output format has a label", () => {
    const cs = readFileSync(join(BACKEND!, "ProcuLink.Core/Documents/FlowOutputFormats.cs"), "utf8");
    const backend = Object.values(parseStatusConstants(cs));
    expect(backend.length, "FlowOutputFormats.cs parsed to no constants, so this would prove nothing").toBeGreaterThan(0);
    expect(Object.keys(FORMATS)).toEqual(expect.arrayContaining(backend));
  });

  test.skipIf(!BACKEND)("DOCUMENT_STATUSES keys equal DocumentStatus's constants", () => {
    const cs = readFileSync(join(BACKEND!, DOCUMENT_STATUS_REL), "utf8");
    const backend = Object.values(parseStatusConstants(cs));
    expect(backend).toEqual(expect.arrayContaining(Object.keys(DOCUMENT_STATUSES)));
    recordComparison(
      "DocumentStatus constants",
      backend,
      Object.keys(DOCUMENT_STATUSES),
      "The document status vocabulary drifted from DocumentStatus.cs.",
    );
  });
});

describe("field meanings mirror the backend", () => {
  test.skipIf(!BACKEND)("FIELD_MEANINGS keys equal FieldMeanings.All", () => {
    const cs = stripCsComments(readFileSync(join(BACKEND!, "ProcuLink.Core/Documents/FieldMeanings.cs"), "utf8"));
    const constants = parseStatusConstants(cs);
    const all = /All\s*=\s*\[([^\]]*)\]/.exec(cs)?.[1].match(/\w+/g) ?? [];
    expect(all.map((n) => constants[n]), "All names a constant that does not exist").not.toContain(undefined);
    recordComparison(
      "FieldMeanings.All",
      all.map((n) => constants[n]),
      Object.keys(FIELD_MEANINGS),
      "The field meaning vocabulary drifted from FieldMeanings.cs.",
    );
  });
});
