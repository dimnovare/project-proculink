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
  // Legacy routes still protected during transition
  "/dashboard(.*)",
  "/orders(.*)",
  "/suppliers(.*)",
  "/mappings(.*)",
]);

const isClerkConfigured =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  && Boolean(process.env.CLERK_SECRET_KEY);

function fallbackMiddleware(req: NextRequest) {
  if (isProtectedRoute(req)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

const middleware = isClerkConfigured ? clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
}) : fallbackMiddleware;

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
