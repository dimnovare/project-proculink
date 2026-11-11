"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { EmptyState } from "@/components/bridge/EmptyState";
import { UploadWorkbench } from "@/components/bridge/UploadWorkbench";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { Failed, Quiet } from "./states";
import { FlowUpload } from "./FlowUpload";

/** Engine on: pick a flow, upload into it. Anything else (including a probe still loading): the legacy workbench. */
export function UploadEntry() {
  return useDocumentEngine() === "on" ? <UploadToFlow /> : <UploadWorkbench />;
}

export function UploadToFlow() {
  const router = useRouter();
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const [picked, setPicked] = useState<string | null>(null);
  const list = flows.data ?? [];
  const flowId = list.find((f) => f.id === picked)?.id ?? list[0]?.id;

  let body;
  if (flows.isError) {
    body = <Failed error={flows.error} retry={() => void flows.refetch()} />;
  } else if (!flows.data) {
    body = <Quiet>Loading flows…</Quiet>;
  } else if (!flowId) {
    body = (
      <Card>
        <EmptyState
          compact
          title="Set up your first flow"
          sub="A flow tells us what to read from your documents and where to send it."
          action={{ label: "New flow", onClick: () => router.push("/flows/new") }}
        />
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {list.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="upload-flow" className="font-medium" style={{ fontSize: 13 }}>Flow</label>
            <select
              id="upload-flow"
              value={flowId}
              onChange={(e) => setPicked(e.target.value)}
              className="rounded-md border px-2 py-1.5"
              style={{ fontSize: 13, borderColor: "var(--border)", background: "var(--surface)" }}
            >
              {list.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Choose the flow that should read this document.</span>
          </div>
        )}
        <FlowUpload key={flowId} flowId={flowId} onUploaded={(d) => router.push(`/flows/${flowId}/documents/${d.id}`)} />
      </div>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader title="Upload a document" />
      {body}
    </PageShell>
  );
}
