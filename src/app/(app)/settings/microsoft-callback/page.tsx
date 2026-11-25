"use client";

// Microsoft redirects here after its sign-in for a OneDrive destination (plan 30 Part B); ConnectCallback finishes the exchange.

import { ConnectCallback, MICROSOFT_DENIED as DENIED } from "@/components/flows/ConnectCallback";
import { completeMicrosoftConnect } from "@/lib/api/linkedAccounts";
import { destinationsAddress } from "@/lib/destinations";

export default function MicrosoftCallbackPage() {
  return (
    <ConnectCallback
      provider="microsoft"
      title="Microsoft account"
      complete={completeMicrosoftConnect}
      copy={{
        denied: [DENIED, DENIED],
        connected: ["Microsoft account connected. You can close this window.", "Microsoft account connected."],
        working: "Connecting your Microsoft account…",
        back: { href: destinationsAddress(), label: "Back to destinations" },
      }}
    />
  );
}
