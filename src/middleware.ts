import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/bridge(.*)",
  "/inbox(.*)",
  "/upload(.*)",
  "/library(.*)",
  "/operations(.*)",
  "/settings(.*)",
  // /admin requires sign-in at the edge; the real admin allowlist is enforced
  // server-side by /api/admin (403 for non-admins), surfaced as a clean page.
  "/admin(.*)",
]);

const isClerkConfigured =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  && Boolean(process.env.CLERK_SECRET_KEY);

const isQaAuthBypass =
  process.env.PROCULINK_QA_BYPASS_AUTH === "true"
  && process.env.NODE_ENV !== "production";

// Query parameters that can carry a Clerk handshake back to us. Both are JWTs:
// @clerk/backend reads them in AuthenticateContext.initHandshakeValues() and hands
// __clerk_handshake to verifyHandshakeToken(), which decodes the JWT header, loads the
// JWK named by `kid`, and checks the signature.
const CLERK_HANDSHAKE_PARAMS = ["__clerk_handshake", "__clerk_db_jwt"] as const;

// Everything Clerk itself deletes from the URL once a handshake has been consumed
// (see HandshakeService.resolveHandshake, which does this for development instances).
// We strip the same set on the retry so the retry cannot re-enter this branch.
const CLERK_TRANSIT_PARAMS = [
  ...CLERK_HANDSHAKE_PARAMS,
  "__clerk_handshake_nonce",
  "__clerk_help",
];

// The only algorithms @clerk/backend will verify a Clerk JWT with (algToHash in
// src/jwt/algorithms.ts). assertHeaderAlgorithm() rejects anything else outright.
const CLERK_JWT_ALGORITHMS = new Set(["RS256", "RS384", "RS512"]);

function decodeBase64UrlToText(segment: string) {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * True only if `value` is shaped like a JWT that @clerk/backend would attempt to verify:
 * three base64url segments whose header names a Clerk-supported RSA algorithm and a `kid`
 * to resolve it against. This does not prove the token is authentic — verifying the
 * signature needs a JWKS round trip that Clerk already performs inside clerkMiddleware —
 * it only rejects values that could never be a handshake at all.
 */
function parsesAsClerkJwt(value: string | null) {
  if (!value) return false;

  const segments = value.split(".");
  if (segments.length !== 3) return false;
  if (segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) return false;

  let header: unknown;
  let payload: unknown;
  try {
    // decodeJwt() JSON-parses both segments; a value that fails here could never
    // survive verifyHandshakeToken() either.
    header = JSON.parse(decodeBase64UrlToText(segments[0]));
    payload = JSON.parse(decodeBase64UrlToText(segments[1]));
  } catch {
    return false;
  }
  if (typeof header !== "object" || header === null) return false;
  if (typeof payload !== "object" || payload === null) return false;

  const { alg, kid, typ } = header as Record<string, unknown>;
  if (typeof alg !== "string" || !CLERK_JWT_ALGORITHMS.has(alg)) return false;
  if (typeof kid !== "string" || kid.length === 0) return false;
  // assertHeaderType() allows `typ` to be absent, but rejects any other value.
  if (typ !== undefined && typ !== "JWT") return false;

  return true;
}

/**
 * Mirrors HandshakeService.isRequestEligibleForHandshake() in @clerk/backend. Clerk only
 * ever starts a handshake on a top-level document GET, so a handshake can only ever come
 * back on one. Fetches, XHR and subresource loads are never handshake returns.
 */
function isDocumentNavigation(req: NextRequest) {
  if (req.method !== "GET") return false;

  const secFetchDest = req.headers.get("sec-fetch-dest");
  if (secFetchDest === "document" || secFetchDest === "iframe") return true;
  if (secFetchDest) return false;

  return (req.headers.get("accept") ?? "").startsWith("text/html");
}

function isClerkHandshakeReturn(req: NextRequest) {
  if (!isDocumentNavigation(req)) return false;

  return CLERK_HANDSHAKE_PARAMS.some((param) =>
    parsesAsClerkJwt(req.nextUrl.searchParams.get(param)),
  );
}

/**
 * Answer a handshake return by retrying the same URL without the Clerk parameters.
 *
 * clerkMiddleware resolves the handshake *before* this handler runs and appends the
 * resulting Set-Cookie headers to whatever we return, redirect included. So a genuine
 * handshake lands signed in on the retry, and a forged one — which sets no cookies —
 * arrives with no handshake parameter left and falls through to the signed-out redirect.
 * Either way nothing renders for a request that is not authenticated.
 */
function redirectPastHandshake(req: NextRequest) {
  const url = req.nextUrl.clone();
  for (const param of CLERK_TRANSIT_PARAMS) {
    url.searchParams.delete(param);
  }

  const res = NextResponse.redirect(url);
  res.headers.set("cache-control", "no-store");
  return res;
}

function fallbackMiddleware(req: NextRequest) {
  if (isProtectedRoute(req)) {
    return redirectToLocalSignIn(req, "server-env-missing");
  }

  return NextResponse.next();
}

function redirectToLocalSignIn(req: NextRequest, configuration?: string) {
  const url = new URL("/sign-in", req.url);
  url.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
  if (configuration) url.searchParams.set("configuration", configuration);
  return NextResponse.redirect(url);
}

function redirectToCreateOrg(req: NextRequest) {
  const url = new URL("/onboarding/select-organization", req.url);
  url.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

type EdgeSession = { userId?: string | null; orgId?: string | null };

/**
 * The sign-in and organisation gates for protected app routes.
 *
 * Order matters and is load-bearing. The session is read first and unconditionally, so
 * no query parameter can reach past it: the handshake allowance below can only ever
 * shorten the path of an *already signed-out* request to a redirect, and the
 * organisation gate is downstream of a real `userId` that only Clerk can produce.
 */
export async function applyProtectedRouteGuards(
  req: NextRequest,
  loadSession: () => Promise<EdgeSession>,
): Promise<NextResponse | undefined> {
  if (!isProtectedRoute(req)) return;

  const session = await loadSession();

  if (!session.userId) {
    // A handshake return that still reads signed out is mid-flight: Clerk has just
    // issued the session cookies on this very response. Bouncing it to /sign-in drops
    // the token and starts the handshake again — the loop fixed on 2026-06-03. Retry
    // the clean URL instead so the cookies land first.
    if (isClerkHandshakeReturn(req)) return redirectPastHandshake(req);
    return redirectToLocalSignIn(req);
  }

  // Signed in but no active Clerk organization → force org creation/selection
  // before any tenant-scoped app route. The gate route (/onboarding/...) is not
  // in isProtectedRoute, so this never self-loops. Two escape hatches that must
  // NOT be bounced:
  //  - org_set=1: one-shot flag the gate appends after setActive, for the window
  //    where the client session has an org but the edge cookie hasn't caught up
  //    (AutoActivateOrg in (app) finishes activation).
  //  - /admin: allowlist-gated server-side, not org-scoped, so a platform admin
  //    may operate without an org.
  const justSetOrg = req.nextUrl.searchParams.has("org_set");
  const isAdmin = req.nextUrl.pathname.startsWith("/admin");
  if (!session.orgId && !justSetOrg && !isAdmin) {
    return redirectToCreateOrg(req);
  }
}

const middleware = isQaAuthBypass
  ? () => NextResponse.next()
  : isClerkConfigured
    ? clerkMiddleware(async (auth, req) => applyProtectedRouteGuards(req, auth))
    : fallbackMiddleware;

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
