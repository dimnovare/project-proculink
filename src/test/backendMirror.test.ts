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
import {
  LOOPBACK_ONLY_SCHEMES,
  OUTBOUND_URL_ERRORS,
  SECURE_SCHEMES,
} from "@/lib/outboundUrlPolicy";
import { CATALOG_SYNC_STATUS_FACTS, CATALOG_SYNC_STATUSES } from "@/lib/catalogSyncStatusManifest";
import { PREVIEW_FORMATS } from "@/lib/api/types";
import { STANDARDS } from "@/lib/standards/catalog";
import {
  TRANSFORM_CAUSE_MATCHERS,
  TRANSFORM_CAUSE_NAMES,
  transformCauseNameFor,
  type TransformCauseName,
} from "@/components/bridge/problem/problemCopy";
import {
  APPROVABLE_INVOICE_STATUSES,
  DOWNLOADABLE_INVOICE_STATUSES,
  INVOICE_STATUSES,
  INVOICE_STATUS_FACTS,
} from "@/lib/invoiceStatusManifest";
import {
  ACTIONABLE_EXCEPTION_STATES,
  EXCEPTION_STATES,
  EXCEPTION_STATE_FACTS,
  SETTLED_EXCEPTION_STATES,
} from "@/lib/exceptionStateManifest";
// The C# string-literal reader this file introduced now has a second consumer
// (src/test/backendCopyVocabulary.test.ts), so it lives in one place rather than two.
// Its own header explains why a `grep` cannot replace it.
import { parseCsStringExpressions, stripCsComments } from "./csLiterals";
import {
  LEGACY_TEST_PACK_BACKEND_RECORDS,
  TEST_PACK_BACKEND_FILE,
  TEST_PACK_BACKEND_RECORDS,
  parseTestSummary,
} from "@/components/connections/testPackSummary";
import { MINIMUM_PLAN } from "@/lib/gatedCapabilities";

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
const URL_POLICY_REL = "ProcuLink.Core/Security/OutboundUrlPolicy.cs";
const INVOICE_SERVICE_REL = "ProcuLink.Infrastructure/Services/InvoiceService.cs";
const INVOICE_ENTITY_REL = "ProcuLink.Core/Entities/InvoiceEntity.cs";
/** Writes every value that can land in `OrderException.State` — assignments and transitions. */
const EXCEPTION_SERVICE_REL = "ProcuLink.Infrastructure/Services/OrderExceptionService.cs";
/** Declares `OrderException.State`, and names the vocabulary in its doc-comment. */
const EXCEPTION_ENTITY_REL = "ProcuLink.Core/Entities/OrderException.cs";
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
/** Declares the `TestPackSummary` record and its legs, serialized into `test_result_json`. */
const CONNECTION_SERVICE_REL = TEST_PACK_BACKEND_FILE;
/**
 * Declares `PlanConstants.MinimumPlan` — the price list, in code. Which tier a gated
 * capability starts on is a COMMERCIAL decision, and `src/lib/gatedCapabilities.ts`
 * re-types the whole table by hand so marketing and help copy can derive tier names.
 */
const PLAN_CONSTANTS_REL = "ProcuLink.Core/Constants/PlanConstants.cs";

/**
 * Every C# file this suite parses.
 *
 * A checkout that resolves but is missing one of these is DRIFT, not "no backend" —
 * the manifest cites the file by path, so the path going away is exactly the thing
 * worth failing over. It is listed here rather than left to each test because a
 * missing file used to read as `skipIf` and skip green: URL_POLICY_READABLE below
 * was computed from `existsSync`, so renaming OutboundUrlPolicy.cs would have
 * retired both of its diffs silently while the rest of the suite stayed green.
 */
const PARSED_FILES = [
  CONSTANTS_REL,
  MACHINE_REL,
  URL_POLICY_REL,
  INVOICE_SERVICE_REL,
  INVOICE_ENTITY_REL,
  EXCEPTION_SERVICE_REL,
  EXCEPTION_ENTITY_REL,
  TRANSFORM_SERVICE_REL,
  TRANSFORM_REGISTRY_REL,
  OUTPUT_FORMAT_ENUM_REL,
  PROGRAM_REL,
  WORKER_PROGRAM_REL,
  CONNECTION_SERVICE_REL,
  PLAN_CONSTANTS_REL,
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
 * `assignSupplier` is excluded and says so in the manifest: the backend still writes
 * that guard as a bare literal inside the atomic claim rather than as a named set, so
 * there is no symbol to read. It is the one row this diff cannot cover, and naming that
 * is better than pretending otherwise.
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

/**
 * A `new[] { "a", "b" }` initialiser for a named readonly string list:
 *
 *   public static readonly IReadOnlyList<string> SecureSchemes = new[] { "https" };
 *
 * Returns the literals. Null when the symbol is absent, so "found nothing" fails loudly at the
 * call site rather than diffing an empty list against an empty list.
 */
export function parseStringLiteralList(cs: string, name: string): string[] | null {
  const re = new RegExp(
    `IReadOnlyList<string>\\s+${name}\\s*=\\s*new\\[\\]\\s*\\{([^}]*)\\}\\s*;`,
    "s",
  );
  const m = re.exec(cs);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
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
      missing: [URL_POLICY_REL],
      required: false,
    });
    expect(failure).not.toBeNull();
    expect(failure).toContain(URL_POLICY_REL);
  });

  test("a complete backend passes, required or not", () => {
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", ...complete, required: true })).toBeNull();
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", ...complete, required: false })).toBeNull();
  });

  test("missingParsedFiles reports every file the checkout lacks", () => {
    const present = new Set([join("/tmp/backend", CONSTANTS_REL)]);
    expect(missingParsedFiles("/tmp/backend", (p) => present.has(p))).toEqual([
      MACHINE_REL,
      URL_POLICY_REL,
      INVOICE_SERVICE_REL,
      INVOICE_ENTITY_REL,
      EXCEPTION_SERVICE_REL,
      EXCEPTION_ENTITY_REL,
      TRANSFORM_SERVICE_REL,
      TRANSFORM_REGISTRY_REL,
      OUTPUT_FORMAT_ENUM_REL,
      PROGRAM_REL,
      WORKER_PROGRAM_REL,
      CONNECTION_SERVICE_REL,
      PLAN_CONSTANTS_REL,
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
    expect(NAMED_GUARDS.length).toBe(5);
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

// ─────────────────────────────────────────────────────────────────────────────
// The outbound-URL transport policy mirror.
//
// `src/lib/outboundUrlPolicy.ts` is a hand-kept copy of
// `ProcuLink.Core/Security/OutboundUrlPolicy.cs`. The frontend copy only decides what an
// operator is told before they submit; the backend refuses independently. But if the two
// disagree about which schemes are allowed, the UI either blocks a save the API would have
// accepted or — the direction that matters — waves through a cleartext endpoint and lets the
// operator believe it was fine until the 400 arrives.
//
// Same honesty rules as the status mirror above: the parser is exercised against an inline
// fixture on every run, and the diff is skipped by a DECLARED condition when no backend
// checkout is reachable, never silently passed.
//
// The skip condition is `!BACKEND` and NOT `existsSync(OutboundUrlPolicy.cs)`, which is what
// it used to be. Keying a skip on the presence of the very file under test means that
// renaming or moving that file retires its own guard — the two diffs below would have gone
// quiet and the suite stayed green, which is the same shape as the CI gap this file's header
// describes, one directory down. A resolved backend that is missing this file now fails the
// mirror gate (see PARSED_FILES).
// ─────────────────────────────────────────────────────────────────────────────

const URL_POLICY_PATH = BACKEND ? join(BACKEND, URL_POLICY_REL) : null;

describe("outbound URL policy mirrors the backend", () => {
  test("the string-list parser actually parses (so a green diff means something)", () => {
    const fixture = `
namespace ProcuLink.Core.Security;
public static class OutboundUrlPolicy
{
    public const string ErrorUrlRequired = "url_required";
    public const string ErrorInsecureTransport = "url_requires_tls";
    public static readonly IReadOnlyList<string> SecureSchemes = new[] { "https" };
    public static readonly IReadOnlyList<string> LoopbackOnlySchemes = new[] { "http" };
}`;

    expect(parseStringLiteralList(fixture, "SecureSchemes")).toEqual(["https"]);
    expect(parseStringLiteralList(fixture, "LoopbackOnlySchemes")).toEqual(["http"]);
    expect(parseStringLiteralList(fixture, "NoSuchSymbol")).toBeNull();

    const constants = parseStatusConstants(fixture);
    expect(constants.ErrorUrlRequired).toBe("url_required");
    expect(constants.ErrorInsecureTransport).toBe("url_requires_tls");
  });

  test("the frontend copy is itself non-vacuous", () => {
    // Guards the diff below: two empty lists compare equal, so an accidentally emptied
    // frontend constant would otherwise "mirror" a backend that lists https.
    expect(SECURE_SCHEMES.length).toBeGreaterThan(0);
    expect(LOOPBACK_ONLY_SCHEMES.length).toBeGreaterThan(0);
    expect(Object.keys(OUTBOUND_URL_ERRORS).length).toBeGreaterThan(0);
  });

  test.skipIf(!BACKEND)("the scheme sets are identical", () => {
    const cs = readFileSync(URL_POLICY_PATH!, "utf8");

    const secure = parseStringLiteralList(cs, "SecureSchemes");
    const loopbackOnly = parseStringLiteralList(cs, "LoopbackOnlySchemes");

    expect(secure, "OutboundUrlPolicy.cs declares no SecureSchemes — the parser or the backend moved")
      .not.toBeNull();
    expect(
      loopbackOnly,
      "OutboundUrlPolicy.cs declares no LoopbackOnlySchemes — the parser or the backend moved",
    ).not.toBeNull();

    recordComparison(
      "OutboundUrlPolicy.SecureSchemes",
      secure!,
      SECURE_SCHEMES,
      "SECURE_SCHEMES drifted. A scheme the UI thinks is safe but the API refuses blocks a save; the reverse lets a cleartext endpoint through the form.",
    );
    recordComparison(
      "OutboundUrlPolicy.LoopbackOnlySchemes",
      loopbackOnly!,
      LOOPBACK_ONLY_SCHEMES,
      "LOOPBACK_ONLY_SCHEMES drifted from the schemes the backend only accepts on loopback.",
    );
  });

  test.skipIf(!BACKEND)("every error code the UI branches on still exists in the C#", () => {
    const constants = parseStatusConstants(readFileSync(URL_POLICY_PATH!, "utf8"));
    const backendCodes = Object.entries(constants)
      .filter(([name]) => name.startsWith("Error"))
      .map(([, value]) => value);

    expect(backendCodes.length, "OutboundUrlPolicy.cs declares no Error* constants").toBeGreaterThan(0);
    const uiCodes = Object.entries(OUTBOUND_URL_ERRORS);
    expect(uiCodes.length, "OUTBOUND_URL_ERRORS is empty, so this walk would check nothing").toBeGreaterThan(0);

    for (const [key, code] of uiCodes) {
      expect(
        backendCodes,
        `OUTBOUND_URL_ERRORS.${key} is "${code}", which the backend no longer emits. The UI would stop recognising that refusal and fall back to a raw 400 body.`,
      ).toContain(code);
    }
    comparisonsRun += 1;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The catalog sync-status mirror.
//
// `src/lib/catalogSyncStatusManifest.ts` is a hand-kept copy of the values the backend
// writes into `SupplierCatalogSource.LastSyncStatus`. It exists because the frontend's
// `CatalogSyncStatus` union is a compile-time claim about a raw JSON string, and
// `formatLastSync` had folded its unknown arm into its success arm — so a value the
// backend added or renamed rendered as a green dot over "Last synced 3m ago".
//
// THIS DIFF IS SHAPED DIFFERENTLY FROM THE TWO ABOVE, and the reason is the second
// finding of that review: the backend names NO SET for these values. No constants class,
// no enum, no `IReadOnlySet` — four bare string literals at four assignment sites plus a
// doc-comment on the entity. There is no symbol to read, so there is nothing a
// `parseNamedSet` call could point at. A fifth literal can be introduced by one line in
// one new file and no rename in either repo would mention it.
//
// So this walks the backend's production source and collects every `LastSyncStatus = "…"`
// it finds, rather than reading one declaration. Consequences, stated rather than hidden:
//
//   • It scans DOC COMMENTS too, deliberately. A comment that names a status is the
//     backend declaring that status, and prose there going stale is itself worth a
//     failure — this diff only ever runs against a local checkout, never in the
//     frontend's CI, so the cost of that strictness is a developer reading one line.
//   • It cannot see a status produced by concatenation or returned into the property from
//     a helper. Nothing does that today; if something starts, this check would report the
//     manifest as complete while it is not. That limit is why the RENDER side fails safe
//     independently: an unrecognised status resolves to a non-success tone in
//     `formatLastSync` whether or not this test ever noticed it.
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG_ENTITY_REL = "ProcuLink.Core/Entities/SupplierCatalogSource.cs";

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

describe("catalog sync statuses mirror the backend", () => {
  test("the assignment parser actually parses (so a green diff means something)", () => {
    const fixture = [
      "public class Job",
      "{",
      '    /// <summary><c>LastSyncStatus = "running"</c> and saves.</summary>',
      "    public void Run()",
      "    {",
      '        source.LastSyncStatus = "running";',
      '        if (source.LastSyncStatus == "ok") return;',
      '        if (source.LastSyncStatus is "ok" or "unchanged") return;',
      '        source.LastSyncStatus  =  "failed";',
      '        source.LastFileHash = "not a status";',
      "    }",
      "}",
    ].join("\n");

    // The doc-comment assignment and the two real ones — and neither the `==` comparison
    // nor the `is` pattern, which is what stops a READER from widening the vocabulary
    // this table claims a WRITER can produce.
    expect(parseAssignedStatusLiterals(fixture, "LastSyncStatus")).toEqual([
      "running",
      "running",
      "failed",
    ]);
    expect(parseAssignedStatusLiterals(fixture, "NoSuchProperty")).toEqual([]);
  });

  test("the frontend copy is itself non-vacuous", () => {
    // Guards the diff below: two empty sets compare equal, so an accidentally emptied
    // manifest would otherwise "mirror" a backend that writes four statuses.
    expect(CATALOG_SYNC_STATUSES.length).toBe(4);
    expect(sorted(CATALOG_SYNC_STATUSES)).toEqual(["failed", "ok", "running", "unchanged"]);
    for (const fact of CATALOG_SYNC_STATUS_FACTS) {
      expect(fact.backendSite, `${fact.status} cites no backend site`).toMatch(
        /^ProcuLink\.[\w.]+\/[\w./]+\.cs:\d+$/,
      );
      expect(fact.note.length, `${fact.status} has no note`).toBeGreaterThan(20);
    }
  });

  test.skipIf(!BACKEND)("the walk finds the production tree it claims to scan", () => {
    const files = collectCsFiles(BACKEND!, BACKEND_PRODUCTION_PROJECTS);
    expect(files.length, "walked the backend and found almost no C# — the project layout moved").toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("CatalogPullService.cs"))).toBe(true);
    expect(files.some((f) => f.endsWith("CatalogSyncSourceJob.cs"))).toBe(true);
    expect(files.some((f) => f.includes("Migrations")), "migrations leaked into the walk").toBe(false);
  });

  test.skipIf(!BACKEND)("every status the backend writes is in the manifest, and vice versa", () => {
    const written = new Set<string>();
    for (const file of collectCsFiles(BACKEND!, BACKEND_PRODUCTION_PROJECTS)) {
      for (const value of parseAssignedStatusLiterals(readFileSync(file, "utf8"), "LastSyncStatus")) {
        written.add(value);
      }
    }

    expect(
      written.size,
      "found no LastSyncStatus assignment at all — the parser or the backend moved",
    ).toBeGreaterThanOrEqual(4);
    expect(
      sorted([...written]),
      "the catalog sync vocabulary drifted. A status the backend writes and this manifest does not " +
        "know renders as the unrecognised line instead of its own; the reverse means this table " +
        "documents a state nothing can produce.",
    ).toEqual(sorted(CATALOG_SYNC_STATUSES));
  });

  test.skipIf(!BACKEND)("the entity still declares the statuses this manifest mirrors", () => {
    // The line number in each `backendSite` is documentation and will rot; that the
    // entity still exists and still names these four in its own doc-comment must not.
    const path = join(BACKEND!, CATALOG_ENTITY_REL);
    expect(existsSync(path), `${CATALOG_ENTITY_REL} does not exist — the entity moved`).toBe(true);
    const cs = readFileSync(path, "utf8");
    expect(cs).toContain("LastSyncStatus");
    for (const status of CATALOG_SYNC_STATUSES) {
      expect(cs, `the entity's own doc-comment no longer names '${status}'`).toContain(`'${status}'`);
    }
  });

  test.skipIf(!BACKEND)("each fact's cited file exists and still writes that status", () => {
    for (const fact of CATALOG_SYNC_STATUS_FACTS) {
      const [file] = fact.backendSite.split(":");
      const path = join(BACKEND!, file);
      expect(existsSync(path), `${fact.status} cites ${file}, which does not exist`).toBe(true);
      expect(
        parseAssignedStatusLiterals(readFileSync(path, "utf8"), "LastSyncStatus"),
        `${fact.status} cites ${file}, which no longer writes it`,
      ).toContain(fact.status);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The invoice status mirror.
//
// `src/lib/invoiceStatusManifest.ts` is a hand-kept copy of the values the backend writes
// into `InvoiceEntity.Status`. It exists because /inbound/invoices had no manifest at all
// and gated on the literal `"pending"` in three places — the row dot, the Approve button
// and the "Pending review" tile — while every parsed invoice is `"pending_review"`. The
// counter read 0 beside N rows and the screen's only real action never rendered once.
//
// SHAPED LIKE THE CATALOG DIFF ABOVE, and for the same reason: the backend names NO SET
// for these values. No constants class, no enum, no `IReadOnlySet` — five bare literals
// at five assignment sites in one service, plus a doc-comment on the entity listing them
// in prose. There is no symbol for `parseNamedSet` to point at.
//
// It is NARROWER than the catalog walk in one deliberate way: it scans a single named
// file rather than the whole tree. `LastSyncStatus` is a unique property name, so a
// tree-wide sweep for it collects only catalog statuses; `Status` is not — orders, ASNs
// and invoices all have one, and a tree-wide sweep would fold three vocabularies into
// one. Every invoice-status writer in the backend lives in InvoiceService.cs (verified at
// the commit in the manifest header), so the file IS the boundary. The cost is stated
// rather than hidden: a writer added in some other file would not be seen here. The
// RENDER side fails safe independently — an unrecognised status offers no action and
// lands in its own summary tile (see invoiceStatusGate.test.tsx), so a missed writer
// shows up as a visible "Unrecognised" count rather than as a wrong green reading.
// ─────────────────────────────────────────────────────────────────────────────

describe("invoice statuses mirror the backend", () => {
  test("the assignment parser is not fooled by the comparison in this very file", () => {
    // InvoiceService.ForwardAsync guards with `inv.Status != "approved"`. A parser that
    // collected that would report `approved` as a WRITER of a status it only reads —
    // harmless here by luck (approved is written elsewhere too), and exactly the way a
    // reader-widened vocabulary stops being a claim about what can reach a screen.
    const fixture = [
      'var inv = new InvoiceEntity { Status = "parsing" };',
      '        inv.Status        = "pending_review";',
      '        if (inv.Status != "approved") throw new InvalidOperationException("nope");',
      '        if (inv.Status == "forwarded") return;',
      '        inv.SourceFileName = "not a status";',
    ].join("\n");

    expect(parseAssignedStatusLiterals(fixture, "Status")).toEqual(["parsing", "pending_review"]);
  });

  test("the frontend copy is itself non-vacuous", () => {
    // Guards the diff below: two empty lists compare equal, so an emptied manifest would
    // otherwise "mirror" a backend that writes five statuses.
    expect(INVOICE_STATUSES.length).toBe(5);
    expect(APPROVABLE_INVOICE_STATUSES.length).toBeGreaterThan(0);
    expect(DOWNLOADABLE_INVOICE_STATUSES.length).toBeGreaterThan(0);
    for (const fact of INVOICE_STATUS_FACTS) {
      expect(fact.backendSite, `${fact.status} cites no backend site`).toMatch(
        /^ProcuLink\.[\w.]+\/[\w./]+\.cs:\d+$/,
      );
      expect(fact.note.length, `${fact.status} has no note`).toBeGreaterThan(20);
    }
  });

  test.skipIf(!BACKEND)("every status the invoice service writes is in the manifest, and vice versa", () => {
    const cs = readFileSync(join(BACKEND!, INVOICE_SERVICE_REL), "utf8");
    const written = [...new Set(parseAssignedStatusLiterals(cs, "Status"))];
    expect(
      written.length,
      "found no Status assignment in InvoiceService.cs — the parser or the backend moved",
    ).toBeGreaterThanOrEqual(5);
    recordComparison(
      "InvoiceEntity.Status writers",
      written,
      INVOICE_STATUSES,
      "The invoice status vocabulary drifted. A status the backend writes and this manifest does not " +
        "know renders as 'Unrecognised' and offers no action; the reverse means the summary row carries " +
        "a tile that can only ever read 0 — which is the bug this manifest was written to end.",
    );
  });

  test.skipIf(!BACKEND)("the entity still declares the vocabulary this manifest mirrors", () => {
    const cs = readFileSync(join(BACKEND!, INVOICE_ENTITY_REL), "utf8");
    for (const status of INVOICE_STATUSES) {
      expect(cs, `InvoiceEntity's own doc-comment no longer names '${status}'`).toContain(status);
    }
  });

  test.skipIf(!BACKEND)("each fact's cited file exists and still writes that status", () => {
    for (const fact of INVOICE_STATUS_FACTS) {
      const [file] = fact.backendSite.split(":");
      const path = join(BACKEND!, file);
      expect(existsSync(path), `${fact.status} cites ${file}, which does not exist`).toBe(true);
      expect(
        parseAssignedStatusLiterals(readFileSync(path, "utf8"), "Status"),
        `${fact.status} cites ${file}, which no longer writes it`,
      ).toContain(fact.status);
    }
    comparisonsRun += 1;
  });

  test.skipIf(!BACKEND)("the export guard the manifest calls `downloadable` is still that guard", () => {
    // `downloadable` is not a product choice — it is ForwardAsync's refusal, verbatim.
    // If the backend widens or renames it, the CSV button starts being offered where the
    // API answers 400 (or withheld where it would have worked), and the manifest's claim
    // that this column mirrors a guard becomes prose again.
    const cs = readFileSync(join(BACKEND!, INVOICE_SERVICE_REL), "utf8");
    expect(DOWNLOADABLE_INVOICE_STATUSES).toEqual(["approved"]);
    expect(
      cs.replace(/\s+/g, " "),
      "InvoiceService no longer guards the export with `Status != \"approved\"` — DOWNLOADABLE_INVOICE_STATUSES " +
        "is now a claim about a guard that moved.",
    ).toContain('Status != "approved"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The exception-STATE mirror.
//
// `src/lib/exceptionStateManifest.ts` decides whether a row on /operations/exceptions
// reads as handled and whether it keeps its controls. Before it existed the page decided
// that with `exc.state === "open" ? … : …`, so a state the frontend had never heard of
// took the else — the SETTLED branch — and a live exception rendered as already dealt
// with, with Resolve, Open order and Ignore all gone.
//
// WHY THIS NEEDS ITS OWN PARSER, and could not reuse the invoice one. The backend names
// no set here either — `OrderException.State` is a bare `string` column with a
// doc-comment listing the vocabulary in prose — but the three values do not all arrive
// the same way:
//
//   OrderExceptionService.cs:117   ex.State = "resolved";                  assignment
//   OrderExceptionService.cs:143   State    = "open",                      assignment
//   OrderExceptionService.cs:167   SetStateAsync(orgId, id, "resolved", ct)  call argument
//   OrderExceptionService.cs:170   SetStateAsync(orgId, id, "ignored",  ct)  call argument
//
// `ignored` is NEVER the right-hand side of an assignment anywhere in the backend. An
// assignment-only reader parses this service to {open, resolved} and would report a
// correct manifest as drift — a guard that fails on the truth is worse than none, because
// the fix is to delete the guard. So the reader below unions both forms, and the fixture
// test proves each half contributes before any diff is trusted.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every string literal passed as an argument to a `SetStateAsync(...)` call.
 *
 * Comments are stripped first: the service's own header comment discusses `open` and
 * `ignored` in prose, and a reader that collected commented-out code would report a
 * transition that has been REMOVED as still present, which is the drift this exists to
 * catch rather than a way to catch it.
 */
export function parseSetStateCallLiterals(cs: string): string[] {
  const out: string[] = [];
  for (const call of stripCsComments(cs).matchAll(/SetStateAsync\s*\(([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/"([^"]*)"/g)) out.push(literal[1]);
  }
  return out;
}

/**
 * Every value the backend can put in `OrderException.State`: assignments ∪ transition
 * arguments, de-duplicated.
 *
 * READERS are deliberately excluded, which `parseAssignedStatusLiterals` gives for free by
 * matching `=` and not `==`. `DataRetentionService.cs:103` and `OpsHealthService.cs:65`
 * compare against these strings, and a reader can only ever narrow what a writer produces
 * — widening the vocabulary from a comparison would let a state nothing writes claim a
 * row in the manifest, and a manifest entry no writer can produce is a filter tab that
 * can only ever be empty.
 */
export function parseExceptionStateWriters(cs: string): string[] {
  const stripped = stripCsComments(cs);
  return [
    ...new Set([
      ...parseAssignedStatusLiterals(stripped, "State"),
      ...parseSetStateCallLiterals(stripped),
    ]),
  ];
}

describe("exception states mirror the backend", () => {
  test("the writer reader actually reads (so a green diff means something)", () => {
    const fixture = [
      "public class Svc",
      "{",
      '    // SetStateAsync(orgId, id, "commented_out", ct);   ← retired, must not count',
      "    public Task<bool> ResolveAsync(Guid orgId, Guid id, CancellationToken ct)",
      '        => SetStateAsync(orgId, id, "resolved", ct);',
      "    public Task<bool> IgnoreAsync(Guid orgId, Guid id, CancellationToken ct)",
      '        => SetStateAsync(orgId, id, "ignored", ct);',
      "    private async Task<bool> SetStateAsync(Guid orgId, Guid id, string state, CancellationToken ct)",
      "    {",
      '        ex.State = "resolved";',
      '        var row = new OrderException { State = "open" };',
      '        if (ex.State == "escalated") return false;',
      "    }",
      "}",
    ].join("\n");

    // The two real calls, and neither the commented-out one nor the parameter list of the
    // declaration (which carries no literal).
    expect(parseSetStateCallLiterals(fixture)).toEqual(["resolved", "ignored"]);

    // Both halves contribute, and the `==` comparison does NOT: `escalated` is read by
    // this fixture and written by nothing, so a union that contained it would be treating
    // a reader as a writer.
    expect(parseExceptionStateWriters(fixture).sort()).toEqual(["ignored", "open", "resolved"]);
    expect(parseExceptionStateWriters(fixture)).not.toContain("escalated");
    expect(parseExceptionStateWriters(fixture)).not.toContain("commented_out");

    // And an assignment-only read really is insufficient — the reason this parser exists.
    expect(parseAssignedStatusLiterals(stripCsComments(fixture), "State")).not.toContain("ignored");
  });

  test("the frontend copy is itself non-vacuous", () => {
    // Guards the diff below: two empty lists compare equal, so an emptied manifest would
    // otherwise "mirror" a backend that writes three states.
    expect(EXCEPTION_STATES.length).toBe(3);
    expect(ACTIONABLE_EXCEPTION_STATES.length).toBeGreaterThan(0);
    expect(SETTLED_EXCEPTION_STATES.length).toBeGreaterThan(0);
    expect(
      [...ACTIONABLE_EXCEPTION_STATES, ...SETTLED_EXCEPTION_STATES].sort(),
      "the kinds no longer partition the vocabulary",
    ).toEqual([...EXCEPTION_STATES].sort());
    for (const fact of EXCEPTION_STATE_FACTS) {
      expect(fact.backendSite, `${fact.state} cites no backend site`).toMatch(
        /^ProcuLink\.[\w.]+\/[\w./]+\.cs:\d+$/,
      );
      expect(fact.note.length, `${fact.state} has no note`).toBeGreaterThan(20);
    }
  });

  test.skipIf(!BACKEND)("every state the exception service writes is in the manifest, and vice versa", () => {
    const cs = readFileSync(join(BACKEND!, EXCEPTION_SERVICE_REL), "utf8");
    const written = parseExceptionStateWriters(cs);
    expect(
      written.length,
      "found no State writer in OrderExceptionService.cs — the parser or the backend moved",
    ).toBeGreaterThanOrEqual(3);
    recordComparison(
      "OrderException.State writers",
      written,
      EXCEPTION_STATES,
      "The exception state vocabulary drifted. A state the backend writes and this manifest does not " +
        "know renders as 'Unrecognised state' — safe, but it means a real exception is being shown to " +
        "an operator the UI cannot describe. The reverse is worse: a filter tab that can only ever be " +
        "empty. Either way the manifest, not the page, is the thing to fix.",
    );
  });

  test.skipIf(!BACKEND)("the entity still declares the vocabulary this manifest mirrors", () => {
    const cs = readFileSync(join(BACKEND!, EXCEPTION_ENTITY_REL), "utf8");
    for (const state of EXCEPTION_STATES) {
      expect(cs, `OrderException's own doc-comment no longer names '${state}'`).toContain(state);
    }
  });

  test.skipIf(!BACKEND)("each fact's cited file exists and still writes that state", () => {
    for (const fact of EXCEPTION_STATE_FACTS) {
      const [file] = fact.backendSite.split(":");
      const path = join(BACKEND!, file);
      expect(existsSync(path), `${fact.state} cites ${file}, which does not exist`).toBe(true);
      expect(
        parseExceptionStateWriters(readFileSync(path, "utf8")),
        `${fact.state} cites ${file}, which no longer writes it`,
      ).toContain(fact.state);
    }
    comparisonsRun += 1;
  });

  test.skipIf(!BACKEND)("the actions this screen offers still have no prior-state guard", () => {
    // The manifest keeps Resolve / Ignore on a row it cannot place, and justifies that by
    // the backend accepting them from ANY state: both funnel into SetStateAsync, which
    // loads by id and org and writes unconditionally. If a status guard ever appears
    // there, offering those controls on an unplaceable row starts handing the operator a
    // button that 4xxs, and this manifest's reasoning has to be revisited.
    const cs = readFileSync(join(BACKEND!, EXCEPTION_SERVICE_REL), "utf8");
    const body = stripCsComments(cs).replace(/\s+/g, " ");
    const setState = body.slice(body.indexOf("private async Task<bool> SetStateAsync"));
    expect(setState.length, "SetStateAsync is gone — the transition moved").toBeGreaterThan(0);
    expect(
      setState.slice(0, 400),
      "SetStateAsync grew a prior-state check — the exception manifest offers its actions " +
        "unconditionally on the strength of it not having one.",
    ).not.toMatch(/State\s*[!=]=\s*"/);
    comparisonsRun += 1;
  });
});

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

    recordComparison(
      "PREVIEW_FORMATS",
      tokens,
      PREVIEW_FORMATS.map((f) => f.value),
      "PREVIEW_FORMATS in src/lib/api/types.ts is this app's mirror of the buildable formats, " +
        "and outputTreeProblems.ts derives `isEmittedFormat` from it — which is what decides " +
        "whether the output designer tells an author \"ProcuLink builds {format} itself\". A " +
        "format offered here with no transform behind it gets that promise made about it. The " +
        "values are OutputFormatCatalog.Token spellings: OutputFormat.ToString().ToLowerInvariant().",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The connection test-pack summary — the shape stored in `test_result_json`.
//
// THE DEFECT THIS EXISTS FOR. `SupplierConnectionService` grew a fourth field,
// `ParseLegSummary? ParseLeg`, and the frontend's two hand-written copies of the
// shape never did. The reader was `JSON.parse(json) as TestPackSummary`, and that
// cast is what hid it: the leg really did arrive on every response, but the value
// had been asserted into a three-field type, so `summary.parseLeg` was a compile
// error and every consumer downstream was type-checked into ignoring it. Because
// `passed` is `replayPassed && conformance… && parsePassed`, a pack that failed only
// on the parse leg turned the evidence panel red and explained nothing — the one
// sentence naming the cause was `parseLeg.note`, and nothing was allowed to read it.
//
// No check running in a browser can catch that: an unknown key and an absent key are
// indistinguishable there. What catches it is this diff — the C# record's parameter
// list against the field list `testPackSummary.ts` exports. The NEXT leg the backend
// adds fails the build here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The parameter NAMES of a C# positional record, camelCased the way
 * `JsonNamingPolicy.CamelCase` writes them (SupplierConnectionService.cs:36).
 *
 * Returns null when the record is not declared — never an empty list, so "the parser
 * went blind" cannot be mistaken for "the record has no parameters" by a comparison
 * that would then find two empty lists equal.
 *
 * Deliberately narrow: it handles `Type Name`, `Type? Name` and `Type? Name = null`,
 * which is every parameter these four records have. A generic parameter containing a
 * comma would defeat the split, and the assertion in the fixture test below is what
 * would notice.
 */
function parseRecordParameterNames(cs: string, recordName: string): string[] | null {
  const declaration = new RegExp(String.raw`record\s+${recordName}\s*\(([^)]*)\)`).exec(
    stripCsComments(cs),
  );
  if (declaration === null) return null;
  return declaration[1]
    .split(",")
    .map((param) => param.split("=")[0].trim())
    .filter((param) => param.length > 0)
    .map((param) => {
      const name = param.split(/\s+/).pop() ?? "";
      // CamelCase policy lowercases the leading capital. Every parameter in these
      // records is ordinary PascalCase, so this is the whole of the transformation.
      return name.charAt(0).toLowerCase() + name.slice(1);
    });
}

/**
 * The keys `parseTestSummary` really produces — derived by RUNNING it over a payload
 * carrying both wire shapes at once, never typed out. A hand-written list here would be
 * a third copy of the contract, which is the shape of every defect this file guards.
 */
const READER_KEYS = (() => {
  const summary = parseTestSummary(
    JSON.stringify({
      outcome: "passed",
      replay: { outcome: "passed", passed: true, orderCount: 0, outputErrors: 0, outputChanged: 0, validationChanged: 0, note: null },
      conformance: { outcome: "passed", passed: true, skipped: false, profile: null, errors: 0, warnings: 0, note: null },
      error: null,
      parseLeg: { outcome: "passed", passed: true, ordersReParsed: 0, parseChanges: 0, failures: 0, skipped: 0, note: null },
    }),
  )!;
  return {
    TestPackSummary: Object.keys(summary),
    ReplayLeg: Object.keys(summary.replay!),
    ConformanceLeg: Object.keys(summary.conformance!),
    ParseLegSummary: Object.keys(summary.parseLeg!),
  };
})();

/**
 * The reader key a C# record parameter lands in.
 *
 * Identity except for the two pre-PR-207 booleans, which are read into `legacy*` fields
 * so they are visible and refusable rather than trusted. SCAFFOLDING — delete these two
 * arms with the rest of the compatibility block in testPackSummary.ts.
 *
 * `ParseLegSummary.Skipped` is NOT one of them: it is a COUNT of orders and always was,
 * which is exactly why the mapping is keyed by record and not by field name alone.
 */
function readerKeyFor(recordName: string, field: string): string {
  if (field === "passed") return "legacyPassed";
  if (field === "skipped" && recordName === "ConformanceLeg") return "legacySkipped";
  return field;
}

describe("the connection test-pack summary mirrors the backend record", () => {
  test("the record parser actually parses (so a green diff means something)", () => {
    // The real declarations at SupplierConnectionService.cs:618-623 (BE PR 207), verbatim —
    // including the defaulted parameter that was the original defect, and the multi-line
    // declaration, which a parser that stopped at a newline would silently miss.
    const fixture = `
    /// <summary>Serializable summary stored in <c>test_result_json</c> (camelCase).</summary>
    private sealed record TestPackSummary(
        string Outcome, ReplayLeg? Replay, ConformanceLeg? Conformance, string? Error, ParseLegSummary? ParseLeg = null);
    private sealed record ConformanceLeg(string Outcome, string? Profile, int Errors, int Warnings, string? Note);
    private sealed record ParseLegSummary(string Outcome, int OrdersReParsed, int ParseChanges, int Failures, int Skipped, string? Note);`;

    expect(parseRecordParameterNames(fixture, "TestPackSummary")).toEqual([
      "outcome",
      "replay",
      "conformance",
      "error",
      "parseLeg",
    ]);
    expect(parseRecordParameterNames(fixture, "ConformanceLeg")).toEqual([
      "outcome",
      "profile",
      "errors",
      "warnings",
      "note",
    ]);
    expect(parseRecordParameterNames(fixture, "ParseLegSummary")).toEqual([
      "outcome",
      "ordersReParsed",
      "parseChanges",
      "failures",
      "skipped",
      "note",
    ]);
    expect(parseRecordParameterNames(fixture, "NoSuchRecord")).toBeNull();
  });

  test("the parser sees the field whose absence made every leg's verdict unreadable", () => {
    // BE PR 207. Each leg carried `bool Passed`, and every "there was nothing to run this
    // on" path set it to true — so an un-run leg and a satisfied one were the same value,
    // and a run that exercised NOTHING reported a pass. The `outcome` string is what tells
    // them apart; a frontend that does not name it drops it at the JSON boundary exactly
    // as `parseLeg` was dropped, and falls straight back to the two-valued reading.
    for (const [record, fields] of Object.entries(TEST_PACK_BACKEND_RECORDS)) {
      expect(fields, `${record} does not mirror the outcome field`).toContain("outcome");
      expect(fields, `${record} still mirrors the boolean that could not tell un-run from clean`)
        .not.toContain("passed");
    }
    expect(TEST_PACK_BACKEND_RECORDS.ConformanceLeg).not.toContain("skipped");
  });

  test("the parser sees the field whose absence was the defect", () => {
    // The frontend shape as it shipped: three fields, no parse leg. Pinned so a later
    // reader can see that this diff would have failed on the code that was there, and
    // so a matcher change that stopped distinguishing the two is caught.
    const asShipped = ["replay", "conformance", "error"];
    expect(TEST_PACK_BACKEND_RECORDS.TestPackSummary).not.toEqual(asShipped);
    expect(TEST_PACK_BACKEND_RECORDS.TestPackSummary).toContain("parseLeg");
  });

  test("the frontend field lists are themselves non-vacuous", () => {
    const records = Object.entries(TEST_PACK_BACKEND_RECORDS);
    expect(records.length, "no record is mirrored, so the diff below checks nothing").toBe(4);
    for (const [name, fields] of records) {
      expect(fields.length, `${name} mirrors an empty field list`).toBeGreaterThan(0);
      expect(new Set(fields).size, `${name} names a field twice`).toBe(fields.length);
    }
  });

  test.skipIf(!BACKEND)("every record's fields match the C#, in both directions", () => {
    const cs = readFileSync(join(BACKEND!, CONNECTION_SERVICE_REL), "utf8");

    // WHICH WIRE VERSION THIS BACKEND SPEAKS. PR 207 replaces every leg's `bool Passed`
    // with an `outcome` string and adds one to the summary. The frontend reads BOTH — it
    // can deploy before that backend does — so the mirror has to accept both, and the
    // pair it accepts is enumerated rather than loosened: a THIRD shape still fails in
    // both directions, which is the property this diff exists for.
    const replayFields = parseRecordParameterNames(cs, "ReplayLeg");
    expect(
      replayFields,
      `${CONNECTION_SERVICE_REL} declares no \`record ReplayLeg\`, so the wire version ` +
        "cannot be determined and neither field list can be diffed honestly.",
    ).not.toBeNull();
    const speaksOutcome = replayFields!.includes("outcome");
    const records = speaksOutcome ? TEST_PACK_BACKEND_RECORDS : LEGACY_TEST_PACK_BACKEND_RECORDS;

    for (const [recordName, frontendFields] of Object.entries(records)) {
      const backendFields = parseRecordParameterNames(cs, recordName);
      expect(
        backendFields,
        `${CONNECTION_SERVICE_REL} declares no \`record ${recordName}\`. Either it was renamed — in ` +
          "which case src/components/connections/testPackSummary.ts mirrors a shape that no longer " +
          "exists — or the parser above stopped matching.",
      ).not.toBeNull();

      recordComparison(
        `${recordName} (${CONNECTION_SERVICE_REL})`,
        backendFields!,
        frontendFields,
        `${recordName} drifted from src/components/connections/testPackSummary.ts. A field the ` +
          "backend sends and the frontend does not name is DROPPED silently at the JSON boundary — " +
          "which is exactly how `parseLeg` was lost, and how a test pack that failed only on the " +
          "parse leg came to render a red panel with no reason on it. Add the field to the " +
          "interface, to its *_FIELDS list, and to the reader.",
      );

      // Whichever shape the backend speaks, the READER has to be able to hold every one
      // of its fields — that is what the diff is protecting, and asserting only the list
      // would let the list and the reader drift apart while both looked right.
      for (const field of backendFields!) {
        const key = readerKeyFor(recordName, field);
        expect(
          READER_KEYS[recordName as keyof typeof READER_KEYS],
          `${recordName}.${field} is on the wire but parseTestSummary never produces it`,
        ).toContain(key);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan-gate error codes quoted in the admin guides.
//
// THE DEFECT THIS EXISTS FOR. `admin/guides/onboard-a-new-client` told staff that enabling
// catalog sync on Pilot returns `catalog_sync_requires_integration`, "which is misleading —
// the real requirement is Growth, not Integration". That was true when it was written and
// WP-11 made it false: the backend derives the tier from
// `PlanConstants.GetMinimumPlan(BillingFeature.SftpIngestion)`, which is Growth, so the code
// now reads `catalog_sync_requires_growth` and says exactly what it means. The guide was
// still instructing an operator to distrust a correct 403 and go looking for a bug.
//
// A prose correction rots the same way the original did. The tier in a documented code is
// derivable — the capability↔feature binding from the controller, the feature↔plan binding
// from the mirrored gate table — so it is derived, and the guide is checked against it.
// ─────────────────────────────────────────────────────────────────────────────

const CONTROLLERS_DIR = "ProcuLink.Api/Controllers";
const ADMIN_GUIDES_DIR = "src/app/(app)/admin/guides";

/** `RequiresPlan("catalog_sync", BillingFeature.SftpIngestion)` → capability ⇒ feature. */
function parseRequiresPlanSites(cs: string): Record<string, string> {
  const sites: Record<string, string> = {};
  for (const m of stripCsComments(cs).matchAll(
    /RequiresPlan\(\s*"([a-z0-9_]+)"\s*,\s*BillingFeature\.([A-Za-z0-9]+)\s*\)/g,
  )) {
    sites[m[1]] = m[2];
  }
  return sites;
}

/** `SftpIngestion` → `sftpIngestion`, the key MINIMUM_PLAN mirrors that feature under. */
const featureKey = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/** Every `<capability>_requires_<plan>` literal in the admin guides, with where it sits. */
function guideGateCodes(): Array<{ file: string; capability: string; plan: string; code: string }> {
  const found: Array<{ file: string; capability: string; plan: string; code: string }> = [];
  const walkAll = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walkAll(full));
      else if (/\.(mdx|tsx?)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };
  for (const file of walkAll(join(ROOT, ADMIN_GUIDES_DIR))) {
    for (const m of readFileSync(file, "utf8").matchAll(/\b([a-z0-9_]+)_requires_([a-z]+)\b/g)) {
      found.push({ file: file.replace(ROOT, ""), capability: m[1], plan: m[2], code: m[0] });
    }
  }
  return found;
}

describe("the plan-gate codes the admin guides quote are the codes the backend emits", () => {
  test("the call-site parser actually parses (so a green check means something)", () => {
    const fixture = `
    // A commented-out site must not count.
    // return BillingGateErrors.RequiresPlan("ghost", BillingFeature.Ghost);
    error = BillingGateErrors.RequiresPlan("catalog_sync", BillingFeature.SftpIngestion),
    error = BillingGateErrors.RequiresPlan("advanced_audit", BillingFeature.AdvancedAudit),`;

    expect(parseRequiresPlanSites(fixture)).toEqual({
      catalog_sync: "SftpIngestion",
      advanced_audit: "AdvancedAudit",
    });
    expect(parseRequiresPlanSites("nothing here")).toEqual({});
    expect(featureKey("SftpIngestion")).toBe("sftpIngestion");
  });

  test("the guides really quote a gate code, and the stale one is gone", () => {
    // Anti-vacuity: the check below sweeps whatever the guides happen to contain, and an
    // empty sweep passes for free. The literal the guide shipped is named here because its
    // presence is the defect — it is a code no backend path can produce.
    const codes = guideGateCodes();
    expect(codes.length, "no admin guide quotes a plan-gate code — the check below is vacuous")
      .toBeGreaterThan(0);
    expect(
      codes.map((c) => c.code),
      "an admin guide still quotes catalog_sync_requires_integration. The backend derives that " +
        "tier from PlanConstants.GetMinimumPlan(BillingFeature.SftpIngestion), which is Growth, " +
        "so no request can produce that code — the guide tells an operator to distrust a correct 403.",
    ).not.toContain("catalog_sync_requires_integration");
  });

  test.skipIf(!BACKEND)("every quoted code names the tier the backend really derives", () => {
    const controllers = readdirSync(join(BACKEND!, CONTROLLERS_DIR)).filter((f) => f.endsWith(".cs"));
    expect(controllers.length, `${CONTROLLERS_DIR} has no controllers — the walk went wrong`)
      .toBeGreaterThan(3);

    const sites: Record<string, string> = {};
    for (const file of controllers) {
      Object.assign(sites, parseRequiresPlanSites(readFileSync(join(BACKEND!, CONTROLLERS_DIR, file), "utf8")));
    }
    expect(
      Object.keys(sites).length,
      "no BillingGateErrors.RequiresPlan call site was found in any controller",
    ).toBeGreaterThan(3);

    // Only codes whose capability really is a RequiresPlan producer are judged. Other gate
    // codes are built elsewhere, and flagging a code this parser cannot account for would be
    // the over-reach that gets a guard weakened until it catches nothing.
    const judged = guideGateCodes().filter((c) => sites[c.capability] !== undefined);
    expect(
      judged.length,
      "no quoted code maps to a RequiresPlan call site, so this comparison checked nothing",
    ).toBeGreaterThan(0);

    for (const { file, capability, plan, code } of judged) {
      const key = featureKey(sites[capability]) as keyof typeof MINIMUM_PLAN;
      const real = MINIMUM_PLAN[key];
      expect(real, `${capability} gates on BillingFeature.${sites[capability]}, which src/lib/gatedCapabilities.ts does not mirror`).toBeDefined();
      expect(
        plan,
        `${file} quotes \`${code}\`, but ${capability} gates on BillingFeature.${sites[capability]}, ` +
          `whose minimum is ${real} — so the real code is \`${capability}_requires_${real}\`. A guide ` +
          "that misquotes a 403 sends staff hunting a bug in code that is behaving correctly.",
      ).toBe(real);
    }
    comparisonsRun += 1;
  });
});

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
  3 + // outbound URL policy: SecureSchemes, LoopbackOnlySchemes, the error-code walk
  2 + // invoices: the InvoiceService writer diff, and the citation walk over every fact
  2 + // transform causes: the per-pattern site count, and the end-to-end routing walk
  3 + // output formats: the buildable set, the standards catalog, PREVIEW_FORMATS
  Object.keys(TEST_PACK_BACKEND_RECORDS).length + // one per test-pack record mirrored
  1 + // the plan-gate codes quoted in the admin guides
  1; // MINIMUM_PLAN against PlanConstants.MinimumPlan

afterAll(() => {
  if (!BACKEND) return; // the mirror gate already ruled on whether that was allowed
  if (comparisonsRun >= EXPECTED_COMPARISONS) return;
  throw new Error(
    `The backend mirror resolved a checkout at ${BACKEND} but only ran ${comparisonsRun} of ` +
      `${EXPECTED_COMPARISONS} declared comparisons. Some part of the diff did not execute, so this run ` +
      `does NOT verify src/lib/orderStatusManifest.ts against the C#. Treat it as a failure, not a pass.`,
  );
});
