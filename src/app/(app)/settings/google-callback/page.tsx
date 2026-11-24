"use client";

// Google redirects here after the consent screen (plan 9b, R9); ConnectCallback finishes the exchange.

import { ConnectCallback } from "@/components/flows/ConnectCallback";
import { completeGoogleConnect } from "@/lib/api/linkedAccounts";
import { destinationsAddress } from "@/lib/destinations";

export default function GoogleCallbackPage() {
  return (
    <ConnectCallback
      provider="google"
      title="Google account"
      complete={completeGoogleConnect}
      copy={{
        denied: ["Google access was not granted. Close this window and try again.", "Google access was not granted, so nothing was connected."],
        connected: ["Google account connected. You can close this window.", "Google account connected."],
        working: "Connecting your Google account…",
        back: { href: destinationsAddress(), label: "Back to destinations" },
      }}
    />
  );
}
