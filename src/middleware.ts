import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Every URL segment that `src/app/(app)/` serves. One entry per top-level
 * directory under that route group — that correspondence is the whole rule, and
 * it is not a convention you have to remember: `src/test/protectedRouteCoverage.test.ts`
 * walks the route tree and fails if a page under `(app)` is missing from here,
 * or if a route outside `(app)` is claimed by it.
 *
 * It was a convention you had to remember until 2026-08-15, and it did not hold.
 * `/connections` and `/inbound/*` were both absent while `/connections` sat on a
 * VISIBLE nav tab (HubTabs.tsx, suppliers hub), so a signed-out visitor got the
 * app shell and a confident "No connections yet" — a disabled TanStack query
 * reports `isLoading === false`, so "never asked" renders as "nothing there".
 * Nothing enforced the correspondence, so nothing caught it. The guard does now.
 */
export const PROTECTED_ROUTE_PATTERNS = [
  "/bridge(.*)",
  "/inbox(.*)",
  "/upload(.*)",
  "/library(.*)",
  "/operations(.*)",
  "/settings(.*)",
  // Versioned supplier connections — reachable from the Suppliers hub strip as
  // "Supplier changes", and from the sidebar.
  "/connections(.*)",
  // Inbound documents (invoices, shipping notices). Behind INBOUND_ENABLED in the
  // nav, but a launch flag hides a tab; it does not make a URL unroutable.
  "/inbound(.*)",
  // /admin requires sign-in at the edge; the real admin allowlist is enforced
  // server-side by /api/admin (403 for non-admins), surfaced as a clean page.
  "/admin(.*)",
] as const;

const isProtectedRoute = createRouteMatcher([...PROTECTED_ROUTE_PATTERNS]);

/** Does the edge guard claim `pathname`? Exported for the coverage guard. */
export function isProtectedPath(pathname: string): boolean {
  return isProtectedRoute(
    new NextRequest(new URL(pathname, "https://proculink.eu"), { method: "GET" }),
  );
}

const isClerkConfigured =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  && Boolean(process.env.CLERK_SECRET_KEY);

/**
 * Is the local QA auth bypass on?
 *
 * `PROCULINK_QA_BYPASS_AUTH=true` replaces the entire Clerk guard below with a
 * pass-through, so protected-route screenshots can be taken without a session
 * (CLAUDE.md §14). The `NODE_ENV` half is the only thing between that and an
 * unauthenticated production app — and until 2026-08-21 it was an inline
 * conditional that no test could reach, so the single most security-sensitive
 * comparison in the frontend rested on nobody having typo'd it.
 *
 * It is a pure function taking its environment as an argument for exactly one
 * reason: all four quadrants (flag on/off × production/not) are pinned in
 * `src/middleware.test.ts`, including the one that matters — production with the
 * flag ON must be false.
 *
 * The call site passes the two values individually rather than `process.env`
 * itself. That is deliberate: Next inlines a literal `process.env.NODE_ENV` at
 * build time, and a property read off a forwarded object would instead resolve
 * at runtime, where an unset NODE_ENV would read as "not production".
 */
export function qaBypassActive(env: {
  PROCULINK_QA_BYPASS_AUTH?: string;
  NODE_ENV?: string;
}): boolean {
  return env.PROCULINK_QA_BYPASS_AUTH === "true" && env.NODE_ENV !== "production";
}

const isQaAuthBypass = qaBypassActive({
  PROCULINK_QA_BYPASS_AUTH: process.env.PROCULINK_QA_BYPASS_AUTH,
  NODE_ENV: process.env.NODE_ENV,
});

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

/**
 * The file extensions that mark a request as a real static asset. A pathname
 * ending in one of these is the only kind of dotted pathname the middleware is
 * allowed to skip.
 *
 * Exported so `src/middleware.test.ts` can compile the matcher below with Next's
 * own `getMiddlewareMatchers` and check, extension by extension, that the two
 * agree — and that every file actually sitting in `public/` is still served.
 */
export const STATIC_ASSET_EXTENSIONS = [
  "css",
  "js",
  "mjs",
  "map",
  "ico",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "xml",
  "txt",
  "webmanifest",
  "csv",
  "pdf",
  "zip",
  "mp4",
  "webm",
] as const;

/**
 * Next parses this object out of the module statically, so both patterns have to
 * stay literal — they cannot be built from the two lists they mirror. The test
 * file is what keeps them honest.
 */
export const config = {
  matcher: [
    // Everything that is not a Next internal and does not END in a real asset
    // extension.
    //
    // This read `/((?!_next|.*\..*).*)` until 2026-08-21: it skipped the
    // middleware for ANY pathname containing a dot. Next dynamic segments accept
    // dots, so `/inbox/an.order.id`, `/library/suppliers/a.b` and
    // `/connections/a.b` all bypassed the guard and answered a signed-out
    // visitor with 200 and the workspace shell instead of a redirect to
    // /sign-in. Keep this list in sync with STATIC_ASSET_EXTENSIONS above.
    "/((?!_next|.*\\.(?:css|js|mjs|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|eot|xml|txt|webmanifest|csv|pdf|zip|mp4|webm)$).*)",
    // ...and every protected prefix unconditionally, so that an order id ending
    // in ".png" can never be read as an asset either. Keep in sync with
    // PROTECTED_ROUTE_PATTERNS above; the same test pins that correspondence.
    "/(bridge|inbox|upload|library|operations|settings|connections|inbound|admin)/:path*",
  ],
};
