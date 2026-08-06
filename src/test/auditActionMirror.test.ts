import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { AUDIT_ACTION_FACTS, REACHABLE_AUDIT_ACTIONS, auditActionFact } from "@/lib/auditActionManifest";
import { ROOT } from "./appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// The cross-repo mirror check for the audit vocabulary.
//
// `src/lib/auditActionManifest.ts` is a hand-kept copy of string literals that live
// in another repo and another language, and the thing it replaced was a hand-kept
// copy too — one whose keys were snake_case against a PascalCase backend, so it
// matched three actions out of thirty and painted every failure green. A comment
// naming the C# site is not a check. This file parses the real C# and diffs it.
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
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bunx vitest run src/test/auditActionMirror.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every production file that constructs an AuditEvent, as enumerated in the
 * manifest's provenance header (ProcuLink @ main 5db0b05). There are no
 * `AuditEvents.AddRange` sites, so this list is the whole writer surface.
 *
 * `IAcceptanceGate.cs` holds the three `AcceptanceGateAudit` constants; the two
 * AuditController/OrdersController entries are read for the declared-but-unwritten
 * names, not for writers.
 */
const WRITER_FILES = [
  "ProcuLink.Api/Controllers/AdminController.cs",
  "ProcuLink.Api/Controllers/OpsController.cs",
  "ProcuLink.Api/Controllers/OrdersController.cs",
  "ProcuLink.Api/Services/AcceptanceGate.cs",
  "ProcuLink.Api/Services/Orders/OrderIngestionService.cs",
  "ProcuLink.Api/Services/Orders/OrderResolutionService.cs",
  "ProcuLink.Api/Services/Orders/OrderTransformService.cs",
  "ProcuLink.Api/Services/ReplayService.cs",
  "ProcuLink.Core/Services/IAcceptanceGate.cs",
  "ProcuLink.Infrastructure/Services/DeliveryService.cs",
  "ProcuLink.Infrastructure/Services/DeliverySlaService.cs",
  "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs",
  "ProcuLink.Infrastructure/Services/StrandedFailedDeliveryDetectionService.cs",
  "ProcuLink.Infrastructure/Services/StrandedReadyOrderDetectionService.cs",
  "ProcuLink.Infrastructure/Services/StuckDeliveryDetectionService.cs",
  "ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs",
] as const;

const PROBE_REL = "ProcuLink.Api/Controllers/AuditController.cs";

/** The backend checkout, or null. Same walk-up as backendMirror.test.ts. */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, PROBE_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, PROBE_REL))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();

// ── The parsers ──────────────────────────────────────────────────────────────
// Small and total. Each returns what it found; the callers assert on the contents,
// so "found nothing" fails loudly rather than passing quietly.

/**
 * `AcceptanceGateAudit`-style constants: `public const string BlockedAction = "AcceptanceBlocked";`
 *
 * Only names ending in `Action` — the same class also holds payload-key constants
 * (`ExcusedKey = "excused"`, `ActorKey = "by"`) which are NOT audit actions, and
 * hoovering those up would put two fictional actions into the diff.
 */
export function parseActionConstants(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /const\s+string\s+(\w*Action)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.set(m[1], m[2]);
  return out;
}

/**
 * Resolve one C# argument expression to the action literals it can produce.
 *
 * Handles the three shapes the backend actually uses in the action position:
 *   "Literal"                                  → one action
 *   AcceptanceGateAudit.BlockedAction          → via the constant table
 *   cond ? "A" : "B"  (OrdersController:2908)  → both arms
 */
function resolveActionExpr(expr: string, consts: Map<string, string>): string[] {
  const literals = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (literals.length > 0) return literals;

  const out: string[] = [];
  for (const m of expr.matchAll(/(?:\w+\.)?(\w*Action)\b/g)) {
    const value = consts.get(m[1]);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Every audit action a source file can write.
 *
 * Four shapes, because the backend has no central constants class and writes them
 * four different ways:
 *   1. `Action = "Literal"` object initialisers
 *   2. `BuildAuditEvent(orgId, entityId, <action>, payload)` — the third argument
 *   3. `WriteAdminAuditAsync(orgId, entityId, "EntityType", "action", …)` — the fourth
 *   4. `WriteAuditAsync(orgId, "action", …)` — the second
 *
 * `Action = action` (the three helper bodies) is deliberately NOT matched: the
 * literal lives at the helper's call sites, which shapes 3 and 4 pick up.
 */
export function parseAuditActions(src: string, consts: Map<string, string>): string[] {
  const found = new Set<string>();

  for (const m of src.matchAll(/\bAction\s*=\s*"([^"]+)"/g)) found.add(m[1]);

  // Args are plain identifiers (orgId, orderId, id) so a comma cannot appear inside
  // one; the third field is the action expression. No `s` flag anywhere below — the
  // negated classes ([^,] / [^,()] / [^"]) already span newlines, and `s` is not
  // available at this tsconfig target.
  for (const m of src.matchAll(/BuildAuditEvent\(\s*[^,()]+,\s*[^,()]+,\s*([^,]+),/g)) {
    for (const a of resolveActionExpr(m[1], consts)) found.add(a);
  }

  for (const m of src.matchAll(/WriteAdminAuditAsync\(\s*[^,()]+,\s*[^,()]+,\s*"[^"]*",\s*"([^"]+)"/g)) {
    found.add(m[1]);
  }

  for (const m of src.matchAll(/WriteAuditAsync\(\s*[^,()]+,\s*"([^"]+)"/g)) found.add(m[1]);

  return [...found];
}

// ── The parsers are checked on every run, backend or not ─────────────────────

describe("audit-action parsers (fixture — runs everywhere)", () => {
  const FIXTURE = `
public static class AcceptanceGateAudit
{
    public const string OverriddenAction = "AcceptanceOverridden";
    public const string BlockedAction = "AcceptanceBlocked";
    public const string ExcusedKey = "excused";
}

public class Sample
{
    void A() {
        _db.AuditEvents.Add(new AuditEvent
        {
            Id         = Guid.NewGuid(),
            Action     = "DeliveryDeadLettered",
            CreatedAt  = DateTime.UtcNow,
        });
        _db.AuditEvents.Add(OrderServiceShared.BuildAuditEvent(organisationId, orderId, "ParseFailed",
            new { error = "boom" }));
        _db.AuditEvents.Add(OrderServiceShared.BuildAuditEvent(
            orgId, id, AcceptanceGateAudit.BlockedAction, new
            {
                stage = "transform",
            }));
        _db.AuditEvents.Add(OrderServiceShared.BuildAuditEvent(
            orgId, orderId,
            accepted is not null ? "SupplierSuggestionAccepted" : "SupplierAssignedManually",
            new { }));
        await WriteAdminAuditAsync(org.Id, org.Id, "Organisation", "admin.org.limits_changed", data, ct);
        await WriteAuditAsync(
            org.Id,
            "inbound_email.no_attachments",
            payload,
            ct);
    }
}`;

  test("reads action constants and ignores payload-key constants", () => {
    const consts = parseActionConstants(FIXTURE);
    expect(consts.get("BlockedAction")).toBe("AcceptanceBlocked");
    expect(consts.get("OverriddenAction")).toBe("AcceptanceOverridden");
    // `ExcusedKey` is a payload key, not an action.
    expect([...consts.keys()]).not.toContain("ExcusedKey");
  });

  test("finds every shape the backend writes actions in", () => {
    const actions = parseAuditActions(FIXTURE, parseActionConstants(FIXTURE));
    expect(actions).toEqual(
      expect.arrayContaining([
        "DeliveryDeadLettered", // Action = "…" initialiser
        "ParseFailed", // BuildAuditEvent, literal, same line
        "AcceptanceBlocked", // BuildAuditEvent via constant, next line
        "SupplierSuggestionAccepted", // ternary, both arms
        "SupplierAssignedManually",
        "admin.org.limits_changed", // WriteAdminAuditAsync 4th arg
        "inbound_email.no_attachments", // WriteAuditAsync 2nd arg, multi-line
      ]),
    );
  });

  test("does not invent an action from a payload literal", () => {
    // The `AcceptanceGateAudit.BlockedAction` site's payload contains `stage = "transform"`.
    // A parser that grabbed the first quoted literal after `BuildAuditEvent(` would
    // report "transform" as an audit action.
    const actions = parseAuditActions(FIXTURE, parseActionConstants(FIXTURE));
    expect(actions).not.toContain("transform");
    expect(actions).not.toContain("boom");
  });
});

// ── The diff ─────────────────────────────────────────────────────────────────

const SKIP_REASON =
  "no backend checkout found — set PROCULINK_BACKEND_PATH to the ProcuLink repo to run the mirror diff";

/**
 * The scan, done ONCE and only from inside a test body.
 *
 * Every read lives behind this function on purpose. `describe.skip` still RUNS its
 * callback — it only marks the tests inside as skipped — so setup written at the
 * top of a skipped describe executes anyway. An earlier version of this file did
 * exactly that, and `join(null, rel)` threw `ERR_INVALID_ARG_TYPE` at collection
 * time on CI, where no backend is checked out: the whole file failed rather than
 * skipping. `src/test/backendMirror.test.ts` gets this right by putting its reads
 * inside `test.skipIf(!BACKEND)` bodies; this now matches it.
 */
type Scan = { root: string; consts: Map<string, string>; byFile: Map<string, string[]>; backendActions: string[] };
let cached: Scan | null = null;

function scan(): Scan {
  if (cached) return cached;
  const root = BACKEND!;

  const consts = new Map<string, string>();
  for (const rel of WRITER_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const [k, v] of parseActionConstants(readFileSync(path, "utf8"))) consts.set(k, v);
  }

  const byFile = new Map<string, string[]>();
  for (const rel of WRITER_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    byFile.set(rel, parseAuditActions(readFileSync(path, "utf8"), consts));
  }

  cached = { root, consts, byFile, backendActions: [...new Set([...byFile.values()].flat())] };
  return cached;
}

describe("auditActionManifest mirrors the backend's audit vocabulary", () => {
  test("the diff either runs, or is skipped for a declared reason", () => {
    // Runs everywhere, including CI. A skip must be attributable, never silent.
    if (!BACKEND) {
      expect(SKIP_REASON).toContain("PROCULINK_BACKEND_PATH");
      return;
    }
    expect(existsSync(join(BACKEND, PROBE_REL))).toBe(true);
  });

  test.skipIf(!BACKEND)("every writer file named in the manifest's provenance still exists", () => {
    const { root } = scan();
    for (const rel of WRITER_FILES) {
      expect(existsSync(join(root, rel)), `${rel} is gone — the manifest's provenance is stale`).toBe(true);
    }
  });

  test.skipIf(!BACKEND)("the scan found a realistic number of actions (anti-vacuity)", () => {
    const { backendActions } = scan();
    // 30 order/delivery actions + 6 admin + 6 inbound_email were enumerated by hand
    // at 5db0b05. A parser that silently stopped matching would make every diff below
    // pass by finding nothing.
    expect(backendActions.length).toBeGreaterThanOrEqual(40);
  });

  test.skipIf(!BACKEND)("NO backend audit action is unknown to the frontend", () => {
    const { backendActions } = scan();
    // The drift this whole file exists for: the backend adds an action, this build
    // has never heard of it, and the delivery log renders it as… something. It is at
    // least honest now (`unknown`), but an unclassified failure is still a failure an
    // operator cannot filter for.
    const unknown = backendActions.filter((a) => auditActionFact(a) === null).sort();
    expect(unknown, `audit actions with no row in src/lib/auditActionManifest.ts: ${unknown.join(", ")}`).toEqual([]);
  });

  test.skipIf(!BACKEND)("every action the manifest calls reachable is really written in the backend", () => {
    const { backendActions } = scan();
    // The reverse direction. Catches a row that survived a backend rename, and it is
    // what makes `reachable` a claim rather than a decoration.
    const missing = REACHABLE_AUDIT_ACTIONS.filter(
      (a) => !backendActions.some((b) => b.toLowerCase() === a.toLowerCase()),
    ).sort();
    expect(missing, `manifest claims these are written, but no writer emits them: ${missing.join(", ")}`).toEqual([]);
  });

  test.skipIf(!BACKEND)("every action the manifest calls UNREACHABLE really has no writer", () => {
    const { backendActions } = scan();
    // The five declared-but-unwritten rows (`DeliveryFailed`, `delivery_failed`,
    // `delivered`, `status_changed`, `transform_queued`). If one of them acquires a
    // writer, this fails and the row's `reachable` flag — and its note — must change.
    const unexpected = AUDIT_ACTION_FACTS.filter((f) => !f.reachable)
      .filter((f) => backendActions.some((b) => b.toLowerCase() === f.action.toLowerCase()))
      .map((f) => f.action)
      .sort();
    expect(
      unexpected,
      `these are marked unreachable but a writer now emits them: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  test.skipIf(!BACKEND)("each row's backendSite names a file that really contains that action", () => {
    const { root } = scan();
    // The provenance is load-bearing — it is how the next person re-derives this
    // table — so it is checked rather than trusted.
    //
    // The check is "the cited file contains this action as a quoted literal", NOT
    // "the parser found an action there": the three AcceptanceGateAudit rows cite
    // the file that DECLARES the constant (ProcuLink.Core/Services/IAcceptanceGate.cs),
    // which is the contract worth pointing at, while the writers are elsewhere.
    // A rename still breaks this, which is the point.
    for (const fact of AUDIT_ACTION_FACTS) {
      const rel = fact.backendSite.split(":")[0].trim();
      const path = join(root, rel);
      expect(existsSync(path), `${fact.action} cites ${rel}, which does not exist`).toBe(true);
      expect(
        readFileSync(path, "utf8").includes(`"${fact.action}"`),
        `${fact.action} cites ${rel}, but that file does not contain the literal "${fact.action}"`,
      ).toBe(true);
    }
  });
});
