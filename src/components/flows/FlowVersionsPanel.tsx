"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listFlowVersions, restoreFlowVersion } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { formatDate } from "@/lib/format-date";
import { useFlowSaved } from "./FlowChangesBar";
import { Failed, Quiet } from "./states";

export function FlowVersionsPanel({ flowId }: { flowId: string }) {
  const confirm = useConfirm();
  const saved = useFlowSaved(flowId);
  const [restored, setRestored] = useState<number | null>(null);
  const versions = useQuery({ queryKey: ["flow-versions", flowId], queryFn: () => listFlowVersions(flowId), enabled: useTenantQueriesEnabled() });
  const restore = useMutation({
    mutationFn: (n: number) => restoreFlowVersion(flowId, n),
    onSuccess: (f, n) => { setRestored(n); saved(f); },
  });
  const ask = async (n: number) => {
    if (await confirm({
      title: `Restore version ${n}?`, description: `This replaces your unpublished changes with version ${n}. Publish to make it live.`, confirmLabel: "Restore",
    })) restore.mutate(n);
  };
  if (versions.isError) return <Failed error={versions.error} retry={() => versions.refetch()} />;
  if (!versions.data) return <Quiet>Loading versions…</Quiet>;
  if (versions.data.length === 0) return <Quiet>No versions yet. Publish this flow to save its first version.</Quiet>;
  return (
    <div className="grid gap-2">
      {restored !== null && <StatusNotice tone="success">{`Version ${restored} is back in your changes. Publish to make it live.`}</StatusNotice>}
      {restore.isError && <StatusNotice tone="error">{documentRefusalMessage(restore.error)}</StatusNotice>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {versions.data.map((v) => (
          <li key={v.versionNo}>
            <Card dense>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="grid">
                  <span className="text-[13.5px] font-medium">{`Version ${v.versionNo}`}</span>
                  <span className="text-[12px] text-ink-muted">{`Published ${formatDate(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ""}`}</span>
                </span>
                {v.live ? (
                  <span className="rounded bg-brand-green-soft px-2 py-0.5 text-[12px] font-medium">Live</span>
                ) : (
                  <Button size="sm" variant="secondary" loading={restore.isPending && restore.variables === v.versionNo} onClick={() => ask(v.versionNo)}>Restore</Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
