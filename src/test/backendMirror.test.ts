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
const TRANSFORM_SERVICE_REL = "ProcuLink.Api/Services/Orders/OrderTransformService.cs";

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
  TRANSFORM_SERVICE_REL,
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
      TRANSFORM_SERVICE_REL,
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
 * One string literal in C# source: its text, and where it sat.
 *
 * `text` is normalised: every interpolation hole becomes `{}` (so `{ex.Message}`
 * and `{effectiveFormat}` read the same), `""` in a verbatim string and `\"` in a
 * regular one become `"`, and `{{` / `}}` become single braces.
 */
interface CsLiteral {
  text: string;
  start: number;
  end: number;
}

/** Reads ONE literal starting at `start` (which may point at a `$`/`@` prefix). */
function readCsLiteral(cs: string, start: number): CsLiteral | null {
  let p = start;
  let interpolated = false;
  let verbatim = false;
  while (p < cs.length && (cs[p] === "$" || cs[p] === "@")) {
    if (cs[p] === "$") interpolated = true;
    else verbatim = true;
    p += 1;
  }
  if (cs[p] !== '"') return null;
  p += 1;

  let text = "";
  // Interpolation holes nest, and they can contain string literals of their own —
  // `{string.Join(", ", unresolved)}` is the reason a naive scanner ends the
  // sentence at `", "` and reports two fragments instead of one message.
  let depth = 0;

  while (p < cs.length) {
    const c = cs[p];

    if (depth > 0) {
      if (c === '"') {
        const nested = readCsLiteral(cs, p);
        if (!nested) return null;
        p = nested.end;
        continue;
      }
      if (c === "'") {
        p += 1;
        while (p < cs.length && cs[p] !== "'") p += cs[p] === "\\" ? 2 : 1;
        p += 1;
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      p += 1;
      continue;
    }

    if (c === '"') {
      if (verbatim && cs[p + 1] === '"') {
        text += '"';
        p += 2;
        continue;
      }
      return { text, start, end: p + 1 };
    }
    if (!verbatim && c === "\\") {
      const esc = cs[p + 1];
      text += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc;
      p += 2;
      continue;
    }
    if (interpolated && (c === "{" || c === "}")) {
      if (cs[p + 1] === c) {
        text += c;
        p += 2;
        continue;
      }
      if (c === "{") {
        text += "{}";
        depth = 1;
        p += 1;
        continue;
      }
    }
    text += c;
    p += 1;
  }
  return null; // unterminated
}

/**
 * Every string EXPRESSION in C# source, with `+`-concatenated runs joined.
 *
 * Comments are skipped rather than collected, which is load-bearing: this file's
 * own C# quotes old messages in its comments, so a reader that collected them would
 * report a reworded sentence as still present and go green on the exact drift it
 * was added to catch. Char literals are skipped for the same reason an apostrophe
 * must not open a string.
 */
export function parseCsStringExpressions(cs: string): string[] {
  const literals: CsLiteral[] = [];
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (c === "/" && cs[i + 1] === "/") {
      while (i < cs.length && cs[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && cs[i + 1] === "*") {
      i += 2;
      while (i < cs.length && !(cs[i] === "*" && cs[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "'") {
      i += 1;
      while (i < cs.length && cs[i] !== "'") i += cs[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '"' || ((c === "$" || c === "@") && /^[$@]*"/.test(cs.slice(i, i + 3)))) {
      const lit = readCsLiteral(cs, i);
      if (lit) {
        literals.push(lit);
        i = lit.end;
        continue;
      }
    }
    i += 1;
  }

  const joined: string[] = [];
  for (let a = 0; a < literals.length; ) {
    let text = literals[a].text;
    let b = a;
    while (b + 1 < literals.length && /^\s*\+\s*$/.test(cs.slice(literals[b].end, literals[b + 1].start))) {
      b += 1;
      text += literals[b].text;
    }
    joined.push(text);
    a = b + 1;
  }
  return joined;
}

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
  2; // transform causes: the per-pattern site count, and the end-to-end routing walk

afterAll(() => {
  if (!BACKEND) return; // the mirror gate already ruled on whether that was allowed
  if (comparisonsRun >= EXPECTED_COMPARISONS) return;
  throw new Error(
    `The backend mirror resolved a checkout at ${BACKEND} but only ran ${comparisonsRun} of ` +
      `${EXPECTED_COMPARISONS} declared comparisons. Some part of the diff did not execute, so this run ` +
      `does NOT verify src/lib/orderStatusManifest.ts against the C#. Treat it as a failure, not a pass.`,
  );
});
