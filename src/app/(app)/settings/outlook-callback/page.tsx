"use client";

// Microsoft redirects here after its sign-in for a mailbox pickup (plan 30); ConnectCallback finishes the exchange.

import { ConnectCallback, MICROSOFT_DENIED as DENIED } from "@/components/flows/ConnectCallback";
import { completeOutlookConnect } from "@/lib/api/linkedAccounts";

export default function OutlookCallbackPage() {
  return (
    <ConnectCallback
      provider="outlook"
      title="Microsoft mailbox"
      complete={completeOutlookConnect}
      copy={{
        denied: [DENIED, DENIED],
        connected: ["Microsoft mailbox connected. You can close this window.", "Microsoft mailbox connected."],
        working: "Connecting your Microsoft mailbox…",
        back: { href: "/flows", label: "Back to flows" },
      }}
    />
  );
}
