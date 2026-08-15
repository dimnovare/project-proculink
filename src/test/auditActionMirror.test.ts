import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  AUDIT_ACTION_FACTS,
  EXPLAINED_AUDIT_ACTIONS,
  REACHABLE_AUDIT_ACTIONS,
  auditActionFact,
} from "@/lib/auditActionManifest";
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

/**
 * Set by the `backend-mirror` CI job. When true, "no backend checkout" stops being a
 * legitimate reason to skip and becomes a build failure.
 *
 * Opt-IN, exactly as in `src/test/backendMirror.test.ts`: a developer who has not cloned
 * the backend still gets the parser tests, which is the honest amount of coverage that
 * machine can give. CI has no such excuse, because the job checks the backend out.
 *
 * This file went without the flag for its whole life, and the omission was invisible
 * because it was never named in that job either — so there was no run in which the flag
 * would have been set. Both halves are needed: the job has to run the file, and the file
 * has to refuse to be green without the checkout the job provides.
 */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/**
 * Why this run may not proceed, or null.
 *
 * Pure, and unit-tested on BOTH branches below. The branch that matters is unreachable on
 * any machine that has the backend cloned — which is every machine this file has ever been
 * edited on — so a test that only ran it "for real" would never exercise it.
 */
export function mirrorGateFailure(input: { backendRoot: string | null; required: boolean }): string | null {
  if (input.backendRoot !== null || !input.required) return null;
  return (
    "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so the " +
    "audit-vocabulary diff did not run. This run proves nothing about " +
    "src/lib/auditActionManifest.ts, and an action with no row there renders as `unknown` " +
    "on /operations/log. Set PROCULINK_BACKEND_PATH to a ProcuLink checkout (the " +
    "`backend-mirror` job in .github/workflows/ci.yml does this with actions/checkout), or " +
    "unset PROCULINK_REQUIRE_BACKEND_MIRROR if this run is genuinely not meant to enforce " +
    "the mirror."
  );
}

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

// ── Payload keys ─────────────────────────────────────────────────────────────
// `AuditActionFact.reasonKeys` names the payload key that carries an action's reason.
// Naming a key the backend does not write would be silent: the delivery log would go
// on showing no reason, which is the exact defect that field exists to fix, and the
// render tests would still pass because they supply the payload themselves. So the
// key list is diffed against the real C# here, the same way the action list is.

/**
 * The body of the anonymous object starting at `openBrace`, by balanced braces.
 *
 * Brace-counting rather than a regex because these initialisers nest
 * (`filter = new { … }`) and span up to a dozen lines. Strings are skipped so a brace
 * inside `"{0}"` cannot unbalance the scan.
 */
function objectBody(src: string, openBrace: number): string | null {
  let depth = 0;
  for (let i = openBrace; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openBrace + 1, i);
    }
  }
  return null;
}

/** The offset of the `{` of the first `new … {` at or after `from`, or -1. */
function newObjectBraceAt(src: string, from: number): number {
  const m = /\bnew\b[^({;]*?\{/.exec(src.slice(from));
  return m ? from + m.index + m[0].length - 1 : -1;
}

/**
 * The TOP-LEVEL member names of one anonymous-object body.
 *
 * Both C# spellings, because the key this reader most needs is written the second way:
 *
 *   `stage = "transform"`   explicit  → `stage`
 *   `error` / `lastError`   SHORTHAND → the local's name is the key
 *
 * `DeliveryDeadLettered` writes `new { attemptCount, lastError, deadLetteredAt = now }`,
 * so a reader that only matched `name =` would miss `lastError` — the one key that
 * carries why a delivery gave up. Nested bodies are skipped by depth, so
 * `blockers[].message` does not surface as a top-level `message`.
 */
export function parsePayloadKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') {
      i += 1;
      while (i < body.length && body[i] !== '"') i += body[i] === "\\" ? 2 : 1;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));

  for (const raw of parts) {
    const part = raw.replace(/\/\/[^\n]*/g, "").trim();
    if (!part) continue;
    const assigned = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(part);
    if (assigned) {
      keys.push(assigned[1]);
      continue;
    }
    // Shorthand. `filter!.PoNumberPrefix` infers to the LAST segment, which is how C#
    // names an inferred member from a property access.
    const shorthand = /^([A-Za-z_][\w.!?]*)$/.exec(part);
    if (shorthand) {
      const segments = shorthand[1].replace(/[!?]/g, "").split(".");
      keys.push(segments[segments.length - 1]);
    }
  }
  return keys;
}

/**
 * Every (action → payload keys) pair a source file writes.
 *
 * The backend builds an audit payload two ways, and both are read:
 *
 *   A. `BuildAuditEvent(org, id, "Action", new { … })` — the payload is the fourth
 *      argument, lexically after the action.
 *   B. `var <ident> = JsonSerializer.Serialize(new { … });` … then a separate
 *      `new AuditEvent { … Action = "X", Payload = JsonDocument.Parse(<ident>) }`.
 *
 * Shape B BINDS ON THE IDENTIFIER rather than scanning backwards from the action.
 * Proximity is not reliable here in either direction: `OpsController.cs`'s
 * `DeliveryRequeuedByOperator` builds its payload AFTER the `Action =` line, and the
 * largest backward gap elsewhere is 23 lines, so any fixed window is one refactor
 * from silently reading the previous write site's payload — a mirror that confirms
 * the wrong keys. The variable name is the actual link, and it varies (`payload`,
 * `requeuePayload`, `failPayload`, `recoverPayload`), so it is read rather than assumed.
 *
 * Not every site is followable: `AcceptanceOverrideUsed` is built in `AcceptanceGate.cs`
 * and added in `OrderTransformService.cs`, and the `admin.*` / `inbound_email.*` families
 * go through helpers with the action as a parameter. That is fine as long as it is not
 * silent — the callers assert that every action whose reason key the manifest declares
 * was really found here, so a site this reader cannot follow fails the build rather
 * than contributing nothing to a diff that then passes.
 */
export function parseAuditPayloads(src: string, consts: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (action: string, keys: string[]) => {
    const set = out.get(action) ?? new Set<string>();
    for (const k of keys) set.add(k);
    out.set(action, set);
  };

  const bodyAt = (from: number): string | null => {
    const brace = newObjectBraceAt(src, from);
    return brace < 0 ? null : objectBody(src, brace);
  };

  // Shape A. One site can name two actions (`OrdersController.cs`'s ternary), and both
  // arms share the one payload.
  for (const m of src.matchAll(/BuildAuditEvent\(\s*[^,()]+,\s*[^,()]+,\s*([^,]+),/g)) {
    const actions = resolveActionExpr(m[1], consts);
    if (actions.length === 0) continue;
    const body = bodyAt(m.index + m[0].length);
    if (body === null) continue;
    for (const a of actions) add(a, parsePayloadKeys(body));
  }

  // Shape B, in two passes: every `<ident> = …Serialize(new { … })` in the file, then
  // each `Action = "X"` initialiser resolved through the identifier its `Payload =`
  // line names.
  //
  // THE IDENTIFIER IS NOT UNIQUE. `DeliveryService.cs` builds four different audit
  // payloads and calls the local `payload` every time, so a name→body map keyed on the
  // identifier alone keeps whichever came last: the first run of this diff reported
  // `DeliveryUnconfirmed` and `DeliveryHeldForBilling` as writing
  // `attemptCount, deadLetteredAt, lastError`, which is `DeliveryDeadLettered`'s
  // payload from further down the file. Every occurrence is kept with its offset, and
  // a use resolves to the nearest binding of that name BEFORE it — ordinary lexical
  // scoping. Falling forward to the first binding after the use covers
  // `OpsController.cs`, which assigns its payload below the `Action =` line.
  const bindings: Array<{ at: number; ident: string; body: string }> = [];
  for (const m of src.matchAll(/\b(\w+)\s*=\s*[\w.]*JsonSerializer\.Serialize\(/g)) {
    const body = bodyAt(m.index + m[0].length);
    if (body !== null) bindings.push({ at: m.index, ident: m[1], body });
  }

  const bindingFor = (ident: string, useAt: number): string | undefined => {
    const named = bindings.filter((b) => b.ident === ident);
    const before = named.filter((b) => b.at < useAt);
    if (before.length > 0) return before[before.length - 1].body;
    const after = named.find((b) => b.at > useAt);
    return after?.body;
  };

  for (const m of src.matchAll(/\bAction\s*=\s*"([^"]+)"/g)) {
    // The initialiser this `Action =` belongs to, bounded so a `Payload =` from the
    // NEXT audit write cannot be attributed to this one.
    const windowEnd = src.indexOf('Action = "', m.index + m[0].length);
    const region = src.slice(m.index, windowEnd < 0 ? src.length : windowEnd);
    const ref = /Payload\s*=\s*[\w.]*JsonDocument\.Parse\(\s*(\w+)\s*\)/.exec(region);
    if (!ref) continue;
    const body = bindingFor(ref[1], m.index);
    if (body === undefined) continue;
    add(m[1], parsePayloadKeys(body));
  }

  return out;
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

describe("audit-payload parsers (fixture — runs everywhere)", () => {
  /**
   * The four payload shapes the backend really writes, including the two that broke
   * the first version of this reader.
   */
  const FIXTURE = `
public static class AcceptanceGateAudit
{
    public const string BlockedAction = "AcceptanceBlocked";
}

public class Sample
{
    void A() {
        _db.AuditEvents.Add(OrderServiceShared.BuildAuditEvent(organisationId, orderId, "TransformFailed", new
        {
            error,
            stage = "transform",
        }));
        _db.AuditEvents.Add(OrderServiceShared.BuildAuditEvent(
            orgId, id, AcceptanceGateAudit.BlockedAction, new
            {
                blockers = gate.Blockers.Select(b => new { code = b.Code, message = b.Message }).ToList(),
                stage    = "transform",
            }));

        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            channel = config.Protocol,
            detail = parkReason,
        });
        _db.AuditEvents.Add(new Core.Entities.AuditEvent
        {
            Action = "DeliveryUnconfirmed",
            Payload = System.Text.Json.JsonDocument.Parse(payload),
        });

        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            attemptCount,
            lastError,
            deadLetteredAt = now,
        });
        _db.AuditEvents.Add(new Core.Entities.AuditEvent
        {
            Action = "DeliveryDeadLettered",
            Payload = System.Text.Json.JsonDocument.Parse(payload),
        });

        _db.AuditEvents.Add(new Core.Entities.AuditEvent
        {
            Action = "DeliveryRequeuedByOperator",
            Payload = System.Text.Json.JsonDocument.Parse(requeuePayload),
        });
        var requeuePayload = System.Text.Json.JsonSerializer.Serialize(new
        {
            reason = "OpsRequeueDelivery",
            detail = "An operator put this back on the queue.",
        });
    }
}`;

  const keys = () => parseAuditPayloads(FIXTURE, parseActionConstants(FIXTURE));

  test("reads SHORTHAND members, not only `name = value` ones", () => {
    // `lastError` is the single most load-bearing key this reader has to find — it is
    // the only explanation a dead-lettered delivery carries — and it is written
    // shorthand. A `\\w+\\s*=` regex misses it entirely and the diff goes quiet.
    expect([...keys().get("DeliveryDeadLettered")!]).toEqual(
      expect.arrayContaining(["attemptCount", "lastError", "deadLetteredAt"]),
    );
    expect([...keys().get("TransformFailed")!]).toEqual(expect.arrayContaining(["error", "stage"]));
  });

  test("keeps nested members out of the top-level key set", () => {
    // `blockers[]`'s elements carry `message`. If that surfaced as a top-level key,
    // the manifest could declare `AcceptanceBlocked.message` and the diff would agree
    // with a key no payload has.
    const acceptance = keys().get("AcceptanceBlocked")!;
    expect([...acceptance]).toEqual(expect.arrayContaining(["blockers", "stage"]));
    expect([...acceptance]).not.toContain("message");
    expect([...acceptance]).not.toContain("code");
  });

  test("binds a reused payload identifier to the NEAREST preceding one", () => {
    // THE DEFECT, VERBATIM. `DeliveryService.cs` builds four audit payloads and names
    // the local `payload` every time. The first version of this reader kept a
    // name→body map, so the last binding in the file won and the diff reported
    // `DeliveryUnconfirmed` as writing `attemptCount, deadLetteredAt, lastError` —
    // `DeliveryDeadLettered`'s payload. It would have accepted `lastError` as
    // `DeliveryUnconfirmed`'s reason key, and the log would have shown nothing.
    const unconfirmed = keys().get("DeliveryUnconfirmed")!;
    expect([...unconfirmed]).toEqual(expect.arrayContaining(["channel", "detail"]));
    expect([...unconfirmed]).not.toContain("lastError");
    expect([...unconfirmed]).not.toContain("attemptCount");
  });

  test("follows a payload assigned AFTER the action line", () => {
    // `OpsController.cs` writes `Action = …` first and builds the payload below it, so
    // a backwards-only search reads the previous write site's object instead.
    expect([...keys().get("DeliveryRequeuedByOperator")!]).toEqual(
      expect.arrayContaining(["reason", "detail"]),
    );
  });

  test("finds every action that has a parseable payload (anti-vacuity)", () => {
    // A reader that matched nothing would leave every diff below passing by default.
    expect(keys().size).toBe(5);
    for (const [, set] of keys()) expect(set.size).toBeGreaterThan(0);
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
type Scan = {
  root: string;
  consts: Map<string, string>;
  byFile: Map<string, string[]>;
  backendActions: string[];
  /** action (lower-cased) → every top-level payload key the backend writes for it. */
  payloadKeys: Map<string, Set<string>>;
};
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
  const payloadKeys = new Map<string, Set<string>>();
  for (const rel of WRITER_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, "utf8");
    byFile.set(rel, parseAuditActions(src, consts));
    for (const [action, keys] of parseAuditPayloads(src, consts)) {
      const set = payloadKeys.get(action.toLowerCase()) ?? new Set<string>();
      for (const k of keys) set.add(k);
      payloadKeys.set(action.toLowerCase(), set);
    }
  }

  cached = { root, consts, byFile, backendActions: [...new Set([...byFile.values()].flat())], payloadKeys };
  return cached;
}

describe("the backend-required gate (fixture — runs everywhere)", () => {
  test("no checkout is a legitimate skip when the mirror is not required", () => {
    expect(mirrorGateFailure({ backendRoot: null, required: false })).toBeNull();
  });

  test("no checkout is a FAILURE when CI required the mirror", () => {
    const failure = mirrorGateFailure({ backendRoot: null, required: true });
    expect(failure).toContain("PROCULINK_REQUIRE_BACKEND_MIRROR=1");
    expect(failure).toContain("src/lib/auditActionManifest.ts");
  });

  test("a resolved checkout passes the gate either way", () => {
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", required: true })).toBeNull();
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", required: false })).toBeNull();
  });
});

describe("auditActionManifest mirrors the backend's audit vocabulary", () => {
  test("the diff either runs, or is skipped for a declared reason", () => {
    // Runs everywhere, including CI. A skip must be attributable, never silent — and where
    // the backend-mirror job set PROCULINK_REQUIRE_BACKEND_MIRROR, not even attributable is
    // enough: there the checkout is the job's own responsibility.
    expect(mirrorGateFailure({ backendRoot: BACKEND, required: REQUIRE_MIRROR })).toBeNull();
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

  test.skipIf(!BACKEND)("the payload reader found a realistic number of sites (anti-vacuity)", () => {
    const { payloadKeys } = scan();
    // Must come before the key diff below. A reader that stopped matching would make
    // that diff vacuous in the most dangerous direction: every declared key would be
    // "not contradicted" because nothing was parsed at all, and the delivery log would
    // go back to showing no reason with a green test suite over it.
    expect(payloadKeys.size).toBeGreaterThanOrEqual(20);
    const withKeys = [...payloadKeys.values()].filter((s) => s.size > 0);
    expect(withKeys.length).toBeGreaterThanOrEqual(20);
  });

  test.skipIf(!BACKEND)("every action whose reason key is declared was really parsed", () => {
    const { payloadKeys } = scan();
    // The reader cannot follow every write shape — a payload built in one file and
    // added in another, or passed through a helper. That is tolerable for actions this
    // manifest says nothing about, and NOT tolerable for one whose reason key it
    // asserts: an unparsed action would silently exempt itself from the diff below.
    const unparsed = EXPLAINED_AUDIT_ACTIONS.filter((a) => !payloadKeys.has(a.toLowerCase())).sort();
    expect(
      unparsed,
      `these declare reasonKeys but no payload site was parsed for them: ${unparsed.join(", ")}`,
    ).toEqual([]);
  });

  test.skipIf(!BACKEND)("every declared reason key is one the backend really writes", () => {
    const { payloadKeys } = scan();
    // The drift that matters. `reasonKeys` decides what the delivery log shows as the
    // cause of a failure; naming a key the backend does not write fails SILENTLY —
    // the reason simply never appears, which is indistinguishable from the defect this
    // field was added to fix, and the render tests still pass because they supply the
    // payload themselves. So the names are diffed against the C# rather than trusted.
    const wrong: string[] = [];
    for (const fact of AUDIT_ACTION_FACTS) {
      if (fact.reasonKeys.length === 0) continue;
      const written = payloadKeys.get(fact.action.toLowerCase());
      if (!written) continue; // covered by the test above
      for (const key of fact.reasonKeys) {
        if (!written.has(key)) wrong.push(`${fact.action}.${key} (writes: ${[...written].sort().join(", ")})`);
      }
    }
    expect(wrong, `reasonKeys naming a payload key the backend does not write: ${wrong.join(" · ")}`).toEqual([]);
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
