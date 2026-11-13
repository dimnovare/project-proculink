"use client";

// Google redirects here after the consent screen (plan 9b, R9). The page finishes the exchange, then
// tells the destination form that opened it, or — when the popup was blocked and the whole tab went
// to Google — goes back to where the user started.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { completeGoogleConnect } from "@/lib/api/linkedAccounts";
import { documentRefusalMessage } from "@/lib/documentRefusals";

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
      if (window.opener) {
        window.opener.postMessage({ type: "proculink:google-connected" }, location.origin);
        window.close();
      } else router.replace(result.returnTo ?? "/flows");
      return result;
    },
    enabled: granted && enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const [tone, text] = !granted
    ? (["error", "Google access was not granted. Close this window and try again."] as const)
    : done.isError
      ? (["error", documentRefusalMessage(done.error)] as const)
      : done.isSuccess
        ? (["success", "Google account connected. You can close this window."] as const)
        : (["working", "Connecting your Google account…"] as const);
  return (
    <PageShell>
      <StatusNotice tone={tone}>{text}</StatusNotice>
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
