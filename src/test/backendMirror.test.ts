import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  DECLARED_TERMINAL,
  FAILURE_STATUSES,
  OP_GUARDS,
  ORDER_STATUSES,
  RESOLVE_HELD_FROM,
} from "@/lib/orderStatusManifest";
import { ROOT } from "./appRoutes";

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
    for (const [op, guard] of Object.entries(OP_GUARDS)) {
      const [file] = guard.backendSite.split(":");
      const path = join(BACKEND!, file);
      expect(existsSync(path), `${op} cites ${file}, which does not exist`).toBe(true);
      const symbol = guard.backendSymbol.includes(".") ? guard.backendSymbol.split(".").pop()! : "Unrouted";
      expect(readFileSync(path, "utf8")).toContain(symbol);
    }
  });
});
