import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  DELIVERY_ATTEMPT_STATUS_FACTS,
  DELIVERY_ATTEMPT_STATUSES,
  deliveryAttemptStatusFact,
} from "@/lib/deliveryAttemptManifest";
import { ROOT } from "./appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// The cross-repo mirror check for the delivery-attempt status vocabulary.
//
// `src/lib/deliveryAttemptManifest.ts` is a hand-kept copy of four C# constants
// that live in another repo and another language, and the thing it replaced was
// not even a copy — it was a substring match over an open string, which answered
// "yes, delivered" for `undeliverable`. A comment naming the C# site is not a
// check. This file parses the real C# and diffs it.
//
// Written the same way as `src/test/backendMirror.test.ts`, for the same reasons:
//
//   • The PARSERS are tested against an inline fixture on EVERY run, everywhere. A
//     parser that quietly stopped matching would otherwise "confirm" the mirror by
//     finding nothing.
//   • The DIFF runs whenever a backend checkout is reachable — PROCULINK_BACKEND_PATH,
//     or a sibling `ProcuLink` found by walking up from this repo.
//   • When no checkout is reachable the diff is SKIPPED BY A DECLARED CONDITION with
//     the reason printed, never silently passed.
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bunx vitest run src/test/deliveryAttemptMirror.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Declares the four `Status*` constants. */
const ENTITY_REL = "ProcuLink.Core/Entities/DeliveryAttempt.cs";
/** The ONLY production file that writes the column — every `Status =` site lives here. */
const WRITER_REL = "ProcuLink.Infrastructure/Services/DeliveryService.cs";

/** The backend checkout, or null. Same walk-up as backendMirror.test.ts. */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, ENTITY_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, ENTITY_REL)) && existsSync(join(candidate, WRITER_REL))) {
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
 * Opt-IN, as in `src/test/backendMirror.test.ts`: a developer without the backend cloned
 * still gets the parser tests, which is the honest amount of coverage that machine can
 * give. CI has no such excuse — the job checks the backend out.
 */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/**
 * Why this run may not proceed, or null.
 *
 * Pure, and unit-tested on BOTH branches below. The branch that matters is unreachable on
 * any machine that has the backend cloned, which is every machine this file has been
 * edited on — so it has to be exercised as a function rather than as a run condition.
 */
export function mirrorGateFailure(input: { backendRoot: string | null; required: boolean }): string | null {
  if (input.backendRoot !== null || !input.required) return null;
  return (
    "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so the " +
    "attempt-status diff did not run. This run proves nothing about " +
    "src/lib/deliveryAttemptManifest.ts. Set PROCULINK_BACKEND_PATH to a ProcuLink checkout " +
    "(the `backend-mirror` job in .github/workflows/ci.yml does this with actions/checkout), " +
    "or unset PROCULINK_REQUIRE_BACKEND_MIRROR if this run is genuinely not meant to enforce " +
    "the mirror."
  );
}

// ── The parsers ──────────────────────────────────────────────────────────────
// Small and total. Each returns what it found; the callers assert on the contents,
// so "found nothing" fails loudly rather than passing quietly.

/**
 * `public const string StatusSuccess = "success";` → { StatusSuccess: "success" }
 *
 * Only names beginning `Status` — the same entity also declares
 * `MaxResponseBodyLength`, and it would grow other constants over time.
 */
export function parseAttemptStatusConstants(cs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cs.matchAll(/public\s+const\s+string\s+(Status\w+)\s*=\s*"([^"]+)"\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/**
 * Resolve one C# right-hand side to the status literals it can produce.
 *
 * Three shapes, which between them cover every write site:
 *   "failed"                                        → one status
 *   DeliveryAttempt.StatusDispatching               → via the constant table
 *   result.Success ? "success" : "failed"           → both arms
 *   status  (a local declared from either of these) → via the locals table
 *
 * An expression that resolves to NOTHING is dropped, and that is load-bearing: the
 * same file assigns the ORDER's status seventeen times (`order.Status =
 * OrderStatusConstants.Delivering`), and those must not land in this vocabulary.
 * `OrderStatusConstants` cannot be mistaken for a `Status*` constant because the
 * pattern below anchors on a word boundary, which `OrderStatusConstants` has before
 * `Order`, not before `Status`.
 */
function resolveStatusExpr(
  expr: string,
  consts: Record<string, string>,
  locals: Record<string, string[]>,
): string[] {
  const literals = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (literals.length > 0) return literals;

  const out: string[] = [];
  for (const m of expr.matchAll(/\b(Status\w+)\b/g)) {
    const value = consts[m[1]];
    if (value) out.push(value);
  }
  if (out.length > 0) return out;

  for (const m of expr.matchAll(/\b([a-z]\w*)\b/g)) {
    const value = locals[m[1]];
    if (value) out.push(...value);
  }
  return out;
}

/**
 * Every status value this source file can write into a `DeliveryAttempt.Status`.
 *
 * Two passes, because the terminal write is `existingAttempt.Status = status` and the
 * ternary that produced `status` is thirteen lines earlier:
 *   1. collect `var <name> = <expr>;` locals that resolve to status values
 *   2. collect every `[receiver.]Status = <expr>[;,]` assignment
 *
 * `=` is guarded with a negative lookahead so the file's `a.Status == StatusDispatching`
 * COMPARISONS — reads, not writes — are not counted as a writer surface.
 */
export function parseWrittenStatuses(cs: string, consts: Record<string, string>): string[] {
  const locals: Record<string, string[]> = {};
  for (const m of cs.matchAll(/\bvar\s+(\w+)\s*=\s*([^;]*?);\s*$/gm)) {
    const values = resolveStatusExpr(m[2], consts, {});
    if (values.length > 0) locals[m[1]] = values;
  }

  const found = new Set<string>();
  for (const m of cs.matchAll(/(?:\w+\.)?\bStatus\s*=(?!=)\s*([^;]*?)[;,]\s*$/gm)) {
    for (const v of resolveStatusExpr(m[1], consts, locals)) found.add(v);
  }
  return [...found];
}

// ── The parsers are checked on every run, backend or not ─────────────────────

describe("delivery-attempt status parsers (fixture — runs everywhere)", () => {
  const ENTITY_FIXTURE = `
public class DeliveryAttempt
{
    public string Status { get; set; } = string.Empty;
    public const int MaxResponseBodyLength = 8_000;
    public const string StatusSuccess = "success";
    /// <summary>Terminal: the attempt failed.</summary>
    public const string StatusFailed = "failed";
    public const string StatusDispatching = "dispatching";
    public const string StatusUnconfirmed = "unconfirmed";
}`;

  const WRITER_FIXTURE = `
public class DeliveryService
{
    async Task A() {
        var open = await _db.DeliveryAttempts.FirstOrDefaultAsync(
            a => a.OrderId == order.Id
                 && a.Status == DeliveryAttempt.StatusDispatching, ct);

        var attempt = new DeliveryAttempt
        {
            OrgId = order.OrgId,
            Status = DeliveryAttempt.StatusDispatching,
            AttemptNumber = attemptNumber,
        };

        attempt.Status = DeliveryAttempt.StatusUnconfirmed;
        order.Status = OrderStatusConstants.DeliveryUnconfirmed;

        _db.DeliveryAttempts.Add(new DeliveryAttempt
        {
            Channel = config.Protocol,
            Status = result.Success ? "success" : "failed",
            AttemptNumber = 0,
        });

        order.Status = OrderStatusConstants.DeliveryFailed;
        _db.DeliveryAttempts.Add(new DeliveryAttempt
        {
            Channel = "missing_config",
            Status = "failed",
        });

        var status = result.Success ? DeliveryAttempt.StatusSuccess : DeliveryAttempt.StatusFailed;
        order.Status = result.Success
            ? OrderStatusConstants.Delivered
            : SupplierResponseClassification.FailedOrderStatusFor(result);
        existingAttempt.Status = status;

        var toStatus = isPark ? OrderStatusConstants.DeliveryUnconfirmed : OrderStatusConstants.ReadyToDeliver;
        tracked.Status = toStatus;
    }
}`;

  test("reads the four status constants and ignores the non-status constant", () => {
    const consts = parseAttemptStatusConstants(ENTITY_FIXTURE);
    expect(consts).toEqual({
      StatusSuccess: "success",
      StatusFailed: "failed",
      StatusDispatching: "dispatching",
      StatusUnconfirmed: "unconfirmed",
    });
    expect(Object.keys(consts)).not.toContain("MaxResponseBodyLength");
  });

  test("finds every shape the backend writes an attempt status in", () => {
    const consts = parseAttemptStatusConstants(ENTITY_FIXTURE);
    expect(parseWrittenStatuses(WRITER_FIXTURE, consts).sort()).toEqual([
      "dispatching",
      "failed",
      "success",
      "unconfirmed",
    ]);
  });

  test("does NOT mistake an order-status assignment for an attempt status", () => {
    // The negative control the whole parser is shaped around. `order.Status =
    // OrderStatusConstants.Delivering` outnumbers the attempt writes in the real file
    // seventeen to six; a parser that hoovered those up would put `delivered`,
    // `delivery_failed` and `ready_to_deliver` into this vocabulary — and `delivered`
    // landing here is precisely the confusion that produced the defect.
    const consts = parseAttemptStatusConstants(ENTITY_FIXTURE);
    const found = parseWrittenStatuses(WRITER_FIXTURE, consts);
    for (const orderStatus of ["delivered", "delivery_failed", "delivery_unconfirmed", "ready_to_deliver"]) {
      expect(found).not.toContain(orderStatus);
    }
  });

  test("does NOT count a comparison as a write", () => {
    // `a.Status == DeliveryAttempt.StatusDispatching` reads the column. It happens to
    // name a value that IS in the vocabulary, so this is checked by removing the two
    // real `dispatching` writes and confirming the remaining comparison finds nothing.
    const consts = parseAttemptStatusConstants(ENTITY_FIXTURE);
    const readOnly = `
        var open = await _db.DeliveryAttempts.FirstOrDefaultAsync(
            a => a.Status == DeliveryAttempt.StatusDispatching, ct);
        var n = await _db.DeliveryAttempts.CountAsync(
            a => a.Status != DeliveryAttempt.StatusDispatching, ct);`;
    expect(parseWrittenStatuses(readOnly, consts)).toEqual([]);
  });

  test("the manifest itself carries the whole vocabulary (anti-vacuity)", () => {
    // Runs everywhere, backend or not. Four statuses were enumerated by hand at
    // ProcuLink @ main 1433807; a manifest that lost rows would make the diffs below
    // pass by having nothing to disagree about.
    expect(DELIVERY_ATTEMPT_STATUS_FACTS.length).toBeGreaterThanOrEqual(4);
    expect([...DELIVERY_ATTEMPT_STATUSES].sort()).toEqual(["dispatching", "failed", "success", "unconfirmed"]);
  });
});

// ── The diff ─────────────────────────────────────────────────────────────────

const SKIP_REASON =
  "no backend checkout found — set PROCULINK_BACKEND_PATH to the ProcuLink repo to run the mirror diff";

/**
 * The scan, done ONCE and only from inside a test body.
 *
 * Every read lives behind this function on purpose: `describe.skip` still RUNS its
 * callback, so setup written at the top of a skipped describe executes anyway and
 * throws on CI where no backend is checked out.
 */
type Scan = { root: string; consts: Record<string, string>; written: string[] };
let cached: Scan | null = null;

function scan(): Scan {
  if (cached) return cached;
  const root = BACKEND!;
  const consts = parseAttemptStatusConstants(readFileSync(join(root, ENTITY_REL), "utf8"));
  const written = parseWrittenStatuses(readFileSync(join(root, WRITER_REL), "utf8"), consts);
  cached = { root, consts, written };
  return cached;
}

describe("the backend-required gate (fixture — runs everywhere)", () => {
  test("no checkout is a legitimate skip when the mirror is not required", () => {
    expect(mirrorGateFailure({ backendRoot: null, required: false })).toBeNull();
  });

  test("no checkout is a FAILURE when CI required the mirror", () => {
    const failure = mirrorGateFailure({ backendRoot: null, required: true });
    expect(failure).toContain("PROCULINK_REQUIRE_BACKEND_MIRROR=1");
    expect(failure).toContain("src/lib/deliveryAttemptManifest.ts");
  });

  test("a resolved checkout passes the gate either way", () => {
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", required: true })).toBeNull();
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", required: false })).toBeNull();
  });
});

describe("deliveryAttemptManifest mirrors the backend's attempt-status vocabulary", () => {
  test("the diff either runs, or is skipped for a declared reason", () => {
    // Runs everywhere, including CI. A skip must be attributable, never silent — and under
    // PROCULINK_REQUIRE_BACKEND_MIRROR it may not even be attributable, because there the
    // checkout is the job's own responsibility.
    expect(mirrorGateFailure({ backendRoot: BACKEND, required: REQUIRE_MIRROR })).toBeNull();
    if (!BACKEND) {
      expect(SKIP_REASON).toContain("PROCULINK_BACKEND_PATH");
      return;
    }
    expect(existsSync(join(BACKEND, ENTITY_REL))).toBe(true);
  });

  test.skipIf(!BACKEND)("both files named in the manifest's provenance still exist", () => {
    const { root } = scan();
    for (const rel of [ENTITY_REL, WRITER_REL]) {
      expect(existsSync(join(root, rel)), `${rel} is gone — the manifest's provenance is stale`).toBe(true);
    }
  });

  test.skipIf(!BACKEND)("the scan found the whole vocabulary (anti-vacuity)", () => {
    const { consts, written } = scan();
    // A parser that silently stopped matching would make every diff below pass by
    // finding nothing. Four constants, and four distinct values actually written.
    expect(Object.keys(consts).length).toBeGreaterThanOrEqual(4);
    expect(written.length).toBeGreaterThanOrEqual(4);
  });

  test.skipIf(!BACKEND)("NO backend status constant is unknown to the frontend", () => {
    const { consts } = scan();
    // The drift this file exists for: the backend adds a fifth status, this build has
    // never heard of it, and the passport renders it as… something. It is at least
    // honest now (`unrecognised`, amber), but a status nobody classified is a delivery
    // question an operator cannot answer.
    const unknown = Object.values(consts)
      .filter((v) => deliveryAttemptStatusFact(v) === null)
      .sort();
    expect(unknown, `statuses with no row in src/lib/deliveryAttemptManifest.ts: ${unknown.join(", ")}`).toEqual([]);
  });

  test.skipIf(!BACKEND)("NO status the backend WRITES is unknown to the frontend", () => {
    const { written } = scan();
    // Stronger than the constants check, and the one that catches the shape the defect
    // came in: two of the six write sites use raw literals rather than the constants
    // (DeliveryService.cs:788 and :873), so a fifth value could be introduced there
    // without ever touching the entity.
    const unknown = written.filter((v) => deliveryAttemptStatusFact(v) === null).sort();
    expect(unknown, `written statuses with no row in the manifest: ${unknown.join(", ")}`).toEqual([]);
  });

  test.skipIf(!BACKEND)("every status the manifest declares is a real backend constant", () => {
    const { consts } = scan();
    // The reverse direction. Catches a row that survived a backend rename, and it is
    // what makes this table a mirror rather than a wish.
    const values = new Set(Object.values(consts));
    const invented = DELIVERY_ATTEMPT_STATUSES.filter((s) => !values.has(s)).sort();
    expect(invented, `manifest declares statuses the backend does not: ${invented.join(", ")}`).toEqual([]);
  });

  test.skipIf(!BACKEND)("each row's backendSite names a file that really contains that status", () => {
    const { root } = scan();
    // The provenance is load-bearing — it is how the next person re-derives this table
    // — so it is checked rather than trusted.
    for (const fact of DELIVERY_ATTEMPT_STATUS_FACTS) {
      const rel = fact.backendSite.split(":")[0].trim();
      const path = join(root, rel);
      expect(existsSync(path), `${fact.status} cites ${rel}, which does not exist`).toBe(true);
      expect(
        readFileSync(path, "utf8").includes(`"${fact.status}"`),
        `${fact.status} cites ${rel}, but that file does not contain the literal "${fact.status}"`,
      ).toBe(true);
    }
  });

  test.skipIf(!BACKEND)("the backend still writes no status that merely CONTAINS a success word", () => {
    const { written } = scan();
    // The defect, stated as a property of the backend rather than of the frontend.
    // `includes("deliver")` was safe only by accident: no value in the vocabulary
    // happens to contain "deliver". If one ever does — `undeliverable`, `not_delivered`
    // — this fails, and whoever adds it is pointed at the row they owe the manifest
    // before any screen can read it.
    const containsSuccessWord = written
      .filter((v) => /deliver|acknowled/.test(v.toLowerCase()))
      .sort();
    expect(
      containsSuccessWord,
      `these statuses contain a word the old substring matcher read as success: ${containsSuccessWord.join(", ")}`,
    ).toEqual([]);
  });
});
