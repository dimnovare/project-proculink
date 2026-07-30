import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/bridge/InboxView";
import { BridgePageLoader } from "@/components/bridge/BridgeLoader";

export const metadata: Metadata = {
  title: "Inbox — ProcuLink",
};

export default function InboxPage() {
  // InboxView derives its filter state from the URL (useSearchParams), which needs
  // a Suspense boundary in the App Router or this route fails to prerender.
  return (
    <Suspense fallback={<BridgePageLoader label="Loading your orders…" sub="Fetching the queue." />}>
      <InboxView />
    </Suspense>
  );
}
