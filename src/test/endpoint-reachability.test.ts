// ENDPOINT REACHABILITY GUARD — the other direction of "no surface without a
// consumer", and the one nothing was watching.
//
// WHY IT LIVES HERE, AND NOT IN THE BACKEND. The question is "does anything call
// this endpoint?", and only this repo can answer the second half of it. The API
// is 90 state-changing controller actions; the callers are ~130 fetch sites
// spread over src/lib/api-client.ts, seven modules under src/lib/api/, and
// src/lib/admin-guard.ts — three of which assemble their paths through a private
// `apiFetch` wrapper, so the path never appears next to the word `api`. A guard
// in the backend would have to model all of that from the outside. A guard here
// owns it exactly, and reads the C# for the easy half.
//
// The precedent for reading the C# is already in this repo:
// src/test/backendMirror.test.ts locates a sibling ProcuLink checkout, or says
// out loud that it could not. This file follows the same contract, for the same
// reason — the backend has NO cross-repo test infrastructure at all, and no
// OpenAPI document is committed in either repo, so there is nothing to diff
// against but the source.
//
//   • The PARSERS and the MATCHER run on every invocation, everywhere, against
//     inline fixtures. A parser that quietly stopped matching would otherwise
//     "prove" every endpoint is called by finding no endpoints.
//   • The CALLER SWEEP runs on every invocation too — it only needs this repo.
//   • The DIFF runs whenever a backend checkout is reachable. When it is not, it
//     is SKIPPED BY A DECLARED CONDITION with the reason on the record, never
//     silently passed.
//
// Run it deliberately with:
//   PROCULINK_BACKEND_PATH=/path/to/ProcuLink bunx vitest run src/test/endpoint-reachability.test.ts
//
// ── WHAT COUNTS AS A FAILURE ──────────────────────────────────────────────────
//
// A state-changing endpoint (POST/PUT/PATCH/DELETE) that no frontend call site
// reaches and that appears in NEITHER list below, each entry of which carries a
// written reason. Silence fails: an endpoint that nothing calls and nobody has
// explained is either a recovery door with no handle or dead code, and the two
// are indistinguishable from outside.
//
// The two lists are deliberately separate and must stay that way:
//
//   KNOWN_MACHINE_FACING       "this is fine, and here is who calls it" —
//                              ingress, provider webhooks, a documented runbook
//                              curl. Legitimately caller-free.
//   UNCALLED_PENDING_DECISION  "nobody calls this, and nobody has decided what
//                              to do about it" — an open question with a date on
//                              it, NOT a justification.
//
// The pending entries pass rather than fail, and that was a correction. Left
// failing, the pipeline could not go green until a product decision arrived,
// which trains people to stop reading CI and then masks the next real failure.
// A red nobody can clear today is noise with a good reason attached. So the gaps
// are tracked loudly instead: every entry reasoned, the whole set printed on
// every run, a fourteenth gap failing, and an entry that gains a caller failing.
//
// ── WHAT IT CANNOT SEE (established by trying to defeat it) ───────────────────
//
//   • A COMPUTED FINAL SEGMENT. api-client.ts builds
//     `/api/connections/${id}/revisions/${rid}/${action}` where `action` is a
//     "publish" | "archive" union. Crediting a computed segment against a
//     literal route segment would let one such template mark a whole controller
//     called, so it is refused — and the affected endpoints then appear
//     uncalled, which forces an allowlist entry naming the call site. Wrong in
//     the SAFE direction: it costs a reasoned entry, it never hides an endpoint.
//   • A PATH ASSEMBLED FROM A CONSTANT DECLARED IN ANOTHER MODULE. Nothing in
//     the importing file carries `${API_BASE_URL}`, so there is nothing to
//     resolve. Nothing does this today.
//   • A VERB SUPPLIED INDIRECTLY. The method is read as a literal in the call's
//     own options object, so a verb held in a variable — or defaulted inside a
//     wrapper — is not there to read and the call scores as GET. One level of
//     PATH indirection IS followed: `basePath()` in src/lib/api/catalogSources.ts
//     put three genuinely-called endpoints on the uncalled list until it was.
//
//     BOTH ARE PINNED AS FIXTURES in "WHAT THIS GUARD CANNOT SEE", because this
//     suite is green and a green suite gets read as coverage. Writing them down
//     as prose here is not enough; the header is also where this file twice
//     asserted a limitation that turned out to be false. It claimed a second hop
//     of indirection was invisible — the fixture showed it usually resolves,
//     because helper definitions are matched textually wherever they appear,
//     including inside another helper's body. Then it claimed a distant verb was
//     missed — the fixture showed each helper USE opens its own window, so the
//     distance never mattered. Both corrections came from writing the assertion.
//     That is the reason the fixtures exist and the reason to distrust this
//     paragraph without them.
//
//     Every one of these fails in the SAFE direction — the endpoint reads as
//     uncalled, which is noisy rather than silent.
//   • A ROUTE THAT IS NOT AN MVC ACTION. There are no minimal-API
//     Map{Post,Put,Patch,Delete} registrations in ProcuLink.Api today, and
//     `endpointCorpusIsWhole` fails if the controller sweep collapses — but a
//     minimal-API route added later would be invisible. Named here rather than
//     left to be discovered.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./sourceScan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC_DIR = path.join(ROOT, "src");

// ─── The allowlist ────────────────────────────────────────────────────────────
//
// An endpoint may live here ONLY with a reason that cites something a reviewer
// can open — a file path, a URL, an ISO date, or a WP-nn packet. The bar is
// deliberately the same as KNOWN_DEEP_LINK_ONLY's in route-reachability.test.ts,
// because it is the same escape hatch pointing the other way.
//
// Keys are `METHOD /path/with/{} for every dynamic segment`.

export const KNOWN_MACHINE_FACING: Record<string, string> = {
  // ── Machine-to-machine ingress. Called by a customer's ERP or middleware over
  //    an API key, never by this app.
  "POST /api/ingress/{}/orders":
    "Machine-to-machine PO ingress. IngressController carries " +
    "[Authorize(AuthenticationSchemes = \"ApiKey\")], not Clerk, and the URL is printed for the " +
    "customer to configure in SupplierDockProfile.tsx:1140 rather than called from here. " +
    "src/types/procurement.ts:61 documents the same shape.",
  "POST /api/ingress/{}/catalog/{}":
    "Machine-to-machine catalog push, same API-key scheme as the order ingress above. The URL is " +
    "rendered for the customer to paste into their system at SupplierDockProfile.tsx:1140; this " +
    "app never posts to it.",

  // ── Provider webhooks. The caller is Stripe / Postmark.
  "POST /api/billing/webhook":
    "Stripe calls this, not the browser. [AllowAnonymous] with signature verification; the URL is " +
    "configured in the Stripe dashboard. A frontend caller would be a bug — see " +
    "ProcuLink.Api/Services/StripeBillingService.cs for the other half of the integration.",
  "POST /api/inbound-email/postmark":
    "Postmark's inbound-webhook callback. InboundEmailController has no [Authorize] and is reached " +
    "by the mail provider; the frontend configures the address in settings and never posts here. " +
    "Registered 2026-08-06 with the rest of this allowlist.",
  "POST /api/inbound-email/postmark-bounce":
    "The OUTBOUND half of the same provider relationship, added by ProcuLink #216 (B-12): Postmark " +
    "POSTs here when a purchase order we emailed to a supplier hard-bounces or is reported as spam, " +
    "and the handler moves the order off `delivered`. Until it existed a mistyped supplier address " +
    "read as delivered forever. Same shared-token authentication as the inbound half, URL configured " +
    "in the Postmark dashboard (contract: https://postmarkapp.com/developer/webhooks/bounce-webhook), " +
    "so a frontend caller would be a bug. Backend handler: " +
    "ProcuLink.Infrastructure/Services/Delivery/DeliveryBounceHandler.cs. Registered 2026-08-15.",

  // ── Operator tooling with a documented out-of-band caller.
  "POST /api/admin/organisations/{}/account-status":
    "Run by hand from the admin runbook, not from a screen: " +
    "src/app/(app)/admin/guides/onboard-a-new-client/content.mdx:82 spells out the curl against " +
    "`$API_BASE/api/admin/organisations/$ORG_ID/account-status`. [AdminOnly], cross-tenant. The " +
    "other AdminController writes have no such caller and are deliberately left failing.",

  // ── Reached by a computed final segment, which the matcher refuses to credit.
  //    See "WHAT IT CANNOT SEE" above: the refusal is deliberate.
  "POST /api/connections/{}/revisions/{}/publish":
    "Called, but through a computed segment the matcher will not credit: api-client.ts builds " +
    "`/api/connections/${connectionId}/revisions/${revisionId}/${action}` where action is the " +
    "union \"publish\" | \"archive\". Crediting a computed segment against a literal one would let " +
    "a single template mark a whole controller reachable.",
  "POST /api/connections/{}/revisions/{}/archive":
    "The other half of the same computed-segment call in src/lib/api-client.ts — see the publish " +
    "entry directly above for why the matcher refuses to credit it structurally.",
};

/**
 * THE SECOND LIST, AND IT IS NOT THE FIRST ONE.
 *
 * KNOWN_MACHINE_FACING above means "this is fine, and here is who calls it".
 * This means "**nobody calls this, and nobody has decided what to do about it
 * yet**". The two must never be blurred together: an entry here is an open
 * question with a date on it, not a justification.
 *
 * Every one is a state-changing endpoint the whole frontend never calls. Two
 * were named by the audit that commissioned this guard, both documented in
 * their own source as recovery doors — including
 * `DELETE /api/suppliers/{id}/po-mapping/output-tree`, whose docstring calls it
 * "the recovery door for a layout that cannot deliver this supplier's format".
 * A door with no handle. The other eleven the guard found on its own.
 *
 * These entries PASS, on purpose. They were left failing at first, and the
 * consequence was a pipeline that could not go green until a product decision
 * arrived — which trains everyone to stop reading CI and then masks the next
 * real failure. A red nobody can clear today is noise with a good reason
 * attached. So the gaps are tracked instead of shouted, and four mechanisms stop
 * that becoming forgetting:
 *
 *   1. every entry carries its own reason, held to the same citation bar;
 *   2. `printsThePendingSet` logs the count and the names on EVERY run, so the
 *      list appears in CI output rather than only in a file nobody opens;
 *   3. `theUncalledSetIsExactlyThis` fails when a FOURTEENTH endpoint goes
 *      uncalled — a new gap cannot quietly join the list;
 *   4. `anExcuseCannotOutliveItsReason` fails when an entry here gains a
 *      caller, so the list cannot rot into permanent cover.
 */
export const UNCALLED_PENDING_DECISION: Record<string, string> = {
  "POST /api/orders/{}/acceptance-gate/override":
    "PENDING A DECISION, 2026-08-06 — named by the v2 audit. " +
    "ProcuLink.Api/Controllers/OrderAcceptanceGateController.cs:74 documents it as the manual " +
    "override for a blocked acceptance gate, and no screen offers it. Build the control or delete " +
    "the endpoint; this entry is the open question, not an answer.",
  "DELETE /api/suppliers/{}/po-mapping/output-tree":
    "PENDING A DECISION, 2026-08-06 — named by the v2 audit. Its own docstring at " +
    "ProcuLink.Api/Controllers/SuppliersController.cs:584 calls it \"the recovery door for a " +
    "layout that cannot deliver this supplier's format\", and nothing in the mapper offers it. A " +
    "door with no handle.",
  "DELETE /api/admin/organisations/{}/orders/{}":
    "PENDING A DECISION, 2026-08-06 — single-order erasure, an data-protection obligation with no " +
    "operator surface. Unlike account-status it has no runbook entry either; " +
    "src/app/(app)/admin/guides/onboard-a-new-client/content.mdx documents no curl for it.",
  "POST /api/admin/organisations/{}/orders/bulk-erase":
    "PENDING A DECISION, 2026-08-06 — bulk erasure, same gap as the single-order erase above and " +
    "the same absence from src/app/(app)/admin/guides/onboard-a-new-client/content.mdx. The admin " +
    "screens call only /limits and /invoices.",
  "POST /api/admin/organisations/{}/retention":
    "PENDING A DECISION, 2026-08-06 — sets an organisation's retention window with no control " +
    "anywhere in src/app/(app)/admin/, and no documented curl. Wire it into the admin org view or " +
    "retire it.",
  "POST /api/billing/pilot/request-extension":
    "PENDING A DECISION, 2026-08-06 — a Pilot whose trial has ended can ask for an extension, and " +
    "no surface asks. The expiry copy in src/lib/plans.ts offers only Upgrade, so either the " +
    "billing screen grows the ask or this endpoint goes.",
  "POST /api/orders/{}/confirmation":
    "PENDING A DECISION, 2026-08-06 — records a supplier order confirmation. " +
    "ProcuLink.Api/Controllers/OrderConfirmationController.cs:45 is reachable only by an operator " +
    "with a REST client. Decide whether the inbound-confirmation flow is a product surface.",
  "POST /api/orders/{}/confirmation/upload":
    "PENDING A DECISION, 2026-08-06 — the file half of the confirmation flow above, at " +
    "ProcuLink.Api/Controllers/OrderConfirmationController.cs:88. It stands or falls with the same " +
    "decision and is listed separately so neither is lost.",
  "POST /api/orders/{}/mark-rejected":
    "PENDING A DECISION, 2026-08-06 — marks an order rejected by the supplier. The review screen " +
    "renders the resulting `rejected_by_supplier` status (src/lib/orderStatusManifest.ts) but " +
    "offers no way to set it, so today the status can only arrive from a delivery response.",
  "POST /api/schema/infer":
    "PENDING A DECISION, 2026-08-06 — schema inference over an uploaded sample. No caller in " +
    "src/lib/api-client.ts; the mapper's suggestion path uses the mapper-ai endpoints instead. " +
    "Either the mapper adopts it or it is dead engine surface.",
  "POST /api/schema/propose-mapping":
    "PENDING A DECISION, 2026-08-06 — the second half of the inference pair above, and uncalled " +
    "for the same reason. See ProcuLink.Api/Controllers/SchemaInferenceController.cs:96.",
  "POST /api/suppliers/{}/po-mapping/test":
    "PENDING A DECISION, 2026-08-06 — dry-runs a mapping against a sample without saving. " +
    "src/lib/api/mapping.ts calls PUT and DELETE on /po-mapping and never /test, so the mapper's " +
    "preview does not use it. Wire it into the preview or delete it.",
  "POST /api/suppliers/{}/profiles":
    "PENDING A DECISION, 2026-08-06 — upserts a supplier profile. src/lib/api-client.ts:1300 " +
    "documents the route in a comment beside two GET callers and never posts to it, which is how " +
    "a comment can look like a caller. Decide whether profiles are editable in-product.",
};

/**
 * The two lists together — every endpoint the guard will not fail on. Kept as a
 * derived union rather than one hand-maintained map, so the two categories
 * cannot be merged by accident: "something outside this app calls it" and
 * "nobody calls it and nobody has decided" are different claims, and a reader
 * has to be able to tell them apart.
 */
export const ACCOUNTED_FOR: Record<string, string> = {
  ...KNOWN_MACHINE_FACING,
  ...UNCALLED_PENDING_DECISION,
};

// ─── Half 1: what the frontend calls ──────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export const STATE_CHANGING: readonly HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

export interface ApiCall {
  method: HttpMethod;
  /** Normalized: every interpolated segment becomes `{}`. */
  path: string;
  source: string;
}

/** `${API_BASE_URL}` followed by the path, up to the closing quote/backtick. */
const FULL_PATH_RE = /\$\{\s*API_BASE_URL\s*\}(\/[^`"']*)/g;
/**
 * The three modules that define a private `apiFetch(path)` prefixing
 * `${API_BASE_URL}/api`. In those files the real endpoint path is a bare
 * fragment with neither `API_BASE_URL` nor `/api` anywhere on the line, so a
 * sweep for the full template sees none of their endpoints at all.
 */
const API_FETCH_WRAPPER_RE = /\$\{\s*API_BASE_URL\s*\}\/api\$\{/;
const BARE_FRAGMENT_RE = /`(\/[a-z][a-z0-9-]*(?:\/[^`]*)?)`/g;
/** `method: "POST"` — read from the call's own options object. */
const METHOD_RE = /\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i;
/**
 * A helper whose whole job is to return an API path —
 * `function basePath(supplierId) { return `${API_BASE_URL}/api/suppliers/${supplierId}/catalog/source`; }`
 * (src/lib/api/catalogSources.ts:181). The path literal then sits nowhere near
 * the verb, so a forward window from it reads GET for a PUT, a DELETE and a POST.
 *
 * This is adversarial-refutation question one — "can an endpoint dodge the guard
 * by being called through a helper?" — and the answer must be no for at least
 * the one level of indirection the codebase actually uses. Deeper chains, and a
 * path constant declared in ANOTHER module, are still invisible; they surface as
 * an uncalled endpoint, which is the safe direction.
 */
const PATH_HELPER_RE =
  /(?:function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s*|const\s+(\w+)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>\s*)`\$\{\s*API_BASE_URL\s*\}(\/[^`]*)`/g;

/** `/api/orders/${o.id}?tab=x` → `/api/orders/{}`. Null when it is not an API path. */
export function normalizeCallPath(raw: string): string | null {
  const cleaned = raw.split("?")[0].split("#")[0].trim();
  if (!cleaned.startsWith("/")) return null;
  const segments = cleaned
    .split("/")
    .filter(Boolean)
    .map((s) => (s.includes("${") ? "{}" : s));
  return `/${segments.join("/")}`;
}

/**
 * Every API call in one source file.
 *
 * The METHOD is read from a bounded window after the path literal, stopping at
 * the next path literal so one call's options can never be attributed to
 * another. Absent means GET, which is how the code is written — `fetch(url, {})`
 * with no method — and the whole corpus of state-changing calls names its verb
 * explicitly.
 */
export function extractApiCalls(text: string, source: string): ApiCall[] {
  const code = stripComments(text, "js");
  const found: ApiCall[] = [];
  const hits: { raw: string; at: number; end: number }[] = [];

  for (const m of code.matchAll(FULL_PATH_RE)) {
    hits.push({ raw: m[1], at: m.index!, end: m.index! + m[0].length });
  }
  if (API_FETCH_WRAPPER_RE.test(code)) {
    for (const m of code.matchAll(BARE_FRAGMENT_RE)) {
      hits.push({ raw: `/api${m[1]}`, at: m.index!, end: m.index! + m[0].length });
    }
  }
  // Follow one level of path-helper indirection, so the verb is read at the CALL
  // site and not at the definition where there is no verb to read.
  for (const def of code.matchAll(PATH_HELPER_RE)) {
    const name = def[1] ?? def[2];
    const helperPath = def[3];
    if (!name) continue;
    for (const use of code.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))) {
      if (use.index! >= def.index! && use.index! < def.index! + def[0].length) continue; // the definition
      const after = code.slice(use.index!, use.index! + 400);
      const close = after.indexOf(")");
      if (close === -1) continue;
      // `${basePath(id)}/test-fetch` — anything between the closing `)}` and the
      // backtick extends the helper's path.
      const tail = after.slice(close + 1);
      const suffix = /^\}([^`]*)`/.exec(tail)?.[1] ?? "";
      hits.push({
        raw: helperPath + suffix,
        at: use.index!,
        end: use.index! + close + 1 + (suffix ? suffix.length + 2 : 0),
      });
    }
  }
  hits.sort((a, b) => a.at - b.at);

  for (let i = 0; i < hits.length; i += 1) {
    const normalized = normalizeCallPath(hits[i].raw);
    if (!normalized || !normalized.startsWith("/api/")) continue;
    const windowEnd = Math.min(hits[i + 1]?.at ?? code.length, hits[i].end + 600);
    const method = METHOD_RE.exec(code.slice(hits[i].end, windowEnd));
    found.push({
      method: (method ? method[1].toUpperCase() : "GET") as HttpMethod,
      path: normalized,
      source,
    });
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

const isTestFile = (f: string) => /\.(test|spec)\.(ts|tsx)$/.test(f);

export function collectApiCalls(): ApiCall[] {
  const calls: ApiCall[] = [];
  for (const file of walk(SRC_DIR)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    // Tests are excluded for the same reason the route guard excludes them: an
    // endpoint only a test calls is not reached by using the product. Mock
    // implementations inside api-client are NOT excluded — they sit beside the
    // real call in the same file and carry no path of their own.
    if (isTestFile(file)) continue;
    if (file.startsWith(path.join(SRC_DIR, "test") + path.sep)) continue;
    calls.push(...extractApiCalls(fs.readFileSync(file, "utf8"), path.normalize(file)));
  }
  return calls;
}

// ─── Half 2: what the backend exposes ─────────────────────────────────────────

const CONTROLLERS_REL = "ProcuLink.Api/Controllers";

/** The sibling backend checkout, or null. Same walk as backendMirror.test.ts. */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && fs.existsSync(path.join(fromEnv, CONTROLLERS_REL))) return fromEnv;
  let dir = path.resolve(ROOT);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(path.dirname(dir), "ProcuLink");
    if (fs.existsSync(path.join(candidate, CONTROLLERS_REL))) return candidate;
    const up = path.dirname(dir);
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
 * This file HAS been named in that job since 2026-08-13, and still went without the flag —
 * the job's env said the mirror was mandatory and this suite was not listening. That is a
 * narrower hole than never running at all, but the same shape: the job's checkout step
 * failing, or resolving to a directory without the controllers, would leave every
 * assertion below skipping under a green check.
 */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/**
 * Why this run may not proceed, or null. Pure, and unit-tested on BOTH branches below —
 * the branch that matters cannot be reached on a machine that has the backend cloned.
 */
export function mirrorGateFailure(input: { backendRoot: string | null; required: boolean }): string | null {
  if (input.backendRoot !== null || !input.required) return null;
  return (
    "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable, so the " +
    "endpoint diff did not run. This run proves nothing about whether the app can reach " +
    "the API's routes. Set PROCULINK_BACKEND_PATH to a ProcuLink checkout (the " +
    "`backend-mirror` job in .github/workflows/ci.yml does this with actions/checkout), or " +
    "unset PROCULINK_REQUIRE_BACKEND_MIRROR if this run is genuinely not meant to enforce " +
    "the mirror."
  );
}

export interface Endpoint {
  method: HttpMethod;
  /** Normalized: every `{id:guid}` route parameter becomes `{}`. */
  path: string;
  controller: string;
  action: string;
  file: string;
  line: number;
}

const CLASS_ROUTE_RE = /\[Route\(\s*"([^"]*)"\s*\)\]/;
const CLASS_DECL_RE = /\bclass\s+(\w+Controller)\b/;
const HTTP_ATTR_RE = /^\s*\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\]/;
const METHOD_DECL_RE = /\b(\w+)\s*\(/;

/** `api/orders/{id:guid}/transform` → `/api/orders/{}/transform`. */
export function normalizeRouteTemplate(template: string, controller: string): string {
  const withController = template.replace(/\[controller\]/g, controller.replace(/Controller$/, ""));
  const segments = withController
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith("{") ? "{}" : s));
  return `/${segments.join("/")}`;
}

/**
 * Every action in one controller file.
 *
 * Written against the shapes this codebase actually uses and nothing more: a
 * class-level `[Route("literal")]` or none at all, an action template that is
 * absent, relative, or absolute (`[HttpGet("/health")]`). `parserReadsRealShapes`
 * below pins each of those against a fixture, so a shape that stops parsing
 * fails there rather than quietly shrinking the corpus.
 */
export function parseController(text: string, file: string): Endpoint[] {
  const code = stripComments(text, "js"); // C# comment syntax is the same as JS
  const lines = code.split(/\r?\n/);
  const controller = CLASS_DECL_RE.exec(code)?.[1] ?? path.basename(file, ".cs");

  // The class-level [Route] is the one before the class declaration.
  const classDeclIndex = lines.findIndex((l) => CLASS_DECL_RE.test(l));
  let classRoute = "";
  for (let i = 0; i < (classDeclIndex === -1 ? lines.length : classDeclIndex); i += 1) {
    const m = CLASS_ROUTE_RE.exec(lines[i]);
    if (m) classRoute = m[1];
  }

  const out: Endpoint[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const attr = HTTP_ATTR_RE.exec(lines[i]);
    if (!attr) continue;
    const verb = attr[1].toUpperCase() as HttpMethod;
    const template = attr[2] ?? "";
    const full = template.startsWith("/")
      ? template
      : template
        ? `${classRoute}/${template}`
        : classRoute;
    // The action name is on the next non-attribute line.
    let action = "?";
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
      if (/^\s*\[/.test(lines[j])) continue;
      action = METHOD_DECL_RE.exec(lines[j])?.[1] ?? "?";
      break;
    }
    out.push({
      method: verb,
      path: normalizeRouteTemplate(full, controller),
      controller,
      action,
      file,
      line: i + 1,
    });
  }
  return out;
}

export function collectEndpoints(backendRoot: string): Endpoint[] {
  const dir = path.join(backendRoot, CONTROLLERS_REL);
  return walk(dir)
    .filter((f) => f.endsWith(".cs"))
    .flatMap((f) => parseController(fs.readFileSync(f, "utf8"), f))
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

// ─── The matcher ──────────────────────────────────────────────────────────────

/**
 * Does this call reach this endpoint?
 *
 * A DYNAMIC endpoint segment (`{}`) accepts any caller segment. A LITERAL
 * endpoint segment requires an equal literal caller segment — a computed caller
 * segment does NOT satisfy it, or one `` `/api/${a}/${b}` `` would mark half the
 * API called. That refusal is what puts the two computed-segment connection
 * endpoints on the allowlist above rather than letting them pass unexamined.
 */
export function callReachesEndpoint(endpoint: Endpoint, call: ApiCall): boolean {
  if (endpoint.method !== call.method) return false;
  const e = endpoint.path.split("/").filter(Boolean);
  const c = call.path.split("/").filter(Boolean);
  if (e.length !== c.length) return false;
  return e.every((seg, i) => (seg === "{}" ? true : seg === c[i]));
}

export const endpointKey = (e: Endpoint) => `${e.method} ${e.path}`;

/** The whole guard in one pure function, so fixtures run the real code path. */
export function findUncalledEndpoints(
  endpoints: Endpoint[],
  calls: ApiCall[],
  allowlist: Record<string, string> = {},
): Endpoint[] {
  return endpoints.filter(
    (e) =>
      (STATE_CHANGING as readonly string[]).includes(e.method) &&
      !Object.prototype.hasOwnProperty.call(allowlist, endpointKey(e)) &&
      !calls.some((c) => callReachesEndpoint(e, c)),
  );
}

// ─── Reason quality ───────────────────────────────────────────────────────────

const EVIDENCE_ANCHOR =
  /[\w./-]+\.(?:tsx?|mdx?|cs|jsx?|json|ya?ml|mjs|cjs)\b|https?:\/\/|\b\d{4}-\d{2}-\d{2}\b|\bWP-\d+\b/;
const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/** Null when the reason is acceptable; otherwise what is wrong with it. */
export function rejectReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 40) return "a reason must be a sentence, not a label (min 40 characters)";
  const words = trimmed.match(WORD_RE) ?? [];
  if (words.length < 8) return `a reason must explain, not name (min 8 words, found ${words.length})`;
  if (new Set(words.map((w) => w.toLowerCase())).size < 6) return "a reason must not be padding";
  if (!EVIDENCE_ANCHOR.test(trimmed)) {
    return (
      "a reason must cite something checkable — a file path, a URL, an ISO date, or a WP-nn " +
      "packet — so the next reader can verify it instead of trusting it"
    );
  }
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const CALLS = collectApiCalls();
const ENDPOINTS = BACKEND ? collectEndpoints(BACKEND) : [];

describe("the parsers run everywhere, on fixtures", () => {
  it("reads a full-template call, with its verb", () => {
    const calls = extractApiCalls(
      'const r = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${id}/delivery-config`, {\n' +
        '  method: "PUT",\n  headers: await authHeader(),\n}, 30000);',
      "<fixture>",
    );
    expect(calls).toEqual([
      { method: "PUT", path: "/api/suppliers/{}/delivery-config", source: "<fixture>" },
    ]);
  });

  it("defaults to GET, and never borrows the NEXT call's verb", () => {
    // The window stops at the following path literal. Without that, a GET
    // immediately before a DELETE reads as a DELETE and credits an endpoint
    // nothing calls.
    const calls = extractApiCalls(
      'await fetchWithTimeout(`${API_BASE_URL}/api/suppliers`, { headers: await authHeader() });\n' +
        'await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${id}`, { method: "DELETE" });',
      "<fixture>",
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/suppliers",
      "DELETE /api/suppliers/{}",
    ]);
  });

  it("reads the bare fragments of a module that wraps its own apiFetch", () => {
    // src/lib/api/delivery.ts, api/mapping.ts and api/connectors.ts each define
    // `apiFetch(path)` prefixing `${API_BASE_URL}/api`, so their endpoint paths
    // carry neither marker. Sweeping only the full template saw NONE of them.
    const module =
      'async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {\n' +
      '  const res = await fetch(`${API_BASE_URL}/api${path}`, { ...init });\n}\n' +
      'export const remove = (supplierId: string) =>\n' +
      '  apiFetch(`/suppliers/${supplierId}/po-mapping`, { method: "DELETE" });';
    expect(extractApiCalls(module, "<fixture>").map((c) => `${c.method} ${c.path}`)).toContain(
      "DELETE /api/suppliers/{}/po-mapping",
    );
  });

  it("follows one level of path-helper indirection, so the verb is read at the call site", () => {
    // src/lib/api/catalogSources.ts, in shape. The path lives in a helper and the
    // verb lives at the call, so a forward window from the literal reads GET for
    // a PUT, a DELETE and a POST — three endpoints reported uncalled that are
    // called on every supplier catalog screen.
    const module =
      'function basePath(supplierId: string): string {\n' +
      '  return `${API_BASE_URL}/api/suppliers/${supplierId}/catalog/source`;\n}\n' +
      'export const save = (id: string) =>\n' +
      '  fetchWithTimeout(basePath(id), { method: "PUT", headers: {} }, 30000);\n' +
      'export const drop = (id: string) =>\n' +
      '  fetchWithTimeout(basePath(id), { method: "DELETE" }, 30000);\n' +
      'export const probe = (id: string) =>\n' +
      '  fetchWithTimeout(`${basePath(id)}/test-fetch`, { method: "POST" }, 30000);';
    const keys = extractApiCalls(module, "<fixture>").map((c) => `${c.method} ${c.path}`);
    expect(keys).toContain("PUT /api/suppliers/{}/catalog/source");
    expect(keys).toContain("DELETE /api/suppliers/{}/catalog/source");
    expect(keys).toContain("POST /api/suppliers/{}/catalog/source/test-fetch");
  });

  it("WHAT THIS GUARD CANNOT SEE — pinned, because a green run reads as 'covered'", () => {
    // Written as assertions rather than prose in the header, because the suite is
    // GREEN and a green suite is read as coverage. These are the two shapes that
    // would make a genuinely-called endpoint read as UNCALLED — and therefore
    // land in UNCALLED_PENDING_DECISION as a gap that is not really a gap. If one
    // ever shows up there, the fix is to teach extractApiCalls the shape, not to
    // write the endpoint off as unreachable.

    // 1 — A PATH IMPORTED FROM ANOTHER MODULE. Nothing in this file's text
    //     carries `${API_BASE_URL}`, so there is nothing to resolve.
    expect(
      extractApiCalls(
        'import { ORDERS_PATH } from "@/lib/api/paths";\n' +
          'export const go = () => fetchWithTimeout(ORDERS_PATH, { method: "DELETE" });',
        "<fixture>",
      ),
    ).toEqual([]);

    // 2 — A VERB SUPPLIED INDIRECTLY. The method is read as a literal in the
    //     call's own options object. A verb held in a variable, or defaulted
    //     inside a wrapper, is not there to read, so the call reads as GET and a
    //     state-changing endpoint looks uncalled.
    const indirectVerb =
      'const opts = { method: "DELETE", headers: {} };\n' +
      'export const go = (id: string) => fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${id}/x`, opts);';
    const indirectKeys = extractApiCalls(indirectVerb, "<fixture>").map((c) => `${c.method} ${c.path}`);
    expect(indirectKeys).toContain("GET /api/suppliers/{}/x");
    expect(indirectKeys).not.toContain("DELETE /api/suppliers/{}/x");

    // NOT a limitation, contrary to what this file's header claimed until the
    // fixture was written: a SECOND hop often does resolve, because helper
    // definitions are matched textually wherever they appear — including inside
    // another helper's body. It is incidental rather than designed, so it is
    // recorded as observed behaviour and not relied upon.
    const twoHop =
      'function root(id: string) { return `${API_BASE_URL}/api/suppliers/${id}`; }\n' +
      'function nested(id: string) { return `${root(id)}/deep-thing`; }\n' +
      'export const go = (id: string) => fetchWithTimeout(nested(id), { method: "POST" });';
    expect(extractApiCalls(twoHop, "<fixture>").map((c) => `${c.method} ${c.path}`)).toContain(
      "POST /api/suppliers/{}/deep-thing",
    );
  });

  it("ignores an API path that exists only in a comment", () => {
    expect(
      extractApiCalls('// await fetch(`${API_BASE_URL}/api/ghost`, { method: "POST" });', "<f>"),
    ).toEqual([]);
  });

  it("parses the controller shapes this API actually uses", () => {
    const relative = parseController(
      '[ApiController]\n[Route("api/suppliers")]\npublic class SuppliersController : ControllerBase\n{\n' +
        '    [HttpDelete("{id:guid}/po-mapping/output-tree")]\n' +
        '    public async Task<IActionResult> ClearPromotedOutputTree(Guid id) { }\n}',
      "<fixture.cs>",
    );
    expect(relative.map((e) => `${e.method} ${e.path}`)).toEqual([
      "DELETE /api/suppliers/{}/po-mapping/output-tree",
    ]);
    expect(relative[0].action).toBe("ClearPromotedOutputTree");

    // No action template — the class route IS the path.
    expect(
      parseController(
        '[Route("api/api-keys")]\npublic class ApiKeyController {\n  [HttpPost]\n  public Task Create() {}\n}',
        "<f.cs>",
      ).map((e) => `${e.method} ${e.path}`),
    ).toEqual(["POST /api/api-keys"]);

    // Absolute action template, no class route (HealthController).
    expect(
      parseController(
        'public class HealthController {\n  [HttpGet("/health")]\n  public Task Get() {}\n}',
        "<f.cs>",
      ).map((e) => `${e.method} ${e.path}`),
    ).toEqual(["GET /health"]);

    // No class [Route] but absolute action templates (OrderConfirmationController).
    expect(
      parseController(
        'public class OrderConfirmationController {\n' +
          '  [HttpPost("api/orders/{orderId:guid}/confirmation")]\n  public Task Record() {}\n}',
        "<f.cs>",
      ).map((e) => `${e.method} ${e.path}`),
    ).toEqual(["POST /api/orders/{}/confirmation"]);
  });

  it("matches dynamic segments structurally, and refuses a computed one against a literal", () => {
    const ep = (method: HttpMethod, p: string): Endpoint => ({
      method,
      path: p,
      controller: "C",
      action: "A",
      file: "<f>",
      line: 1,
    });
    const call = (method: HttpMethod, p: string): ApiCall => ({ method, path: p, source: "<f>" });

    expect(callReachesEndpoint(ep("POST", "/api/orders/{}/transform"), call("POST", "/api/orders/{}/transform"))).toBe(true);
    expect(callReachesEndpoint(ep("POST", "/api/orders/{}/transform"), call("POST", "/api/orders/abc/transform"))).toBe(true);
    // Verb matters: a DELETE does not prove the PUT on the same path is called.
    expect(callReachesEndpoint(ep("PUT", "/api/suppliers/{}"), call("DELETE", "/api/suppliers/{}"))).toBe(false);
    // Length matters.
    expect(callReachesEndpoint(ep("POST", "/api/orders/{}/transform"), call("POST", "/api/orders/{}"))).toBe(false);
    // A computed caller segment must NOT satisfy a literal endpoint segment.
    expect(callReachesEndpoint(ep("POST", "/api/connections/{}/revisions/{}/publish"), call("POST", "/api/connections/{}/revisions/{}/{}"))).toBe(false);
  });

  it("catches a synthetic uncalled endpoint (proves the guard is not vacuous)", () => {
    const endpoints: Endpoint[] = [
      { method: "POST", path: "/api/__fixture__/nobody-calls-me", controller: "C", action: "A", file: "<f>", line: 1 },
      { method: "POST", path: "/api/__fixture__/called", controller: "C", action: "B", file: "<f>", line: 2 },
      { method: "GET", path: "/api/__fixture__/read-only", controller: "C", action: "C", file: "<f>", line: 3 },
    ];
    const flagged = findUncalledEndpoints(endpoints, [
      { method: "POST", path: "/api/__fixture__/called", source: "<f>" },
    ]).map(endpointKey);

    expect(flagged).toEqual(["POST /api/__fixture__/nobody-calls-me"]);
    // A GET is not in scope — reading is not a state change, and an uncalled
    // read endpoint is a much weaker claim than an uncalled write.
    expect(flagged).not.toContain("GET /api/__fixture__/read-only");
  });
});

describe("the frontend's call corpus", () => {
  it("is whole — the sweep found the call sites at all", () => {
    // ANTI-VACUITY. An empty corpus makes every endpoint look uncalled, which
    // would drown the real finding in noise; a corpus missing one MODULE makes
    // its endpoints look uncalled silently, which is worse.
    expect(CALLS.length, "the API call sweep found nothing").toBeGreaterThan(100);
    const stateChanging = CALLS.filter((c) => (STATE_CHANGING as readonly string[]).includes(c.method));
    expect(stateChanging.length).toBeGreaterThan(40);

    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
    const files = new Set(CALLS.map((c) => rel(c.source)));
    // The main client, one sibling module, and one of the three apiFetch
    // wrappers whose paths carry no marker at all.
    expect(files).toContain("src/lib/api-client.ts");
    expect(files).toContain("src/lib/api/billing.ts");
    expect(files).toContain("src/lib/api/delivery.ts");

    const keys = new Set(CALLS.map((c) => `${c.method} ${c.path}`));
    expect(keys).toContain("POST /api/orders/upload");
    expect(keys).toContain("PUT /api/suppliers/{}/delivery-config");
    expect(keys).toContain("DELETE /api/suppliers/{}/po-mapping");
  });

  // BARE_FRAGMENT_RE matches BACKTICKED path fragments only. In an apiFetch-wrapper
  // module, the same path written "…" or '…' is invisible to the sweep, so its
  // endpoint reads as having no caller while being called on every render.
  //
  // That is not hypothetical: `POST /api/settings/inbound-email/rotate` was reported
  // uncalled for exactly this reason, and the near-miss was that the fix might have
  // been an UNCALLED_PENDING_DECISION entry — permanently excusing a live endpoint.
  //
  // Widening BARE_FRAGMENT_RE to accept quotes is the WRONG repair: it would let a
  // display-only URL string count as a caller, and a false positive here defeats the
  // guard silently, which is worse than the noise of a false negative. So the strict
  // detector stays and the CONVENTION is enforced instead. Until this test existed,
  // the only thing holding it up was a comment saying "do not tidy these".
  it("no apiFetch-wrapper module hides a path from the sweep behind ordinary quotes", () => {
    const QUOTED_FRAGMENT_RE = /["'](\/[a-z][a-z0-9-]*(?:\/[^"']*)?)["']/g;
    const offenders: string[] = [];
    let wrapperModules = 0;
    let backtickedFragments = 0;

    for (const file of walk(SRC_DIR)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (isTestFile(file)) continue;
      if (file.startsWith(path.join(SRC_DIR, "test") + path.sep)) continue;

      const code = stripComments(fs.readFileSync(file, "utf8"), "js");
      if (!API_FETCH_WRAPPER_RE.test(code)) continue;
      wrapperModules++;
      backtickedFragments += [...code.matchAll(BARE_FRAGMENT_RE)].length;

      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      for (const m of code.matchAll(QUOTED_FRAGMENT_RE)) {
        const line = code.slice(0, m.index!).split(/\r?\n/).length;
        offenders.push(`${rel}:${line} — ${m[1]}`);
      }
    }

    // ANTI-VACUITY, both halves. A file-count floor alone would pass if the
    // fragment reader had been repointed at nothing, so pin what was EXTRACTED too.
    expect(wrapperModules, "no apiFetch-wrapper module found — the sweep moved").toBeGreaterThan(2);
    expect(backtickedFragments, "wrapper modules found, but no path read out of them").toBeGreaterThan(10);

    expect(
      offenders,
      "These paths sit in an apiFetch-wrapper module written with ordinary quotes, so " +
        "BARE_FRAGMENT_RE cannot see them and their endpoints will be reported as having " +
        "no caller. Backtick them — do not widen the detector, and do not answer this by " +
        "adding the endpoint to UNCALLED_PENDING_DECISION:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});

describe("every state-changing endpoint has a caller, or a written reason", () => {
  const reason =
    "no backend checkout found — set PROCULINK_BACKEND_PATH to the ProcuLink repo to run the endpoint diff";

  it("a backend checkout was located, or this run says why not", () => {
    // Always runs. Where the mirror is not required it cannot fail the suite, but it puts
    // the state on the record instead of leaving a silent skip. Where CI DID require it,
    // the absence is a failure — the job's own checkout step is what should have supplied it.
    expect(mirrorGateFailure({ backendRoot: BACKEND, required: REQUIRE_MIRROR })).toBeNull();
    if (!BACKEND) {
      expect(reason).toContain("PROCULINK_BACKEND_PATH");
      return;
    }
    expect(fs.existsSync(path.join(BACKEND, CONTROLLERS_REL))).toBe(true);
  });

  it("no checkout is a legitimate skip when the mirror is not required", () => {
    expect(mirrorGateFailure({ backendRoot: null, required: false })).toBeNull();
  });

  it("no checkout is a FAILURE when CI required the mirror", () => {
    const failure = mirrorGateFailure({ backendRoot: null, required: true });
    expect(failure).toContain("PROCULINK_REQUIRE_BACKEND_MIRROR=1");
    expect(mirrorGateFailure({ backendRoot: "/tmp/backend", required: true })).toBeNull();
  });

  it.skipIf(!BACKEND)("the endpoint corpus is whole", () => {
    // ANTI-VACUITY, the other side. A controller sweep that returns nothing —
    // or that silently loses the `[Route]` resolution — passes this guard for
    // every endpoint at once.
    expect(ENDPOINTS.length, "the controller sweep found nothing").toBeGreaterThan(120);
    const stateChanging = ENDPOINTS.filter((e) => (STATE_CHANGING as readonly string[]).includes(e.method));
    expect(stateChanging.length).toBeGreaterThan(80);
    const keys = new Set(ENDPOINTS.map(endpointKey));
    expect(keys).toContain("POST /api/orders/upload");
    expect(keys).toContain("PUT /api/suppliers/{}/delivery-config");
    // Every path resolved against a class route — an unresolved one keeps the
    // controller's own prefix off the front.
    expect(ENDPOINTS.filter((e) => !e.path.startsWith("/api/") && e.path !== "/health")).toEqual([]);
  });

  it.skipIf(!BACKEND)("no state-changing endpoint is unaccounted for", () => {
    // Accounted for = called, explained (KNOWN_MACHINE_FACING), or tracked as an
    // open question (UNCALLED_PENDING_DECISION). Anything else fails.
    const uncalled = findUncalledEndpoints(ENDPOINTS, CALLS, ACCOUNTED_FOR);
    const rel = (f: string) => path.relative(BACKEND!, f).split(path.sep).join("/");
    const report = uncalled
      .map((e) => `  ${endpointKey(e)}\n      ${e.controller}.${e.action} — ${rel(e.file)}:${e.line}`)
      .join("\n");
    expect(
      uncalled.map(endpointKey),
      uncalled.length === 0
        ? ""
        : `\n${uncalled.length} state-changing endpoint(s) exist and nothing in this app calls them:\n` +
            `${report}\n\n` +
            `Wire one from src/lib/api*, or account for it in this file WITH a written reason that\n` +
            `cites something a reviewer can open — KNOWN_MACHINE_FACING if something outside this\n` +
            `app really calls it, UNCALLED_PENDING_DECISION if it is an unresolved gap.\n` +
            `Silence is the failure.\n`,
    ).toEqual([]);
  });

  it.skipIf(!BACKEND)("the pending set is exactly the thirteen on the record", () => {
    // The mechanism that stops "tracked" turning into "forgotten". A FOURTEENTH
    // uncalled endpoint fails here rather than quietly joining the list, and an
    // endpoint that gets wired must be deleted from the list rather than left as
    // a stale excuse.
    expect(
      findUncalledEndpoints(ENDPOINTS, CALLS, KNOWN_MACHINE_FACING).map(endpointKey).sort(),
      "a new state-changing endpoint has no caller — wire it, or add it to " +
        "UNCALLED_PENDING_DECISION with a reason",
    ).toEqual(Object.keys(UNCALLED_PENDING_DECISION).sort());
  });

  it.skipIf(!BACKEND)("prints the pending set, so it lands in CI output and not only in a file", () => {
    // A tracked gap that nobody reads is an untracked gap. This is the only test
    // here whose job is to TALK: it puts the count and the names in front of
    // anyone watching a green run.
    const keys = Object.keys(UNCALLED_PENDING_DECISION).sort();
    const rel = (f: string) => (BACKEND ? path.relative(BACKEND, f).split(path.sep).join("/") : f);
    const where = (key: string) => {
      const e = ENDPOINTS.find((x) => endpointKey(x) === key);
      return e ? `  — ${e.controller}.${e.action}, ${rel(e.file)}:${e.line}` : "";
    };
    console.log(
      `\n${"─".repeat(78)}\n` +
        `${keys.length} state-changing API endpoint(s) are UNREACHABLE from this app and are\n` +
        `awaiting a product decision (build the caller, or delete the endpoint):\n\n` +
        keys.map((k) => `  ${k}${where(k)}`).join("\n") +
        `\n\nSee UNCALLED_PENDING_DECISION in src/test/endpoint-reachability.test.ts for the\n` +
        `reason on each. These are NOT the same as KNOWN_MACHINE_FACING, which is\n` +
        `${Object.keys(KNOWN_MACHINE_FACING).length} endpoint(s) something outside this app genuinely calls.\n` +
        `${"─".repeat(78)}\n`,
    );
    expect(keys.length).toBeGreaterThan(0);
  });

  it.skipIf(!BACKEND)("the positive control: a known-called endpoint is NOT flagged", () => {
    // Without this, a matcher that flagged everything would look like a guard
    // finding real problems.
    const upload = ENDPOINTS.filter((e) => endpointKey(e) === "POST /api/orders/upload");
    expect(upload, "POST /api/orders/upload must still exist").toHaveLength(1);
    expect(findUncalledEndpoints(upload, CALLS, {})).toEqual([]);
  });
});

describe("allowlist hygiene — both lists, and they stay separate", () => {
  it("every entry in BOTH lists carries a checkable reason", () => {
    for (const [key, why] of Object.entries(ACCOUNTED_FOR)) {
      expect(rejectReason(why), `${key}: ${rejectReason(why)}`).toBeNull();
    }
    expect(Object.keys(KNOWN_MACHINE_FACING).length).toBeGreaterThan(0);
    expect(Object.keys(UNCALLED_PENDING_DECISION).length).toBeGreaterThan(0);
  });

  it("the two lists never overlap, and a pending reason says it is pending", () => {
    // "This is fine, and here is who calls it" and "nobody calls this and nobody
    // has decided what to do" must stay distinguishable at a glance. An endpoint
    // in both would be a justification quietly attached to an open question.
    const machine = new Set(Object.keys(KNOWN_MACHINE_FACING));
    expect(Object.keys(UNCALLED_PENDING_DECISION).filter((k) => machine.has(k))).toEqual([]);
    expect(Object.keys(ACCOUNTED_FOR)).toHaveLength(
      Object.keys(KNOWN_MACHINE_FACING).length + Object.keys(UNCALLED_PENDING_DECISION).length,
    );
    // Every pending reason must SAY it is pending rather than read as an excuse.
    for (const [key, why] of Object.entries(UNCALLED_PENDING_DECISION)) {
      expect(why, `${key}: a pending reason must declare itself pending`).toMatch(/PENDING A DECISION/);
    }
    for (const [key, why] of Object.entries(KNOWN_MACHINE_FACING)) {
      expect(why, `${key}: a machine-facing reason must not be a pending one`).not.toMatch(
        /PENDING A DECISION/,
      );
    }
  });

  it("a reason must be an explanation, not merely long", () => {
    expect(rejectReason("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).not.toBeNull();
    expect(rejectReason("machine to machine")).not.toBeNull();
    expect(
      rejectReason("This endpoint is called by an external system and not by the frontend at all."),
      "prose with no citation must be rejected",
    ).not.toBeNull();
    expect(
      rejectReason("Stripe calls it; see ProcuLink.Api/Services/StripeBillingService.cs for the other half."),
    ).toBeNull();
  });

  it.skipIf(!BACKEND)("every entry still names a real endpoint (neither list can rot)", () => {
    const real = new Set(ENDPOINTS.map(endpointKey));
    const stale = Object.keys(ACCOUNTED_FOR).filter((k) => !real.has(k));
    expect(
      stale,
      stale.length === 0
        ? ""
        : `\nAn allowlist names endpoint(s) that no longer exist — delete the entries:\n${stale.join("\n")}\n`,
    ).toEqual([]);
  });

  it.skipIf(!BACKEND)("every entry is still uncalled (an excuse cannot outlive its reason)", () => {
    // Covers BOTH lists. This is the test that earned its keep during development
    // by rejecting POST /api/support/contact, which had been written into
    // KNOWN_MACHINE_FACING while api-client.ts:317 was calling it all along. It
    // matters more now that the pending set passes: without it, a gap somebody
    // quietly closed would leave an entry behind claiming it is still open.
    const stillNeeded = Object.keys(ACCOUNTED_FOR).filter((key) => {
      const endpoint = ENDPOINTS.find((e) => endpointKey(e) === key);
      return endpoint === undefined || !CALLS.some((c) => callReachesEndpoint(endpoint, c));
    });
    expect(
      Object.keys(ACCOUNTED_FOR).sort(),
      "an allowlisted endpoint gained a frontend caller — delete its entry",
    ).toEqual(stillNeeded.sort());
  });
});
