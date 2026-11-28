"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listFlowVersions, restoreFlowVersion, type FlowVersionChange } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { formatDate } from "@/lib/format-date";
import { standardName } from "@/lib/standardOutputs";
import { useFlowSaved } from "./PublishBar";
import { Failed, Quiet, Loading } from "./states";

/** Each change as [one name, a count]: one named thing, or how many. */
const PHRASES: Record<string, [(x: string) => string, (n: number) => string]> = {
  "version.first": [() => "First version", () => "First version"],
  "value.added": [(x) => `Added a value: ${x}`, (n) => `Added ${n} values`],
  "value.removed": [(x) => `Removed a value: ${x}`, (n) => `Removed ${n} values`],
  "value.renamed": [(x) => `Renamed a value to ${x}`, (n) => `Renamed ${n} values`],
  "value.meaning": [(x) => `Changed what ${x} means`, (n) => `Changed what ${n} values mean`],
  "value.changed": [(x) => `Changed ${x}`, (n) => `Changed ${n} values`],
  "check.added": [(x) => `New check on ${x}`, (n) => `New checks on ${n} values`],
  "check.removed": [(x) => `Removed the check on ${x}`, (n) => `Removed checks on ${n} values`],
  "check.changed": [(x) => `Changed the check on ${x}`, (n) => `Changed checks on ${n} values`],
  "table.added": [(x) => `Added a table: ${x}`, (n) => `Added ${n} tables`],
  "table.removed": [(x) => `Removed a table: ${x}`, (n) => `Removed ${n} tables`],
  "table.renamed": [(x) => `Renamed a table to ${x}`, (n) => `Renamed ${n} tables`],
  "standard.added": [(x) => `Added a standard file: ${standardName(x)}`, (n) => `Added ${n} standard files`],
  "output.added": [(x) => `Added a file: ${x}`, (n) => `Added ${n} files`],
  "output.removed": [(x) => `Removed a file: ${x}`, (n) => `Removed ${n} files`],
  "output.renamed": [(x) => `Renamed a file to ${x}`, (n) => `Renamed ${n} files`],
  "output.standard": [(x) => `Changed the standard of ${x}`, (n) => `Changed the standard of ${n} files`],
  "output.contents": [(x) => `Changed what ${x} contains`, (n) => `Changed what ${n} files contain`],
  "output.when": [(x) => `Changed when ${x} is sent`, (n) => `Changed when ${n} files are sent`],
  "output.destination": [(x) => `Changed where ${x} goes`, (n) => `Changed where ${n} files go`],
};

/** One line for a version: up to three changes, then how many more. A change this build does not know reads "Other changes". */
export function versionSummary(changes: FlowVersionChange[]): string {
  const parts = [...new Set(changes.map((c) => {
    const p = PHRASES[`${c.section}.${c.action}`];
    return p ? (c.names.length === 1 ? p[0](c.names[0]) : p[1](c.names.length)) : "Other changes";
  }))];
  return parts.slice(0, 3).join(" · ") + (parts.length > 3 ? ` and ${parts.length - 3} more` : "");
}

/** `onRestored` runs after a restore has replaced the draft, so the page can reset its editors. */
export function FlowVersionsPanel({ flowId, onRestored }: { flowId: string; onRestored?: () => void }) {
  const confirm = useConfirm();
  const saved = useFlowSaved(flowId);
  const [restored, setRestored] = useState<number | null>(null);
  const versions = useQuery({ queryKey: ["flow-versions", flowId], queryFn: () => listFlowVersions(flowId), enabled: useTenantQueriesEnabled() });
  const restore = useMutation({
    mutationFn: (n: number) => restoreFlowVersion(flowId, n),
    onSuccess: (f, n) => { setRestored(n); saved(f); onRestored?.(); },
  });
  const ask = async (n: number) => {
    if (await confirm({
      title: `Restore version ${n}?`, description: `This replaces your changes with version ${n}. Press Use these changes to put it in use.`, confirmLabel: "Restore",
    })) restore.mutate(n);
  };
  if (versions.isError) return <Failed error={versions.error} retry={() => versions.refetch()} />;
  if (!versions.data) return <Loading>Loading versions…</Loading>;
  if (versions.data.length === 0) return <Quiet>No versions yet. Save this setup to keep its first version.</Quiet>;
  return (
    <div className="grid gap-2">
      {restored !== null && <StatusNotice tone="success">{`Version ${restored} is back in your changes. Press Use these changes to put it in use.`}</StatusNotice>}
      {restore.isError && <StatusNotice tone="error">{documentRefusalMessage(restore.error)}</StatusNotice>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {versions.data.map((v) => (
          <li key={v.versionNo}>
            <Card dense>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="grid">
                  <span className="text-[13.5px] font-medium">{`Version ${v.versionNo}`}</span>
                  {v.changes?.length ? <span className="text-[12.5px] text-ink">{versionSummary(v.changes)}</span> : null}
                  <span className="text-[12.5px] text-ink-muted">{`Put in use ${formatDate(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ""}`}</span>
                </span>
                {v.live ? (
                  <span className="rounded bg-brand-green-soft px-2 py-0.5 text-[12.5px] font-medium">In use</span>
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
