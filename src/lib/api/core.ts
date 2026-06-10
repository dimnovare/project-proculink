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
 * Returns an Authorization header with the current Clerk session JWT.
 * Uses window.Clerk (set by ClerkProvider) so this works outside React components.
 */
export async function authHeader(): Promise<Record<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await (window as any).Clerk?.session?.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class ApiHttpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
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
