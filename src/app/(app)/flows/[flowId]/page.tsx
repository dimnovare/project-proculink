"use client";

import { Suspense, use } from "react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { FlowPage } from "@/components/flows/FlowPage";

export default function FlowRoute({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = use(params);
  // FlowPage reads the address (useSearchParams); until it can, the page still names itself and the way back.
  return (
    <Suspense fallback={<PageShell variant="wide"><PageHeader title="Flow" back={{ href: "/flows", label: "Flows" }} /></PageShell>}>
      <FlowPage flowId={flowId} />
    </Suspense>
  );
}
