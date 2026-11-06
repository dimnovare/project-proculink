"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  downloadDeliveryFile, listDeliveries, listDestinations, listOutputs, previewOutput, sendDocument,
} from "@/lib/api/documents";
import type { DocumentDelivery, DocumentDetail } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { saveBlob } from "@/lib/saveBlob";
import { FORMATS } from "./OutputEditor";

// An unknown token shows as itself, never as a success word.
const CHANNELS = new Map([["", "Download"], ["email", "Email"], ["http", "Web address"], ["sftp", "SFTP"], ["ftps", "FTPS"]]);
const STATUSES = new Map([
  ["queued", "Waiting"], ["delivering", "Sending"], ["delivered", "Delivered"],
  ["stored", "Ready to download"], ["failed", "Will retry"], ["dead_letter", "Couldn't deliver"],
]);
const BAD = new Set(["failed", "dead_letter"]);
const BUSY = new Set(["queued", "delivering"]);

const Failed = ({ error, retry }: { error: unknown; retry(): void }) => (
  <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={retry}>Retry</Button>}>
    {documentRefusalMessage(error)}
  </StatusNotice>
);
const Quiet = ({ children }: { children: string }) => <p role="status" className="m-0 text-[12.5px] text-ink-muted">{children}</p>;

function Deliveries({ documentId }: { documentId: string }) {
  const enabled = useTenantQueriesEnabled();
  const deliveries = useQuery({
    queryKey: ["deliveries", documentId], queryFn: () => listDeliveries(documentId), enabled,
    refetchInterval: (q) => {
      const s = q.state.data?.map((d) => d.status) ?? [];
      return s.some((x) => BUSY.has(x)) ? 2000 : s.includes("failed") ? 5000 : false; // failed rows are retried by the server
    },
  });
  const download = useMutation({
    mutationFn: async (d: DocumentDelivery) => saveBlob(await downloadDeliveryFile(documentId, d.id), d.fileName!),
  });
  if (deliveries.isError && !deliveries.data) return <Failed error={deliveries.error} retry={() => deliveries.refetch()} />;
  if (!deliveries.data) return <Quiet>Loading deliveries…</Quiet>;
  if (deliveries.data.length === 0) return <Quiet>Nothing sent yet.</Quiet>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {download.isError && <StatusNotice tone="error">{documentRefusalMessage(download.error)}</StatusNotice>}
      {deliveries.data.map((d) => (
        <li key={d.id} className="grid gap-0.5 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">{d.outputName}</span>
            <span className={BAD.has(d.status) || !STATUSES.has(d.status) ? "text-danger" : "text-ink-muted"}>
              {CHANNELS.get(d.protocol) ?? d.protocol} · {STATUSES.get(d.status) ?? d.status} · {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}
            </span>
            {d.fileName !== null && (
              <Button size="sm" variant="secondary" loading={download.isPending && download.variables?.id === d.id} onClick={() => download.mutate(d)}>
                Download
              </Button>
            )}
          </div>
          {d.lastError && <span className="text-danger">{d.lastError}</span>}
        </li>
      ))}
    </ul>
  );
}

export function DocumentOutputsPanel({ flowId, document: doc }: { flowId: string; document: DocumentDetail }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const documentId = doc.summary.id;
  const outputs = useQuery({ queryKey: ["outputs", flowId], queryFn: () => listOutputs(flowId), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const preview = useMutation({ mutationFn: (outputId: string) => previewOutput(documentId, outputId) });
  const send = useMutation({
    mutationFn: () => sendDocument(documentId),
    onSuccess: () => Promise.all(["document", "deliveries"].map((k) => qc.invalidateQueries({ queryKey: [k, documentId] }))),
  });
  const canSend = documentStatus(doc.summary.status, doc.summary.statusReason).editable;
  const destinationName = (id: string | null) =>
    !id ? "Download only" : destinations.data?.find((d) => d.id === id)?.name ?? (destinations.isError ? "Unknown destination" : "…");

  return (
    <Card edge="green" as="section" aria-labelledby="doc-outputs" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="doc-outputs" className="m-0 text-[13px] font-semibold text-ink">Outputs</h2>
        <Button variant="send" size="sm" disabled={!canSend} loading={send.isPending} onClick={() => send.mutate()}>Send</Button>
      </div>
      <div className="grid gap-3">
        {send.isError && <StatusNotice tone="error">{documentRefusalMessage(send.error)}</StatusNotice>}
        {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
        {outputs.isError && !outputs.data ? <Failed error={outputs.error} retry={() => outputs.refetch()} />
          : !outputs.data ? <Quiet>Loading outputs…</Quiet>
          : outputs.data.length === 0 ? <Link href={`/flows/${flowId}?tab=outputs`} className="text-[13px] text-brand-blue">Add an output to this flow</Link>
          : outputs.data.map((o) => (
            <div key={o.id} className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{o.name}</span>
                <span className="text-[12px] text-ink-muted">{Object.hasOwn(FORMATS, o.format) ? FORMATS[o.format as keyof typeof FORMATS] : o.format} · {destinationName(o.destinationId)}</span>
                <Button size="sm" variant="secondary" loading={preview.isPending && preview.variables === o.id} onClick={() => preview.mutate(o.id)}>Preview</Button>
              </div>
              {preview.isError && preview.variables === o.id && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
              {preview.data && preview.variables === o.id && (
                <div className="grid gap-1">
                  <span className="font-mono text-[11.5px] text-ink-muted">{preview.data.fileName}</span>
                  <pre className="m-0 max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12px] text-ink">{preview.data.content}</pre>
                </div>
              )}
            </div>
          ))}
        <h3 className="m-0 text-[12.5px] font-semibold text-ink">Deliveries</h3>
        <Deliveries documentId={documentId} />
      </div>
    </Card>
  );
}
