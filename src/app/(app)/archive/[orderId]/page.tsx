"use client";

import { use } from "react";
import { OrderArchiveDetail } from "@/components/archive/OrderArchiveDetail";

export default function ArchiveOrderRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  return <OrderArchiveDetail orderId={orderId} />;
}
