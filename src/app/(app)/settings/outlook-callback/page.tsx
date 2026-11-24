"use client";

// Microsoft redirects here after its sign-in for a mailbox pickup (plan 30); ConnectCallback finishes the exchange.

import { ConnectCallback } from "@/components/flows/ConnectCallback";
import { completeOutlookConnect } from "@/lib/api/linkedAccounts";

// Any ?error= reads the same: in most work tenants the refusal is "an admin must approve", which the user cannot fix alone.
const DENIED = "Microsoft access was not granted. If your organization's Microsoft 365 admin must approve new apps, ask them to approve ProcuLink, then try again.";

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
