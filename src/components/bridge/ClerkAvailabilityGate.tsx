"use client";

// ClerkAvailabilityGate — WP-32.
//
// THE BUG. Sign-in is a hard dependency: no session token means no org_id, no
// nav data, no workspace. Every (app) data query is gated on
// `useQueriesEnabled()`, which is
// `isApiMockMode || isQaBypass || (isLoaded && !!isSignedIn)`. If the sign-in
// service's hosted JS never arrives — ad blocker, corporate proxy, provider
// outage — `isLoaded` never flips, and in a production build the other two flags
// are compiled to false. So the gate is false for the lifetime of the tab, every
// query stays disabled, and all 28 consumers render their loading branch
// forever. There was no timeout anywhere in that chain: a blocked script and a
// hang were indistinguishable.
//
// THE FIX. One gate at the (app) layout, not 28 patched loading branches. After
// CLERK_LOAD_DEADLINE_MS with no load, stop waiting and say what happened.
//
// WHY `armed` IS `!queriesEnabled` AND `ready` IS `isLoaded`:
//
//   mock mode        queriesEnabled true  → disarmed. These builds hand
//   QA-bypass e2e    queriesEnabled true  → disarmed. ClerkProvider an EMPTY
//                                           publishable key on purpose
//                                           (src/app/layout.tsx), so `isLoaded`
//                                           is legitimately false forever and
//                                           the app works fine. Arming here
//                                           would put this card in front of the
//                                           whole e2e suite.
//   signed out,      isLoaded TRUE        → ready. A signed-out user must never
//   service fine                            be told the service is down;
//                                           middleware sends them to /sign-in.
//   script blocked   isLoaded false,      → the card, after the deadline.
//                    queriesEnabled false
//
// A LATE ARRIVAL NEEDS NO RETRY: `isLoaded` is reactive, so if the script turns
// up at second 12 the card unmounts by itself.
//
// FOLLOW-UP (F1, F2, F3, F7). Three things were wrong with the first pass:
//
//   • It only covered (app). But src/middleware.ts sends every signed-out
//     request on a protected route to /sign-in, which is NOT in (app) — so the
//     commonest real instance of "the sign-in service is blocked" landed on a
//     page the gate could not reach, and got a "Welcome back" heading above an
//     empty box with no spinner, no error and no timeout. <SignInServiceGate>
//     is the reusable half; /sign-in, /sign-up and the org gate all mount it.
//   • The deadline started at mount, i.e. after hydration, while the promise it
//     serves is wall clock. See `since: "navigation"` below.
//   • Retry re-armed before the navigation landed, flashing the broken shell
//     back; and the copy named causes a reload cannot fix without saying so.

import * as React from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useDependencyReady } from "@/hooks/useDependencyReady";
import { reloadPage } from "@/lib/reload";
import { DependencyUnavailable } from "./DependencyUnavailable";

/**
 * How long to wait for the sign-in service before declaring it unreachable.
 *
 * 8s: under the 10s product ceiling with room for React to commit and paint,
 * and above the 5s Clerk wait already baked into authHeader()
 * (src/lib/api/core.ts) so this can never pre-empt a slow-but-successful load
 * that the fetch path would still have honoured.
 *
 * Measured from NAVIGATION, not from mount — see `since: "navigation"` below.
 */
export const CLERK_LOAD_DEADLINE_MS = 8_000;

/**
 * How long "Try again" waits before re-arming, when the reload never happens.
 *
 * Re-arming is for the case where the reload is suppressed (an extension, a
 * dead network) — without it the card would freeze with no way back. But
 * committing that state change immediately un-hid the entire spinning shell
 * for the ~500ms before the navigation landed: the exact thing the card exists
 * to replace, flashed back on every click. Deferring past the navigation gets
 * both — a real reload tears this timer down with the document, so it only
 * ever fires when the reload did not happen.
 */
export const REARM_AFTER_RELOAD_MS = 1_500;

/**
 * Which failure this is, from the reader's point of view. Same dependency,
 * same host, same recovery — different consequence, so different second
 * sentence. On /sign-in nothing can be "exactly as you left it" yet, and no
 * workspace is being kept shut; what is blocked is signing in.
 */
export type SignInSurface = "workspace" | "auth";

/**
 * The sign-in host, decoded from the publishable key. Clerk encodes it as
 * `pk_(test|live)_<base64("<host>$")>` — verified against the vendored
 * parsePublishableKey in @clerk/shared, not assumed. Inlined rather than
 * imported because @clerk/shared is a transitive dependency, not a declared one.
 *
 * Worth showing: it is the exact string an operator's IT has to allow.
 */
export function signInHostFromPublishableKey(key: string | undefined): string | null {
  const encoded = (key ?? "").split("_")[2];
  if (!encoded) return null;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Where to send someone who cannot sign in. NEXT_PUBLIC_STATUS_URL is this
 * repo's existing status-page convention (see the marketing footer); when it is
 * unset, /support is a public marketing route whose contact form imports nothing
 * from Clerk, so it still works. /operations/health is deliberately NOT offered:
 * it gates on useQueriesEnabled itself, so it is a victim of this same bug.
 */
function helpDestination(): { href: string; label: string; external?: boolean } {
  const status = process.env.NEXT_PUBLIC_STATUS_URL;
  if (status) return { href: status, label: "Check service status", external: true };
  return { href: "/support", label: "Get help" };
}

/**
 * The bounded wait plus the card, with no opinion about how "ready" is
 * measured. (app) reads it off `useAuth().isLoaded`; the org gate reads it off
 * whether its own decision has resolved. Both stall on the same service, so
 * both say the same thing.
 */
export function SignInServiceGate({
  ready,
  armed,
  surface = "workspace",
  children,
}: {
  ready: boolean;
  armed: boolean;
  surface?: SignInSurface;
  children: React.ReactNode;
}) {
  const { status, restart } = useDependencyReady({
    ready,
    armed,
    timeoutMs: CLERK_LOAD_DEADLINE_MS,
    // The script is requested by the DOCUMENT — ClerkProvider renders
    // `<script src="https://<host>/…/clerk.browser.js" async>`, so the browser
    // starts fetching it while the HTML is still parsing. Everything that
    // happens before this component mounts (document fetch, bundle download,
    // parse, hydrate) is time the dependency has already had. Starting the
    // clock at mount hands all of it back and makes the wall-clock wait grow
    // with page load time.
    since: "navigation",
  });

  const rearmTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (rearmTimer.current) clearTimeout(rearmTimer.current);
    },
    [],
  );

  const onRetry = React.useCallback(() => {
    // The script is injected once, at document level, by ClerkProvider, and
    // there is no public API to re-invoke its load. Re-requesting a resource the
    // browser failed to fetch means re-requesting the document.
    reloadPage();
    // Only reached if that navigation never happens.
    if (rearmTimer.current) clearTimeout(rearmTimer.current);
    rearmTimer.current = setTimeout(restart, REARM_AFTER_RELOAD_MS);
  }, [restart]);

  if (status !== "unavailable") return <>{children}</>;

  return (
    <DependencyUnavailable
      name="sign-in service"
      detailLabel="Sign-in address"
      detail={signInHostFromPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) ?? undefined}
      onRetry={onRetry}
      help={helpDestination()}
      body={
        <>
          <p style={{ margin: 0 }}>
            ProcuLink signs you in through an outside service, and your browser could not
            load it.{" "}
            {surface === "auth"
              ? "Until it loads, you can’t sign in or create an account."
              : "Until it loads, your workspace can’t open."}
          </p>
          <p style={{ margin: "10px 0 0" }}>
            This is usually a temporary outage, an ad blocker, or a company network that
            blocks the address below. Trying again only helps once an outage has ended
            &mdash; if an ad blocker or your company network is blocking that address, it
            has to be allowed first.
          </p>
          {surface === "workspace" && (
            <p style={{ margin: "10px 0 0" }}>
              Nothing was changed &mdash; your orders and settings are exactly as you left
              them.
            </p>
          )}
        </>
      }
    />
  );
}

export function ClerkAvailabilityGate({
  children,
  surface = "workspace",
}: {
  children: React.ReactNode;
  surface?: SignInSurface;
}) {
  const { isLoaded } = useAuth();
  const queriesEnabled = useQueriesEnabled();

  return (
    <SignInServiceGate ready={isLoaded} armed={!queriesEnabled} surface={surface}>
      {children}
    </SignInServiceGate>
  );
}
