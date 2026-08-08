// ─────────────────────────────────────────────────────────────────────────────
// The two different 403s, and the guard that keeps them apart.
//
// The backend added an organisation-admin role and enforced it server-side on twelve
// destructive actions, refusing with 403 `{ error: "requires_org_admin", message }`. Those same
// endpoints could already refuse with a PLAN gate — `{ error: "<capability>_requires_<plan>",
// upgradeUrl }` — and the two have opposite fixes:
//
//     requires_org_admin      another person in your organisation can do this. Ask them.
//     <capability>_requires_<plan>   nobody in your organisation can, until you upgrade.
//
// Getting this wrong is worse than the raw code it replaces. "Upgrade your plan" shown to
// someone who merely lacks a role is a fabricated reason to spend money; "ask an administrator"
// shown to an organisation that needs a bigger plan sends them to a colleague who is equally
// blocked. So every assertion below runs in BOTH directions. A guard that only checked the new
// case would stay green with the two branches collapsed into one, which is precisely the
// mutation this file exists to catch.
//
// Anti-vacuity: the swept corpus is asserted non-empty and the exact size expected, every entry
// is a real exported function (a rename is a compile error, not a silent skip), and a plan-gate
// corpus is derived from the plan ladder rather than hand-typed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { readCsLiteral } from "./csLiterals";
import {
  ORG_ADMIN_ERROR_CODE,
  isOrgAdminError,
  isOrgAdminRefusal,
  orgAdminMessage,
  isPlanGateError,
  planGateMessage,
} from "@/lib/planGate";
import { classifyApiFailure } from "@/lib/apiFailure";
import { PLAN_BY_ID } from "@/lib/plans";

import { createCheckoutSession, createPortalSession, getBillingStatus } from "@/lib/api/billing";
import { updateEmailSettings, updateSftpSettings, updateS3Settings } from "@/lib/api/settings";
import { upsertDeliveryConfig, deleteDeliveryConfig } from "@/lib/api/delivery";
import {
  createApiKey,
  createIntegration,
  publishConnectionRevision,
  rollbackConnectionRevision,
} from "@/lib/api-client";
import type { UpsertDeliveryConfigRequest } from "@/lib/api/types";

// ── The two bodies, exactly as the API sends them ────────────────────────────

/** `RequireOrgAdminAttribute.OnAuthorization` writes `{ error = ErrorCode, message = Message }`. */
const ORG_ADMIN_403 = JSON.stringify({
  error: ORG_ADMIN_ERROR_CODE,
  message:
    "This action is restricted to organisation administrators. Ask an administrator in your " +
    "organisation to make this change.",
});

/** A real plan gate on one of the same endpoints (`PUT /api/settings/sftp` is both-gated). */
const PLAN_GATE_403 = JSON.stringify({
  error: "sftp_ingestion_requires_growth",
  upgradeUrl: "/settings?tab=billing",
});

function respondWith(body: string, status: number) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** authHeader() waits up to 5s for Clerk unless it is already loaded — keep the tests fast. */
beforeEach(() => {
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true, session: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

// ── The swept corpus ─────────────────────────────────────────────────────────
//
// Hand-authored, because no scanner can infer which endpoints the backend chose to gate — the
// same reason the backend's own `OrgAdminGateIlScanner.DestructivePrimitives` is hand-authored.
// Everything else is derived: each `call` is the REAL exported client function, so renaming or
// deleting one fails the type-check rather than quietly shrinking the sweep.

interface GatedCall {
  /** The backend route, for a failure message that names what broke. */
  readonly endpoint: string;
  /** Why this one warrants an administrator. Mirrors the table in the backend PR. */
  readonly why: string;
  readonly call: () => Promise<unknown>;
  /**
   * True when this call site ALREADY surfaced a plan-gate code before the org-admin branch was
   * added, and must still. False where it never did — recorded rather than glossed, so nobody
   * reads a uniform assertion as a promise the code does not make.
   */
  readonly planGateSurvives: boolean;
}

const DELIVERY_CONFIG: UpsertDeliveryConfigRequest = {
  protocol: "http",
  autoDeliver: false,
  configJson: "{}",
};

const GATED: readonly GatedCall[] = [
  {
    endpoint: "POST /api/billing/portal",
    why: "The Stripe Billing Portal is where the subscription is CANCELLED, which stops every ingest path at once with nothing queued for later.",
    call: () => createPortalSession(),
    planGateSurvives: false,
  },
  {
    endpoint: "POST /api/billing/checkout",
    why: "Commits the organisation to a recurring charge.",
    call: () => createCheckoutSession("growth", "monthly"),
    planGateSurvives: false,
  },
  {
    endpoint: "POST /api/api-keys",
    why: "Mints a bearer credential with org-wide machine access, shown once, attributed to nobody.",
    call: () => createApiKey("qa"),
    planGateSurvives: true,
  },
  {
    endpoint: "POST /api/integrations",
    why: "Stands up an outbound subscription shipping every matching order's payload to an arbitrary URL.",
    call: () => createIntegration({ platform: "custom", eventType: "order.delivered", targetUrl: "https://example.test/hook" }),
    planGateSurvives: true,
  },
  {
    endpoint: "PUT /api/settings/email",
    why: "IMAP host and credentials: a member could repoint ingestion at a mailbox they control and feed the organisation fabricated purchase orders.",
    call: () =>
      updateEmailSettings({ enabled: true, host: "imap.example.test", port: 993, useSsl: true, username: "ops", folder: "INBOX" }),
    planGateSurvives: true,
  },
  {
    endpoint: "PUT /api/settings/sftp",
    why: "The same, for the SFTP poller: host, credentials and the supplier arriving documents are attributed to.",
    call: () =>
      updateSftpSettings({ enabled: true, host: "sftp.example.test", port: 22, username: "ops", remoteDirectory: "/in", defaultSupplierId: null }),
    planGateSurvives: true,
  },
  {
    endpoint: "PUT /api/settings/s3",
    why: "The same, for the S3/R2 poller: bucket, keys and the supplier arriving documents are attributed to.",
    call: () =>
      updateS3Settings({ enabled: true, bucketName: "b", keyPrefix: "", region: "eu", accessKeyId: "k", defaultSupplierId: null }),
    planGateSurvives: true,
  },
  {
    endpoint: "PUT /api/suppliers/{id}/delivery-config",
    why: "Writes the endpoint, protocol and credentials every future order for that supplier is sent to.",
    call: () => upsertDeliveryConfig("sup-1", DELIVERY_CONFIG),
    planGateSurvives: true,
  },
  {
    endpoint: "DELETE /api/suppliers/{id}/delivery-config",
    why: "Destroys that route and its credentials; every subsequent send for the supplier fails.",
    call: () => deleteDeliveryConfig("sup-1"),
    planGateSurvives: true,
  },
  {
    endpoint: "POST /api/connections/{c}/revisions/{r}/publish",
    why: "Moves the connection's ACTIVE pointer — from here the revision is what pinned orders deliver through.",
    call: () => publishConnectionRevision("conn-1", "rev-1"),
    planGateSurvives: true,
  },
  {
    endpoint: "POST /api/connections/{c}/revisions/{r}/rollback",
    why: "Publishes a previously-archived bundle nobody re-approved and moves the active pointer to it: redirection expressed as an undo.",
    call: () => rollbackConnectionRevision("conn-1", "rev-1"),
    // It never read the body on a non-409/404 failure, so it never carried a plan-gate code
    // either. Adding one is a separate change from telling the two 403s apart.
    planGateSurvives: false,
  },
];

/**
 * The twelfth gated endpoint has no frontend caller at all, so there is no copy to fix. Declared
 * here rather than omitted, so the count below still ties to the backend's twelve and the gap is
 * visible instead of looking like an oversight.
 */
const NOT_CALLED_FROM_THE_FRONTEND = [
  {
    endpoint: "POST /api/orders/{id}/acceptance-gate/override",
    why: "No screen offers it. `src/test/endpoint-reachability.test.ts` already lists it under UNCALLED_PENDING_DECISION, and that guard fails the moment a caller appears — at which point this entry moves into GATED.",
  },
] as const;

describe("the swept corpus is real", () => {
  it("covers every endpoint the backend gates, and nothing is silently missing", () => {
    // The floor. A corpus that emptied — a bad import, an entry deleted — would make every
    // assertion below pass while calling nothing at all.
    expect(GATED.length, "the sweep must really have call sites in it").toBe(11);
    expect(
      GATED.length + NOT_CALLED_FROM_THE_FRONTEND.length,
      "the backend gates twelve actions; every one is either swept here or declared uncalled",
    ).toBe(12);

    for (const entry of [...GATED, ...NOT_CALLED_FROM_THE_FRONTEND]) {
      expect(typeof entry.endpoint).toBe("string");
      expect(entry.endpoint.length).toBeGreaterThan(0);
      // Every entry must state why an administrator is warranted, the same discipline the
      // backend guard imposes on its declared primitives.
      expect(entry.why.length, `${entry.endpoint} must say why it warrants an administrator`).toBeGreaterThan(30);
    }

    for (const entry of GATED) {
      expect(typeof entry.call, `${entry.endpoint} must resolve to a real client function`).toBe("function");
    }
  });
});

// ── Direction 1: the role refusal ────────────────────────────────────────────

describe("a requires_org_admin 403 names the administrator and never sells an upgrade", () => {
  for (const { endpoint, call } of GATED) {
    it(endpoint, async () => {
      respondWith(ORG_ADMIN_403, 403);

      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );

      expect(err, `${endpoint} resolved instead of rejecting`).toBeInstanceOf(Error);
      const message = (err as Error).message;

      expect(message, `${endpoint} must say who can do this`).toBe(orgAdminMessage());

      // The direction a collapsed branch breaks: a role refusal must not read as a plan gate,
      // or the surfaces that branch on `isPlanGateError` will offer an upgrade nobody needs.
      expect(isPlanGateError(message), `${endpoint} must not read as a plan gate`).toBe(false);
      expect(message).not.toMatch(/upgrade|plan|billing|subscri|€/i);
      expect(message).not.toBe(planGateMessage(message));
    });
  }

  it("is recognisable from the thrown value once the api layer has swapped in the sentence", async () => {
    respondWith(ORG_ADMIN_403, 403);
    const err = await createPortalSession().then(
      () => null,
      (e: unknown) => e,
    );
    expect(isOrgAdminRefusal(err)).toBe(true);
  });

  it("classifies as a permission boundary, not a plan gate, and is never retried", async () => {
    respondWith(ORG_ADMIN_403, 403);
    const err = await createApiKey("qa").then(
      () => null,
      (e: unknown) => e,
    );

    const failure = classifyApiFailure(err);
    expect(failure.kind).toBe("forbidden");
    expect(failure.kind).not.toBe("plan_gate");
    expect(failure.retryable).toBe(false);
    expect(failure.maxRetries).toBe(0);
  });
});

// ── Direction 2: the plan gate, unchanged ────────────────────────────────────

describe("a plan-gate 403 keeps its own meaning and never says 'ask an administrator'", () => {
  for (const { endpoint, call, planGateSurvives } of GATED) {
    it(endpoint, async () => {
      respondWith(PLAN_GATE_403, 403);

      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );

      expect(err, `${endpoint} resolved instead of rejecting`).toBeInstanceOf(Error);
      const message = (err as Error).message;

      // The other direction a collapsed branch breaks.
      expect(message, `${endpoint} must not answer a plan problem with a role answer`).not.toBe(orgAdminMessage());
      expect(isOrgAdminRefusal(err), `${endpoint} must not read as a role refusal`).toBe(false);
      expect(message).not.toMatch(/administrator/i);

      if (planGateSurvives) {
        expect(isPlanGateError(message), `${endpoint} used to surface the plan-gate code and must still`).toBe(true);
        expect(planGateMessage(message)).toContain("Growth");
      }
    });
  }

  it("the upgrade url still survives on the sites that carried the whole body", async () => {
    // `planGateUpgradeUrl` greps `"upgradeUrl"` back out of the RAW message text. A previous
    // packet broke it by sanitising that text away, so this pins that the org-admin branch did
    // not do the same thing on its way past.
    const { planGateUpgradeUrl } = await import("@/lib/planGate");
    respondWith(PLAN_GATE_403, 403);

    const err = await publishConnectionRevision("conn-1", "rev-1").then(
      () => null,
      (e: unknown) => e,
    );

    expect(planGateUpgradeUrl((err as Error).message)).toBe("/settings?tab=billing");
  });
});

// ── The discriminator itself ─────────────────────────────────────────────────

describe("the two codes cannot be read as each other", () => {
  // Derived from the plan ladder rather than typed out, so a re-tiered or newly added plan is
  // covered without anyone remembering to extend a list here.
  const CAPABILITIES = [
    "sftp_ingestion",
    "s3_ingestion",
    "email_ingestion",
    "webhook_delivery",
    "erp_delivery",
    "cxml_output",
    "advanced_audit",
    "catalog_sync",
    "bulk_mapping",
  ];
  const PLAN_GATE_CODES = Object.keys(PLAN_BY_ID).flatMap((plan) =>
    CAPABILITIES.map((capability) => `${capability}_requires_${plan}`),
  );

  it("the org-admin code is not a plan gate, as a bare code or inside the whole body", () => {
    expect(isOrgAdminError(ORG_ADMIN_ERROR_CODE)).toBe(true);
    expect(isPlanGateError(ORG_ADMIN_ERROR_CODE)).toBe(false);

    expect(isOrgAdminError(ORG_ADMIN_403)).toBe(true);
    expect(isPlanGateError(ORG_ADMIN_403)).toBe(false);
  });

  it("no plan-gate code the ladder can produce is the org-admin refusal", () => {
    expect(PLAN_GATE_CODES.length, "the derived plan-gate corpus must not be empty").toBeGreaterThanOrEqual(
      CAPABILITIES.length * 6,
    );

    for (const code of PLAN_GATE_CODES) {
      expect(isPlanGateError(code), `${code} must be a plan gate — otherwise this corpus proves nothing`).toBe(true);
      expect(isOrgAdminError(code), `${code} must not be read as a role refusal`).toBe(false);
    }
  });

  it("only the whole token matches, so a lookalike falls through to the generic refusal", () => {
    // Not a code the API emits. Matching it would mean guessing at a capability gate.
    expect(isOrgAdminError("webhook_delivery_requires_org_admin")).toBe(false);
    expect(isOrgAdminError("requires_org_administrator")).toBe(false);
    expect(isOrgAdminError("org_admin")).toBe(false);
    expect(isOrgAdminError("requires_attention")).toBe(false);
    expect(isOrgAdminError("")).toBe(false);
    expect(isOrgAdminError(null)).toBe(false);

    // …while every shape the API really produces does match.
    expect(isOrgAdminError("requires_org_admin")).toBe(true);
    expect(isOrgAdminError('{"error":"requires_org_admin"}')).toBe(true);
    expect(isOrgAdminError("api-keys POST: requires_org_admin")).toBe(true);
  });
});

// ── The ungated control ──────────────────────────────────────────────────────

describe("the negative control", () => {
  it("GET /api/billing/status is deliberately ungated and is not rewritten", async () => {
    // The backend pins `BillingController.GetStatus` as its own negative control. If the
    // administrator sentence appeared here it would mean the substitution had escaped the call
    // sites it was wired into, and the sweep above would be proving nothing.
    respondWith(ORG_ADMIN_403, 403);

    const err = await getBillingStatus().then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as Error).message).not.toBe(orgAdminMessage());
  });
});

// ── The code, pinned to the C# that emits it ─────────────────────────────────
//
// Resolution follows `src/test/backendMirror.test.ts` and `src/test/backendCopyVocabulary.test.ts`:
// PROCULINK_BACKEND_PATH first, then a walk-up for a sibling ProcuLink checkout (the frontend is
// usually opened as a git worktree, so `../ProcuLink` does not resolve). Skipped when no backend
// is reachable, and a hard failure when a run claimed it would enforce the mirror — the
// `backend-mirror` CI job sets both variables.

const ATTRIBUTE_REL = "ProcuLink.Api/Auth/RequireOrgAdminAttribute.cs";
const ROOT = process.cwd();

function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, ATTRIBUTE_REL))) return fromEnv;

  let dir = resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, ATTRIBUTE_REL))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

describe("ORG_ADMIN_ERROR_CODE mirrors the C# constant", () => {
  it("this run either diffed against the backend, or was allowed not to", () => {
    const excuse =
      BACKEND === null && REQUIRE_MIRROR
        ? "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout containing " +
          `${ATTRIBUTE_REL} was reachable, so ORG_ADMIN_ERROR_CODE was not diffed against the C# ` +
          "that emits it. Set PROCULINK_BACKEND_PATH to a ProcuLink checkout (the backend-mirror " +
          "job in .github/workflows/ci.yml does this with actions/checkout)."
        : null;
    expect(excuse, excuse ?? "").toBeNull();
  });

  it.skipIf(!BACKEND)("is byte-for-byte the literal RequireOrgAdminAttribute.ErrorCode holds", () => {
    const cs = readFileSync(join(BACKEND as string, ATTRIBUTE_REL), "utf8");

    // `public const string ErrorCode = "requires_org_admin";`
    const declaration = /\bconst\s+string\s+ErrorCode\s*=\s*/.exec(cs);
    expect(declaration, `${ATTRIBUTE_REL} no longer declares a const string ErrorCode`).not.toBeNull();

    const literal = readCsLiteral(cs, (declaration as RegExpExecArray).index + (declaration as RegExpExecArray)[0].length);
    expect(literal, "the ErrorCode declaration did not parse as a C# string literal").not.toBeNull();
    // Anti-vacuity: an empty parse would compare equal to nothing useful.
    expect((literal as { text: string }).text.length).toBeGreaterThan(0);

    expect((literal as { text: string }).text).toBe(ORG_ADMIN_ERROR_CODE);
  });
});
