import type { Metadata } from "next";
import { InboxView } from "@/components/bridge/InboxView";

export const metadata: Metadata = {
  title: "Inbox — ProcuLink",
};

export default function InboxPage() {
  return <InboxView />;
}
