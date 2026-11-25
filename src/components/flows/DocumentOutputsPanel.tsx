"use client";

import { useState } from "react";
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
import { fixDestinationHref } from "@/lib/activityRows";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { CHANNELS } from "@/lib/channels";
import { filesOf } from "@/lib/flowWords";
import { relativeTime } from "@/lib/relativeTime";
import { saveBlob } from "@/lib/saveBlob";
import { changeFileAddress } from "@/lib/flowSteps";
import { makeFileLabel } from "./fileChoice";
import { LookupMisses } from "./LookupMisses";
import { PeppolReceiverLine } from "./PeppolReceiverLine";
import { outputTypeLabel } from "./OutputEditor";
import { Failed, Loading } from "./states";

const STATUSES = new Map([
  ["queued", "Waiting"], ["delivering", "Sending"], ["delivered", "Delivered"],
  ["stored", "Ready to download"], ["failed", "Will retry"], ["dead_letter", "Couldn't deliver"],
]);
const BAD = new Set(["failed", "dead_letter"]);
const BUSY = new Set(["queued", "delivering"]);

/** `destinationOf`: where an output sends, by its name, so a stopped line can say where to fix it. */
function Deliveries({ documentId, deliveries, destinationOf }: { documentId: string; deliveries: DocumentDelivery[]; destinationOf(outputName: string): string | null | undefined }) {
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
            {d.status === "dead_letter" && (() => {
              const dest = destinationOf(d.outputName);
              return dest && <Link href={fixDestinationHref(dest)} className={`${buttonClass("secondary", "sm")} justify-self-start`}>Fix the destination</Link>;
            })()}
          </li>
        ))}
      </ul>
    </>
  );
}

/** R19: "{type} to {destination}", "{type}, you download it", or just the type while the destination is unknown. */
const outputLine = (o: FlowOutput, destinations: readonly { id: string; name: string }[] | undefined) => {
  const type = outputTypeLabel(o);
  if (!o.destinationId) return `${type}, you download it`;
  const name = destinations?.find((d) => d.id === o.destinationId)?.name;
  return name ? `${type} to ${name}` : type;
};
const goOut = (n: number) => (n === 1 ? "It goes" : n === 2 ? "Both go" : `All ${n} go`) + " out when you send this document.";

/** The outputs whose preview was left open, remembered on this device: open on the next document too. */
const OPEN_KEY = "plk:review-preview-open";
const openOutputs = (): string[] => {
  try { const ids: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"); return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};

// Owns its own preview so opening one output never replaces another's.
function OutputRow({ o, flowId, documentId, flowFields, destinations, live, peppolOn }: {
  o: FlowOutput; flowId: string; documentId: string; flowFields: Flow["fields"] | undefined; destinations: readonly { id: string; name: string }[] | undefined;
  /** The values can still change: an open preview is made again after each saved change. */
  live: boolean;
  /** The Peppol switch: a Peppol BIS output then says whether the buyer can receive it. */
  peppolOn: boolean;
}) {
  const enabled = useTenantQueriesEnabled();
  const [open, setOpen] = useState(() => openOutputs().includes(o.id));
  const toggle = () => {
    setOpen(!open);
    const rest = openOutputs().filter((id) => id !== o.id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify((open ? rest : [...rest, o.id]).slice(-50))); } catch { /* open for this visit only */ }
  };
  // Keyed by the document: a saved value invalidates it (useDocumentEdits), so it is made again.
  const preview = useQuery({
    queryKey: ["output-preview", documentId, o.id], queryFn: () => previewOutput(documentId, o.id, { published: true }),
    enabled: enabled && open, refetchOnWindowFocus: false, retry: false,
  });
  return (
    <div className={`grid min-w-0 content-start gap-1.5 rounded-md border border-border p-3 ${open ? "col-span-full" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="grid">
          <span className="text-[13px] font-medium text-ink">{o.name}</span>
          <span className="text-[12.5px] text-ink-muted">{outputLine(o, destinations)}</span>
          {o.sendWhen && <span className="text-[12.5px] text-ink-muted">{describeSendWhen(o.sendWhen, flowFields)}</span>}
          {peppolOn && (o.standard === "peppol-bis-billing-3" || o.standard === "peppol-bis-billing-3-credit-note") && (
            <PeppolReceiverLine documentId={documentId} creditNote={o.standard === "peppol-bis-billing-3-credit-note"} />
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {open && live && <span className="text-[12.5px] text-ink-muted">{preview.isFetching ? "Updating…" : "Updates as you type"}</span>}
          <Button size="sm" variant="secondary" aria-expanded={open} loading={open && preview.isLoading} onClick={toggle}>{open ? "Hide preview" : "Preview"}</Button>
          <Link href={changeFileAddress(flowId, { output: o.id, document: documentId, from: `/flows/${flowId}/documents/${documentId}` })} className={`${buttonClass("secondary", "sm")} inline-flex items-center`}>Change the file</Link>
          {/* Only where Advanced fits: a phone would be sent to a screen that says it needs a wider one. */}
          {!o.standard && <Link href={`/flows/${flowId}/outputs/${o.id}/advanced?document=${documentId}`} className="hidden items-center text-[12.5px] text-brand-blue underline lg:inline-flex">More settings</Link>}
        </span>
      </div>
      {open && preview.isError && <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>}
      {open && preview.data && (
        <div className="grid gap-1">
          <span className="font-mono text-[12.5px] text-ink-muted">{preview.data.fileName}</span>
          <pre className="m-0 max-h-72 overflow-auto rounded border border-border bg-surface2 p-2.5 font-mono text-[12.5px] text-ink">{preview.data.content}</pre>
          {preview.data.lookupMisses?.length ? (
            <LookupMisses documentId={documentId} outputId={o.id} misses={preview.data.lookupMisses} onChanged={() => void preview.refetch()} />
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
  const editable = documentStatus(doc.summary.status, doc.summary.statusReason).editable;
  const addLink = `/flows/${flowId}?tab=outputs`;
  const downloadOnly = flow.data?.downloadOnly === true;
  // Made and waiting to be downloaded: every made file was stored, none went anywhere.
  const files = filesOf(deliveries.data);
  const waiting = doc.summary.status === "sent" && files.length > 0 && files.every((f) => !f.delivered);
  // When the newest stored file was made; no time is said when none is known.
  const at = relativeTime(deliveries.data?.filter((d) => d.status === "stored" && d.deliveredAt).map((d) => d.deliveredAt!).sort().at(-1));
  const madeAt = at ? ` ${at}` : "";

  return (
    <div className="grid gap-3">
      {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
      {outputs.isError && !list ? <Failed error={outputs.error} retry={() => outputs.refetch()} />
        : !list ? <Loading>Loading files…</Loading>
        : list.length > 0 && (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))] [&>*:only-child]:col-span-full">
            {list.map((o) => (
              <OutputRow key={o.id} o={o} flowId={flowId} documentId={documentId} flowFields={flow.data?.fields} destinations={destinations.data} live={editable} peppolOn={flow.data?.peppolOn === true} />
            ))}
          </div>
        )}
      {deliveries.isError && !deliveries.data ? <Failed error={deliveries.error} retry={() => deliveries.refetch()} />
        : !deliveries.data ? <Loading>Loading deliveries…</Loading>
        : deliveries.data.length === 0 && list?.length !== 0 && (
          <p className="m-0 text-[12.5px] text-ink-muted">
            {downloadOnly ? `Nothing is made yet.${editable ? " When the values are right, press Make the file." : ""}`
              : `Nothing has been sent yet.${list?.length && !list.some((o) => o.sendWhen) && editable ? ` ${goOut(list.length)}` : ""}`}
          </p>
        )}
      {list && (list.length > 0 ? (
        <p className="m-0 text-[12.5px] text-ink-muted">
          Want another file from this document? <Link href={addLink} className="text-brand-blue underline">{makeFileLabel(list.length)}</Link>
        </p>
      ) : <p className="m-0 text-[13px] text-ink">This flow doesn&apos;t make a file yet. Set one up, and every document in this flow gets it.</p>)}
      {waiting && (
        <p className="m-0 text-[13px] text-ink">
          {files.length === 1 ? `${files[0].fileName} was made${madeAt}. It waits here and in Documents until you download it.`
            : `${files.length} files were made${madeAt}. They wait here and in Documents until you download them.`}
        </p>
      )}
      {!!deliveries.data?.length && <Deliveries documentId={documentId} deliveries={deliveries.data} destinationOf={(name) => list?.find((o) => o.name === name)?.destinationId} />}
    </div>
  );
}
