import type { Metadata } from "next";
import { SpineReview } from "@/components/bridge/SpineReview";

export const metadata: Metadata = {
  title: "Order Review — ProcuLink",
};

interface Props {
  params: Promise<{ orderId: string }>;
}

export default async function OrderSpinePage({ params }: Props) {
  const { orderId } = await params;
  return <SpineReview orderId={orderId} />;
}
