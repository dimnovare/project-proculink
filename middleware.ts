import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/orders(.*)",
  "/upload(.*)",
  "/suppliers(.*)",
  "/mappings(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
