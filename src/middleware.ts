import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/bridge(.*)",
  "/inbox(.*)",
  "/upload(.*)",
  "/drafts(.*)",
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

function isClerkHandshake(req: NextRequest) {
  return req.nextUrl.searchParams.has("__clerk_handshake")
    || req.nextUrl.searchParams.has("__clerk_db_jwt");
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

const middleware = isQaAuthBypass
  ? () => NextResponse.next()
  : isClerkConfigured
    ? clerkMiddleware(async (auth, req) => {
        if (!isProtectedRoute(req)) return;
        if (isClerkHandshake(req)) return NextResponse.next();

        const session = await auth();
        if (!session.userId) return redirectToLocalSignIn(req);
      })
    : fallbackMiddleware;

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
