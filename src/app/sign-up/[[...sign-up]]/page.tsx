import { SignUp } from "@clerk/nextjs";
import { AuthShell, AuthHeading, clerkAppearance } from "@/components/auth/AuthSurface";
import { ClerkAvailabilityGate } from "@/components/bridge/ClerkAvailabilityGate";

/* The shell, the brand panel and the Clerk appearance object live in
   @/components/auth/AuthSurface and are shared with /sign-in — which is how the
   "Last used" badge fix now reaches this page. It did not before: /sign-in hid
   that badge and this file, holding its own copy of the same object, did not, so
   the clipped notch rendered on the first screen a new buyer sees. */

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Sign-up is not configured</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add the Clerk environment variables in Vercel to enable authentication.
        </p>
      </AuthShell>
    );
  }

  if (!process.env.CLERK_SECRET_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Server auth is not configured</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Add CLERK_SECRET_KEY in Vercel for Production and Preview, then redeploy.
        </p>
      </AuthShell>
    );
  }

  return (
    // Same shape and same failure as /sign-in (WP-32 follow-up, F1): outside
    // (app), so the layout gate never reached it, and <SignUp/> never mounts
    // without the hosted script. Middleware does not route anyone here, but
    // every marketing "Start for free" call to action does.
    <ClerkAvailabilityGate surface="auth">
      <AuthShell>
        <AuthHeading title="Start for free" sub="No credit card. 20 orders free for 14 days." />
        <SignUp
          appearance={clerkAppearance}
          fallbackRedirectUrl="/onboarding/select-organization"
          signInFallbackRedirectUrl="/onboarding/select-organization"
        />
      </AuthShell>
    </ClerkAvailabilityGate>
  );
}
