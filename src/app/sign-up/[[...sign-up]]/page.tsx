import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { AuthShell, AuthHeading, clerkAppearance } from "@/components/auth/AuthSurface";
import { ClerkAvailabilityGate } from "@/components/bridge/ClerkAvailabilityGate";
import { PLAN_BY_ID } from "@/lib/plans";

/* The trial allowance in the sub-heading is read off the ladder, not typed. It is the
   first promise a new buyer reads, and it is made on a screen that no pricing change
   would ever bring anyone back to — so a Pilot re-sized in plans.ts would have kept
   selling the old number here. `priceCadence` is Pilot's price sub-label and, for the
   trial tier, it IS the trial window ("14 days").

   The line now names the supplier allowance too ("20 orders · 1 supplier · …"), because
   the Pilot is pitched as a test of ONE repeat supplier and the supplier cap is the limit
   a new buyer meets first. It keeps the trial window: the Pilot is not free forever, and a
   sign-up line that dropped "14 days" would read as if it were. */
const PILOT = PLAN_BY_ID.pilot;
const PILOT_SUPPLIERS = PILOT.supplierLimit ?? 0;
const PILOT_TRIAL_OFFER =
  `${PILOT.orderLimit} orders · ${PILOT_SUPPLIERS} ${PILOT_SUPPLIERS === 1 ? "supplier" : "suppliers"} · ` +
  `${PILOT.priceCadence} · no credit card`;
const PILOT_TRIAL_DETAIL =
  "Test one real, test or anonymised supplier workflow before deciding whether ProcuLink is right for you.";

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
        <AuthHeading title="Start your FREE Pilot" sub={PILOT_TRIAL_OFFER} detail={PILOT_TRIAL_DETAIL} />
        <SignUp
          appearance={clerkAppearance}
          fallbackRedirectUrl="/onboarding/select-organization"
          signInFallbackRedirectUrl="/onboarding/select-organization"
        />
        <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 20, color: "var(--ink-muted)" }}>
          Based on a repeat supplier and want more help?{" "}
          <Link
            href="/pilot"
            style={{ fontWeight: 600, color: "var(--brand-blue-deep)", textDecoration: "none" }}
          >
            Apply for a FREE supported pilot →
          </Link>
        </p>
      </AuthShell>
    </ClerkAvailabilityGate>
  );
}
