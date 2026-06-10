import type { Metadata } from "next";
import { ConnectionsList } from "@/components/connections/ConnectionsList";

export const metadata: Metadata = {
  title: "Connections — ProcuLink",
  description: "Versioned supplier connections — input mapping, output template, delivery and item codes, bundled per supplier.",
};

export default function ConnectionsPage() {
  return <ConnectionsList />;
}
