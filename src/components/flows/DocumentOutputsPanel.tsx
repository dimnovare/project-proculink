"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  downloadDeliveryFile, getFlow, listDeliveries, listDestinations, listOutputs, previewOutput,
} from "@/lib/api/documents";
import type { DocumentDelivery, DocumentDetail, Flow, FlowOutput } from "@/lib/api/documents";
import { describeSendWhen } from "@/lib/flowOutputModel";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { saveBlob } from "@/lib/saveBlob";
import { LookupMisses } from "./LookupMisses";
import { outputTypeLabel } from "./OutputEditor";
import { Failed, Quiet } from "./states";

// An unknown token shows as itself, never as a success word.
const CHANNELS = new Map([["", "Download"], ["email", "Email"], ["http", "Web address"], ["sftp", "SFTP"], ["ftps", "FTPS"], ["s3", "S3 bucket"], ["google_drive", "Google Drive"], ["google_sheets", "Google Sheets"]]);
const STATUSES = new Map([
  ["queued", "Waiting"], ["delivering", "Sending"], ["delivered", "Delivered"],
  ["stored", "Ready to download"], ["failed", "Will retry"], ["dead_letter", "Couldn't deliver"],
]);
const BAD = new Set(["failed", "dead_letter"]);
const BUSY = new Set(["queued", "delivering"]);

function Deliveries({ documentId, deliveries }: { documentId: string; deliveries: DocumentDelivery[] }) {
  const download = useMutation({
    mutationFn: async (d: DocumentDelivery) => saveBlob(await downloadDeliveryFile(documentId, d.id), d.fileName!),
  });
  return (
    <>
      <h3 className="m-0 text-[12.5px] font-semibold text-ink">Deliveries</h3>
      <ul className="m-0 grid list-none gap-2 p-0">
        {download.isError && <StatusNotice tone="error">{documentRefusalMessage(download.error)}</StatusNotice>}
        {deliveries.map((d) => (
          <li key={d.id} className="grid gap-0.5 text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{d.outputName}</span>
              <span className={BAD.has(d.status) || !STATUSES.has(d.status) ? "text-danger" : "text-ink-muted"}>
                {CHANNELS.get(d.protocol) ?? d.protocol}, {STATUSES.get(d.status) ?? d.status}{d.attempts > 0 && `, ${d.attempts} ${d.attempts === 1 ? "attempt" : "attempts"}`}
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
    </>
  );
}

/** R19: "{type} to {destination}", "{type}, download only", or just the type while the destination is unknown. */
const outputLine = (o: FlowOutput, destinations: readonly { id: string; name: string }[] | undefined) => {
  const type = outputTypeLabel(o);
  if (!o.destinationId) return `${type}, download only`;
  const name = destinations?.find((d) => d.id === o.destinationId)?.name;
  return name ? `${type} to ${name}` : type;
};
const goOut = (n: number) => (n === 1 ? "It goes" : n === 2 ? "Both go" : `All ${n} go`) + " out when you send this document.";

// Owns its own preview so opening one output never replaces another's.
function OutputRow({ o, flowId, documentId, flowFields, destinations }: {
  o: FlowOutput; flowId: string; documentId: string; flowFields: Flow["fields"] | undefined; destinations: readonly { id: string; name: string }[] | undefined;
}) {
  const preview = useMutation({ mutationFn: () => previewOutput(documentId, o.id, { published: true }) });
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="grid">
          <span className="text-[13px] font-medium text-ink">{o.name}</span>
          <span className="text-[12.5px] text-ink-muted">{outputLine(o, destinations)}</span>
          {o.sendWhen && <span className="text-[12.5px] text-ink-muted">{describeSendWhen(o.sendWhen, flowFields)}</span>}
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          {!o.standard && <Link href={`/flows/${flowId}/outputs/${o.id}/advanced?document=${documentId}`} className={`${buttonClass("secondary", "sm")} inline-flex items-center`}>Open in Advanced</Link>}
        </span>
      </div>
      {preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
      {preview.data && (
        <div className="grid gap-1">
          <span className="font-mono text-[12.5px] text-ink-muted">{preview.data.fileName}</span>
          <pre className="m-0 max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12.5px] text-ink">{preview.data.content}</pre>
          {preview.data.lookupMisses?.length ? (
            <LookupMisses documentId={documentId} outputId={o.id} misses={preview.data.lookupMisses} onChanged={() => preview.mutate()} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The content of the "What we'll send" pane: what each output makes, where it goes, and what was sent. */
export function DocumentOutputsPanel({ flowId, document: doc }: { flowId: string; document: DocumentDetail }) {
  const enabled = useTenantQueriesEnabled();
  const documentId = doc.summary.id;
  const outputs = useQuery({ queryKey: ["outputs", flowId, "published"], queryFn: () => listOutputs(flowId, { published: true }), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled });
  const deliveries = useQuery({
    queryKey: ["deliveries", documentId], queryFn: () => listDeliveries(documentId), enabled,
    refetchInterval: (q) => {
      const s = q.state.data?.map((d) => d.status) ?? [];
      return s.some((x) => BUSY.has(x)) ? 2000 : s.includes("failed") ? 5000 : false; // failed rows are retried by the server
    },
  });
  const list = outputs.data;
  const addLink = `/flows/${flowId}?tab=outputs`;

  return (
    <div className="grid gap-3">
      {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
      {outputs.isError && !list ? <Failed error={outputs.error} retry={() => outputs.refetch()} />
        : !list ? <Quiet>Loading outputs…</Quiet>
        : list.map((o) => (
          <OutputRow key={o.id} o={o} flowId={flowId} documentId={documentId} flowFields={flow.data?.fields} destinations={destinations.data} />
        ))}
      {deliveries.isError && !deliveries.data ? <Failed error={deliveries.error} retry={() => deliveries.refetch()} />
        : !deliveries.data ? <Quiet>Loading deliveries…</Quiet>
        : deliveries.data.length === 0 && (
          <p className="m-0 text-[12.5px] text-ink-muted">
            Nothing has been sent yet.{list?.length && !list.some((o) => o.sendWhen) ? ` ${goOut(list.length)}` : ""}
          </p>
        )}
      {list && (list.length > 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">
          Want another file from this document? <Link href={addLink} className="text-brand-blue">Add an output</Link>
        </p>
      ) : <Link href={addLink} className="inline-flex items-center text-[13px] text-brand-blue">Add an output to this flow</Link>)}
      {!!deliveries.data?.length && <Deliveries documentId={documentId} deliveries={deliveries.data} />}
    </div>
  );
}
