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
 */
export const CLERK_LOAD_DEADLINE_MS = 8_000;

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

export function ClerkAvailabilityGate({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth();
  const queriesEnabled = useQueriesEnabled();

  const { status, restart } = useDependencyReady({
    ready: isLoaded,
    armed: !queriesEnabled,
    timeoutMs: CLERK_LOAD_DEADLINE_MS,
  });

  const onRetry = React.useCallback(() => {
    // Re-arm first, so a reload that never happens (extension, offline) returns
    // the UI to its normal waiting state instead of freezing on a dead card.
    restart();
    // The script is injected once, at document level, by ClerkProvider, and
    // there is no public API to re-invoke its load. Re-requesting a resource the
    // browser failed to fetch means re-requesting the document.
    reloadPage();
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
            load it. Until it loads, your workspace can&rsquo;t open.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            This is usually a temporary outage, an ad blocker, or a company network that
            blocks the address below. Nothing was changed &mdash; your orders and settings
            are exactly as you left them.
          </p>
        </>
      }
    />
  );
}
