import type { Metadata } from "next";
import { ConnectionDetail } from "@/components/connections/ConnectionDetail";

export const metadata: Metadata = {
  title: "Connection — ProcuLink",
  description: "How this supplier's orders are mapped, validated and delivered — with version history.",
};

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function ConnectionDetailPage({ params }: Props) {
  const { connectionId } = await params;
  return <ConnectionDetail connectionId={connectionId} />;
}
