import type { Metadata } from "next";
import { ConnectionsList } from "@/components/connections/ConnectionsList";

export const metadata: Metadata = {
  // The page's name is the word the nav uses to reach it (HubTabs.tsx, suppliers
  // hub). A tab labelled "Supplier changes" that opens a tab titled "Connections"
  // is the same mismatch the visible copy had.
  title: "Supplier changes — ProcuLink",
  description: "Versioned supplier connections — input mapping, output template, delivery and item codes, bundled per supplier.",
};

export default function ConnectionsPage() {
  return <ConnectionsList />;
}
