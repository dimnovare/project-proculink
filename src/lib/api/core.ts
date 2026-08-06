/**
 * core.ts — single source of truth for the shared API-layer primitives.
 *
 * Before this module existed, every extracted client module (billing.ts,
 * operations.ts, settings.ts) and api-client.ts itself copy-pasted its own
 * copy of API_BASE_URL normalization, USE_MOCK, authHeader, fetchWithTimeout,
 * delay, and a PRIVATE `ApiHttpError` class. The duplicated classes were a
 * footgun: an `err instanceof ApiHttpError` check only matches the class
 * declared in the SAME module, so an error thrown by operations.ts would
 * silently fail an `instanceof` check against the api-client.ts class.
 *
 * These are the canonical definitions — the api-client.ts variants (the most
 * complete) are the source of truth. Every other api-layer module imports from
 * here so there is exactly ONE ApiHttpError class identity across the app and
 * a single place to change auth / mock / timeout policy.
 *
 * Behavior-preserving: implementations are copied verbatim from api-client.ts.
 */

import { operatorSafeApiMessage } from "@/lib/serverText";

/** Normalise the configured API base URL: trim, drop trailing slashes, ensure a scheme. */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  const value = (raw || "http://localhost:5223").trim().replace(/\/+$/, "");
  if (!value) return "http://localhost:5223";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/** Normalised public API base (no trailing slash, scheme-qualified). */
export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

// Mock mode is opt-in AND dev-only. Production builds NEVER render mock data
// regardless of env var, so prospects/customers never see staged content.
// (J2) Previously defaulted to true when env was absent, which leaked demo
// state into Vercel deploys without `NEXT_PUBLIC_USE_MOCK=false` set.
export const USE_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === "true" &&
  process.env.NODE_ENV !== "production";

/** True when the frontend uses in-memory mocks instead of the ASP.NET API. */
export const isApiMockMode = USE_MOCK;

/**
 * True in builds that have NO Clerk at all — in-memory mock mode or the live
 * QA-bypass e2e harness. Used to skip the "wait for Clerk to load" step below,
 * which would otherwise stall every request for the full timeout (window.Clerk
 * never appears in these modes). Build-time inlined, so prod keeps the wait.
 */
const NO_CLERK_AUTH =
  process.env.NEXT_PUBLIC_USE_MOCK === "true" ||
  process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true";

/**
 * Returns an Authorization header with the current Clerk session JWT.
 * Uses window.Clerk (set by ClerkProvider) so this works outside React components.
 *
 * Cold-mount race: the (app) data queries can fire before Clerk has finished
 * loading its session. Reading the token then yields undefined → the request
 * goes out UNAUTHENTICATED → the API returns 401 → the query fails and parks
 * itself, leaving the landing dashboard (and any screen loaded on a cold/hard
 * page load) stuck on its empty state ("No deliveries yet", 0 orders) even
 * though the API has data. Observed live on prod 2026-06-16: same request
 * returned 200 with a token and 401 without. Fix: wait — hard-capped at 5s — for
 * Clerk to finish loading before reading the token, so the very first request
 * already carries a valid JWT. Skipped in mock / QA-bypass builds (no Clerk).
 */
export async function authHeader(): Promise<Record<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!NO_CLERK_AUTH && typeof window !== "undefined") {
    const start = Date.now();
    // Clerk.loaded flips true once Clerk.load() resolves; once loaded, .session
    // is either present (signed in → token) or null (signed out → no header).
    while (Date.now() - start < 5000) {
      if (w.Clerk?.loaded) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  let token: string | null | undefined;
  try {
    token = await w.Clerk?.session?.getToken?.();
  } catch {
    token = null;
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class ApiHttpError extends Error {
  status: number;
  body: unknown;
  /**
   * Seconds the server asked us to wait before trying again, when it said so.
   *
   * Only a 429 carries one. `null` means "the server did not say", NOT "retry
   * immediately" — the difference matters, because a caller that reads a missing
   * wait as zero produces exactly the tight loop the limiter exists to stop.
   */
  retryAfterSeconds: number | null;

  /**
   * The message is cleaned HERE, not at the throw sites and not at the render sites.
   *
   * Every throw site in the api layer composes its message from the response body — the shape is
   * `error ?? \`${fallback}: ${await res.text()}\`` — and `parseApiErrorBody` only lifts a sentence
   * when that body is JSON carrying a conventional field. A Railway or Vercel 502 answers with an
   * HTML error page, so the raw markup lands in `message`, and roughly eighty call sites render
   * `message` to operators, several by interpolating it mid-sentence.
   *
   * That defect has now survived two fixes, both of which sanitised one place and left the others
   * open (FE #94 wrapped one operand of one panel; FE #98 wrapped the rest of that panel and found
   * this door still ajar). A third per-site fix would have the same shape as the two that failed.
   * So the possibility is removed instead: an ApiHttpError cannot hold markup, whichever throw site
   * builds it, including one written after this comment.
   *
   * `operatorSafeApiMessage` returns a non-markup message byte-for-byte, which is what keeps the
   * code that PATTERN-MATCHES these strings working — `isPlanGateError` on
   * `<capability>_requires_<plan>`, `isRequestTimeout` anchored on the timeout sentence,
   * `AssignSupplierBanner` stripping its own prefix. See src/lib/serverText.ts.
   *
   * The raw body is not lost: it is still on `body` for anything that needs the literal response,
   * and the untouched supplier body stays on the order passport.
   */
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(operatorSafeApiMessage(message, status));
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds ?? retryAfterFrom(null, body);
  }
}

/**
 * The wait a 429 asked for, from the response header or the body, in seconds.
 *
 * Both are read because neither alone is reliable here. The header is the
 * standard and is what proxies honour, but it is not CORS-safelisted — the app
 * and the API are different origins in every deployed environment, so script can
 * only read it while the API explicitly exposes it. The body field always
 * survives. Returns null when neither is present or parseable, which callers
 * must treat as "unknown", never as zero.
 */
export function retryAfterFrom(res: Response | null, body: unknown): number | null {
  const header = res?.headers?.get?.("Retry-After");
  if (header) {
    // RFC 9110 allows delay-seconds or an HTTP-date. Both appear in the wild.
    const fromHeader = positiveSeconds(Number(header));
    if (fromHeader !== null) return fromHeader;
    const at = Date.parse(header);
    // A date we cannot parse, or one already in the past, tells us NOTHING about
    // how long to wait. Clamping it to 0 would turn "unknown" into "retry now",
    // which is the tight loop the limiter exists to stop. RFC 9110 requires
    // recipients to accept the obsolete RFC-850 form, which Date.parse rejects.
    if (Number.isFinite(at)) return positiveSeconds(Math.ceil((at - Date.now()) / 1000));
  }
  if (body && typeof body === "object" && "retryAfterSeconds" in body) {
    // `"key" in body` is true for a key present with value NULL, and Number(null)
    // is 0 — so an `int?` that serialised as `"retryAfterSeconds": null` (the .NET
    // default, and this API does not set WhenWritingNull globally) used to read as
    // "wait zero seconds" and fire the retries back to back. Worse than the flat
    // policy it replaced.
    const raw = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof raw === "number") return positiveSeconds(raw);
    if (typeof raw === "string" && raw.trim() !== "") return positiveSeconds(Number(raw));
  }
  return null;
}

/**
 * A wait we can act on: finite and at least one second. Anything else — NaN, a
 * boolean coerced to 1, a negative, or a zero — is "the server did not tell us",
 * which is null. Never zero: see the note above.
 */
function positiveSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.ceil(value);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Re-throw AbortError as a clearer timeout error so callers (and the user)
    // can distinguish "backend didn't respond in time" from a generic network
    // failure. Preserves the original error chain via `cause`.
    if (didTimeout || (err instanceof DOMException && err.name === "AbortError")) {
      throw new Error(`Request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
