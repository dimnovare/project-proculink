import type { Metadata } from "next";
import { ConnectionDetail } from "@/components/connections/ConnectionDetail";

export const metadata: Metadata = {
  title: "Connection — ProcuLink",
  description: "The versioned bundle this supplier receives, with revision lifecycle controls.",
};

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function ConnectionDetailPage({ params }: Props) {
  const { connectionId } = await params;
  return <ConnectionDetail connectionId={connectionId} />;
}
