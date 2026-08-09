import { SignIn } from "@clerk/nextjs";
import { AuthShell, AuthHeading, clerkAppearance } from "@/components/auth/AuthSurface";
import { ClerkAvailabilityGate } from "@/components/bridge/ClerkAvailabilityGate";

/* The shell, the brand panel and the Clerk appearance object live in
   @/components/auth/AuthSurface and are shared with /sign-up. What is left here
   is the part that is genuinely this route's: which Clerk component mounts, the
   heading, and where a completed sign-in goes. */

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Sign-in is not configured</h1>
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
    // WP-32 follow-up (F1). This page is NOT in (app), so the layout gate never
    // reached it — and middleware sends every signed-out user here, which makes
    // it the commonest place to meet a blocked sign-in script. <SignIn/> cannot
    // mount without that script, so what shipped was a "Welcome back" heading
    // above an empty box: no form, no spinner, no error, forever. The gate
    // bounds the wait and replaces the page with an explanation instead.
    <ClerkAvailabilityGate surface="auth">
      <AuthShell>
        <AuthHeading title="Welcome back" sub="Sign in to your ProcuLink workspace." />
        <SignIn
          appearance={clerkAppearance}
          fallbackRedirectUrl="/onboarding/select-organization"
          signUpFallbackRedirectUrl="/onboarding/select-organization"
        />
      </AuthShell>
    </ClerkAvailabilityGate>
  );
}
