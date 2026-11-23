"use client";

// Google redirects here after the consent screen (plan 9b, R9). The page finishes the exchange and
// announces it on a BroadcastChannel (Google's sign-in pages can sever window.opener), then closes the
// popup — or, when the popup was blocked and the whole tab went to Google, goes back to `returnTo`.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { destinationsAddress } from "@/lib/destinations";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { GOOGLE_CONNECT_CHANNEL, completeGoogleConnect } from "@/lib/api/linkedAccounts";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { isAppPath } from "@/lib/appPath";

/** A same-site path (`isAppPath`, the same check as GoogleConnectService.Start), else /flows. */
const safePath = (p: string) => (isAppPath(p) ? p : "/flows");

function GoogleCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const code = params.get("code");
  const state = params.get("state");
  const granted = !params.get("error") && !!code && !!state;
  // Keyed by `state` with no retry: a code can be exchanged once, and StrictMode's second mount
  // joins the first request instead of sending another.
  const done = useQuery({
    queryKey: ["google-complete", state],
    queryFn: async () => {
      const result = await completeGoogleConnect(code!, state!);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(GOOGLE_CONNECT_CHANNEL);
        channel.postMessage({ type: "connected" });
        channel.close();
      }
      // No returnTo means a popup: close it (the copy below covers a refused close).
      if (result.returnTo == null) window.close();
      else router.replace(safePath(result.returnTo));
      return result;
    },
    enabled: granted && enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  // A popup has an opener; when the whole tab went to Google there is none, and "close this window" would be wrong.
  // Read after mount so the server render and the first client render agree.
  // A finished exchange with no returnTo was started from a popup too (Google can sever the opener).
  const [opener, setOpener] = useState(false);
  useEffect(() => setOpener(!!window.opener), []);
  const popup = opener || (done.isSuccess && done.data.returnTo == null);

  const [tone, text] = !granted
    ? (["error", popup ? "Google access was not granted. Close this window and try again." : "Google access was not granted, so nothing was connected."] as const)
    : done.isError
      ? (["error", documentRefusalMessage(done.error)] as const)
      : done.isSuccess
        ? (["success", popup ? "Google account connected. You can close this window." : "Google account connected."] as const)
        : (["working", "Connecting your Google account…"] as const);
  return (
    <PageShell>
      <PageHeader title="Google account" />
      <StatusNotice
        tone={tone}
        action={tone === "working" ? undefined : popup ? (
          <Button variant="secondary" size="sm" onClick={() => window.close()}>Close</Button>
        ) : (
          <Link href={destinationsAddress()} className={buttonClass("secondary", "sm")}>Back to destinations</Link>
        )}
      >
        {text}
      </StatusNotice>
    </PageShell>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense>
      <GoogleCallback />
    </Suspense>
  );
}
