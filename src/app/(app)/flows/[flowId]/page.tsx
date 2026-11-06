"use client";

import { use } from "react";
import { FlowPage } from "@/components/flows/FlowPage";

export default function FlowRoute({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = use(params);
  return <FlowPage flowId={flowId} />;
}
