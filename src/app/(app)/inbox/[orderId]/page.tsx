import type { Metadata } from "next";
import { OrderWorkshop } from "@/components/bridge/workshop/OrderWorkshop";

export const metadata: Metadata = {
  title: "Order Review — ProcuLink",
};

interface Props {
  params: Promise<{ orderId: string }>;
}

export default async function OrderSpinePage({ params }: Props) {
  const { orderId } = await params;
  return <OrderWorkshop orderId={orderId} />;
}
