import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
