"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AdvancedView } from "@/components/flows/advanced/AdvancedView";

export default function FlowOutputAdvancedRoute({ params }: { params: Promise<{ flowId: string; outputId: string }> }) {
  const { flowId, outputId } = use(params);
  return <AdvancedView flowId={flowId} outputId={outputId} documentId={useSearchParams().get("document")} />;
}
