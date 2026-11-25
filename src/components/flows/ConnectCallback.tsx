"use client";

// A provider redirects here after its consent screen (plan 9b R9; plan 30 for Microsoft). The page finishes the exchange
// and announces it on a BroadcastChannel (sign-in pages can sever window.opener), then closes the popup — or, when the
// popup was blocked and the whole tab went to the provider, goes back to `returnTo`.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { GOOGLE_CONNECT_CHANNEL, type GoogleConnected, type LinkedProvider } from "@/lib/api/linkedAccounts";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { isAppPath } from "@/lib/appPath";

/** A same-site path (`isAppPath`, the same check as GoogleConnectService.Start), else /flows. */
const safePath = (p: string) => (isAppPath(p) ? p : "/flows");

/** Any Microsoft ?error= reads the same: in most work tenants the refusal is "an admin must approve", which the user cannot fix alone. */
export const MICROSOFT_DENIED = "Microsoft access was not granted. If your organization's Microsoft 365 admin must approve new apps, ask them to approve ProcuLink, then try again.";

/** Each pair is [in a popup, in a whole tab]. */
export interface ConnectCopy {
  denied: readonly [string, string];
  connected: readonly [string, string];
  working: string;
  back: { href: string; label: string };
}

interface Props {
  provider: LinkedProvider;
  title: string;
  complete: (code: string, state: string) => Promise<GoogleConnected>;
  copy: ConnectCopy;
}

function Callback({ provider, title, complete, copy }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const code = params.get("code");
  const state = params.get("state");
  const granted = !params.get("error") && !!code && !!state;
  // Keyed by `state` with no retry: a code can be exchanged once, and StrictMode's second mount
  // joins the first request instead of sending another.
  const done = useQuery({
    queryKey: [`${provider}-complete`, state],
    queryFn: async () => {
      const result = await complete(code!, state!);
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

  // A popup has an opener; when the whole tab went to the provider there is none, and "close this window" would be wrong.
  // Read after mount so the server render and the first client render agree.
  // A finished exchange with no returnTo was started from a popup too (the provider can sever the opener).
  const [opener, setOpener] = useState(false);
  useEffect(() => setOpener(!!window.opener), []);
  const popup = opener || (done.isSuccess && done.data.returnTo == null);
  const pick = (pair: readonly [string, string]) => pair[popup ? 0 : 1];

  const [tone, text] = !granted
    ? (["error", pick(copy.denied)] as const)
    : done.isError
      ? (["error", documentRefusalMessage(done.error)] as const)
      : done.isSuccess
        ? (["success", pick(copy.connected)] as const)
        : (["working", copy.working] as const);
  return (
    <PageShell>
      <PageHeader title={title} />
      <StatusNotice
        tone={tone}
        action={tone === "working" ? undefined : popup ? (
          <Button variant="secondary" size="sm" onClick={() => window.close()}>Close</Button>
        ) : (
          <Link href={copy.back.href} className={buttonClass("secondary", "sm")}>{copy.back.label}</Link>
        )}
      >
        {text}
      </StatusNotice>
    </PageShell>
  );
}

export function ConnectCallback(props: Props) {
  return (
    <Suspense>
      <Callback {...props} />
    </Suspense>
  );
}
