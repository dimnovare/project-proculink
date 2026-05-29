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
]);

const isClerkConfigured =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  && Boolean(process.env.CLERK_SECRET_KEY);

const isQaAuthBypass =
  process.env.PROCULINK_QA_BYPASS_AUTH === "true"
  && process.env.NODE_ENV !== "production";

function fallbackMiddleware(req: NextRequest) {
  if (isProtectedRoute(req)) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("configuration", "server-env-missing");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

const middleware = isQaAuthBypass
  ? () => NextResponse.next()
  : isClerkConfigured
    ? clerkMiddleware(async (auth, req) => {
        if (isProtectedRoute(req)) await auth.protect();
      })
    : fallbackMiddleware;

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
