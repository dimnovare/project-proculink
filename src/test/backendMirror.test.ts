import { describe, test, expect } from "vitest";
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
// This file parses the real C# and diffs it. It cannot run in the frontend's CI,
// because the backend is not checked out there — so it is written to be honest
// about that rather than to fake coverage:
//
//   • The PARSER is tested against an inline fixture on EVERY run, everywhere. A
//     parser that quietly stopped matching would otherwise "confirm" the mirror by
//     finding nothing, which is the vacuous-pass shape WP-02 exists to prevent.
//   • The DIFF runs whenever a backend checkout is reachable — the env var
//     PROCULINK_BACKEND_PATH, or a sibling `ProcuLink` directory found by walking
//     up from this repo. Locally that is the normal case; a pre-merge run is where
//     drift is meant to be caught.
//   • When no checkout is reachable the diff is SKIPPED BY A DECLARED CONDITION
//     with the reason printed, never silently passed.
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bun run test src/test/backendMirror.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const CONSTANTS_REL = "ProcuLink.Core/Constants/OrderStatusConstants.cs";
const MACHINE_REL = "ProcuLink.Core/Constants/OrderStatusMachine.cs";

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

// ── The diff, when a backend checkout is reachable ───────────────────────────

describe("the manifest matches the C# it claims to mirror", () => {
  const reason = `no backend checkout found — set PROCULINK_BACKEND_PATH to the ProcuLink repo to run the mirror diff`;

  test("a backend checkout was located, or this run says why not", () => {
    // Always runs. It cannot fail the suite where the backend is absent, but it
    // puts the state on the record instead of leaving a silent skip.
    if (!BACKEND) {
      expect(reason).toContain("PROCULINK_BACKEND_PATH");
      return;
    }
    expect(existsSync(join(BACKEND, MACHINE_REL))).toBe(true);
  });

  test.skipIf(!BACKEND)("every status the machine keys is in the manifest, and vice versa", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const keys = parseTransitionKeys(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"));
    expect(keys.length, "parsed no transition keys — the parser has drifted from the C#").toBeGreaterThan(10);
    expect(sorted(resolveAll(keys, constants))).toEqual(sorted(ORDER_STATUSES));
  });

  test.skipIf(!BACKEND)("FailureBucket matches", () => {
    const cs = readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8");
    const members = parseNamedSet(cs, "FailureBucket");
    expect(members, "FailureBucket not found in OrderStatusConstants.cs").not.toBeNull();
    expect(sorted(resolveAll(members!, parseStatusConstants(cs)))).toEqual(sorted(FAILURE_STATUSES));
  });

  test.skipIf(!BACKEND)("DeclaredTerminal matches", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), "DeclaredTerminal");
    expect(members, "DeclaredTerminal not found in OrderStatusMachine.cs").not.toBeNull();
    expect(sorted(resolveAll(members!, constants))).toEqual(sorted(DECLARED_TERMINAL));
  });

  test.skipIf(!BACKEND)("ResolveHeldFrom matches", () => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), "ResolveHeldFrom");
    expect(members, "ResolveHeldFrom not found in OrderStatusMachine.cs").not.toBeNull();
    expect(sorted(resolveAll(members!, constants))).toEqual(sorted(RESOLVE_HELD_FROM));
  });

  /**
   * The op guards, each against the symbol its own row names.
   *
   * `assignSupplier` is excluded and says so in the manifest: the backend still
   * writes that guard as a bare literal inside the atomic claim rather than as a
   * named set, so there is no symbol to read. It is the one row this diff cannot
   * cover, and naming that is better than pretending otherwise.
   */
  const NAMED_GUARDS = Object.entries(OP_GUARDS).filter(([, g]) => /^OrderStatusMachine\.\w+$/.test(g.backendSymbol));

  test("the guard walk is not empty", () => {
    expect(NAMED_GUARDS.length).toBe(5);
  });

  test.skipIf(!BACKEND).each(NAMED_GUARDS)("%s mirrors its named C# set exactly", (op, guard) => {
    const constants = parseStatusConstants(readFileSync(join(BACKEND!, CONSTANTS_REL), "utf8"));
    const symbol = guard.backendSymbol.split(".")[1];
    const members = parseNamedSet(readFileSync(join(BACKEND!, MACHINE_REL), "utf8"), symbol);
    expect(members, `${op} cites ${guard.backendSymbol}, which is not in OrderStatusMachine.cs`).not.toBeNull();
    expect(
      sorted(resolveAll(members!, constants)),
      `${op} mirrors ${guard.backendSymbol}. Manifest says [${sorted(guard.allowedFrom)}]; the C# says otherwise. A control offered on a status the endpoint refuses can only answer 400.`,
    ).toEqual(sorted(guard.allowedFrom));
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
    for (const [op, guard] of Object.entries(OP_GUARDS)) {
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
// ─────────────────────────────────────────────────────────────────────────────

const URL_POLICY_REL = "ProcuLink.Core/Security/OutboundUrlPolicy.cs";
const URL_POLICY_PATH = BACKEND ? join(BACKEND, URL_POLICY_REL) : null;
const URL_POLICY_READABLE = URL_POLICY_PATH !== null && existsSync(URL_POLICY_PATH);

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

  test.skipIf(!URL_POLICY_READABLE)("the scheme sets are identical", () => {
    const cs = readFileSync(URL_POLICY_PATH!, "utf8");

    const secure = parseStringLiteralList(cs, "SecureSchemes");
    const loopbackOnly = parseStringLiteralList(cs, "LoopbackOnlySchemes");

    expect(secure, "OutboundUrlPolicy.cs declares no SecureSchemes — the parser or the backend moved")
      .not.toBeNull();
    expect(
      loopbackOnly,
      "OutboundUrlPolicy.cs declares no LoopbackOnlySchemes — the parser or the backend moved",
    ).not.toBeNull();

    expect(
      sorted(secure!),
      "SECURE_SCHEMES drifted. A scheme the UI thinks is safe but the API refuses blocks a save; the reverse lets a cleartext endpoint through the form.",
    ).toEqual(sorted(SECURE_SCHEMES));
    expect(sorted(loopbackOnly!)).toEqual(sorted(LOOPBACK_ONLY_SCHEMES));
  });

  test.skipIf(!URL_POLICY_READABLE)("every error code the UI branches on still exists in the C#", () => {
    const constants = parseStatusConstants(readFileSync(URL_POLICY_PATH!, "utf8"));
    const backendCodes = Object.entries(constants)
      .filter(([name]) => name.startsWith("Error"))
      .map(([, value]) => value);

    expect(backendCodes.length, "OutboundUrlPolicy.cs declares no Error* constants").toBeGreaterThan(0);

    for (const [key, code] of Object.entries(OUTBOUND_URL_ERRORS)) {
      expect(
        backendCodes,
        `OUTBOUND_URL_ERRORS.${key} is "${code}", which the backend no longer emits. The UI would stop recognising that refusal and fall back to a raw 400 body.`,
      ).toContain(code);
    }
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
