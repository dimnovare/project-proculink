"use client";

import Link from "next/link";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  downloadDeliveryFile, getFlow, listDeliveries, listDestinations, listOutputs, previewOutput, sendDocument,
} from "@/lib/api/documents";
import type { DocumentDelivery, DocumentDetail, Flow, FlowOutput } from "@/lib/api/documents";
import { describeSendWhen } from "@/lib/flowOutputModel";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { saveBlob } from "@/lib/saveBlob";
import { LookupMisses } from "./LookupMisses";
import { FORMATS } from "./OutputEditor";
import { destinationName, Failed, Quiet } from "./states";

// An unknown token shows as itself, never as a success word.
const CHANNELS = new Map([["", "Download"], ["email", "Email"], ["http", "Web address"], ["sftp", "SFTP"], ["ftps", "FTPS"]]);
const STATUSES = new Map([
  ["queued", "Waiting"], ["delivering", "Sending"], ["delivered", "Delivered"],
  ["stored", "Ready to download"], ["failed", "Will retry"], ["dead_letter", "Couldn't deliver"],
]);
const BAD = new Set(["failed", "dead_letter"]);
const BUSY = new Set(["queued", "delivering"]);

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
              {CHANNELS.get(d.protocol) ?? d.protocol} · {STATUSES.get(d.status) ?? d.status}{d.attempts > 0 && ` · ${d.attempts} ${d.attempts === 1 ? "attempt" : "attempts"}`}
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

// Owns its own preview so opening one output never replaces another's.
function OutputRow({ o, flowId, documentId, flowFields, destinations }: {
  o: FlowOutput; flowId: string; documentId: string; flowFields: Flow["fields"] | undefined; destinations: Parameters<typeof destinationName>[0];
}) {
  const preview = useMutation({ mutationFn: () => previewOutput(documentId, o.id, { published: true }) });
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="grid">
          <span className="text-[13px] font-medium text-ink">{o.name}</span>
          {o.sendWhen && <span className="text-[12px] text-ink-muted">{describeSendWhen(o.sendWhen, flowFields)}</span>}
        </span>
        <span className="text-[12px] text-ink-muted">{Object.hasOwn(FORMATS, o.format) ? FORMATS[o.format as keyof typeof FORMATS] : o.format} · {destinationName(destinations, o.destinationId)}</span>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          <Link href={`/flows/${flowId}/outputs/${o.id}/advanced?document=${documentId}`} className="inline-flex items-center rounded border border-border px-2.5 text-[12.5px] font-medium text-ink">Open in Advanced</Link>
        </span>
      </div>
      {preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
      {preview.data && (
        <div className="grid gap-1">
          <span className="font-mono text-[11.5px] text-ink-muted">{preview.data.fileName}</span>
          <pre className="m-0 max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12px] text-ink">{preview.data.content}</pre>
          {preview.data.lookupMisses?.length ? (
            <LookupMisses documentId={documentId} outputId={o.id} misses={preview.data.lookupMisses} onChanged={() => preview.mutate()} />
          ) : null}
        </div>
      )}
    </div>
  );
}

export function DocumentOutputsPanel({ flowId, document: doc }: { flowId: string; document: DocumentDetail }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const documentId = doc.summary.id;
  const outputs = useQuery({ queryKey: ["outputs", flowId, "published"], queryFn: () => listOutputs(flowId, { published: true }), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled });
  const send = useMutation({
    mutationFn: () => sendDocument(documentId),
    onSuccess: () => Promise.all(["document", "deliveries", "document-history"].map((k) => qc.invalidateQueries({ queryKey: [k, documentId] }))),
  });
  // Send waits for a value edit that is still saving, so the file always carries what the screen shows.
  const saving = useIsMutating({ mutationKey: ["edit-values", documentId] }) > 0;
  const canSend = documentStatus(doc.summary.status, doc.summary.statusReason).editable;

  return (
    <Card edge="green" as="section" aria-labelledby="doc-outputs" className="min-w-0">
      <div data-testid="doc-send-bar" style={{ bottom: "var(--plk-bottom-inset, 0px)" }} className="fixed inset-x-0 z-20 flex lg:mb-3 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <h2 id="doc-outputs" className="m-0 text-[13px] font-semibold text-ink">Outputs</h2>
        <Button variant="send" size="sm" className="min-h-11 lg:min-h-0" disabled={!canSend || saving} loading={send.isPending || saving} onClick={() => send.mutate()}>Send</Button>
        {send.isError && <div className="basis-full"><StatusNotice tone="error">{documentRefusalMessage(send.error)}</StatusNotice></div>}
      </div>
      <div className="grid gap-3">
        {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
        {outputs.isError && !outputs.data ? <Failed error={outputs.error} retry={() => outputs.refetch()} />
          : !outputs.data ? <Quiet>Loading outputs…</Quiet>
          : outputs.data.length === 0 ? <Link href={`/flows/${flowId}?tab=outputs`} className="text-[13px] text-brand-blue">Add an output to this flow</Link>
          : outputs.data.map((o) => (
            <OutputRow key={o.id} o={o} flowId={flowId} documentId={documentId} flowFields={flow.data?.fields} destinations={destinations} />
          ))}
        <h3 className="m-0 text-[12.5px] font-semibold text-ink">Deliveries</h3>
        <Deliveries documentId={documentId} />
      </div>
    </Card>
  );
}
