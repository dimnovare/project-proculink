"use client";

import { useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteOutput, getDocument, listDestinations, listOutputs } from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { flowAddress } from "@/lib/flowSteps";
import { draftReason, FlowLink, GoContext, useFlowDraft } from "./flowDraft";
import { OutputBuilder } from "./OutputBuilder";
import { OutputEditor, outputTypeLabel } from "./OutputEditor";
import { Failed, Quiet } from "./states";

/** "{type} to {destination}" / "{type}, you download it"; just the type while the destination is not known. */
function outputLine(o: FlowOutput, destinations: { id: string; name: string }[] | undefined) {
  const type = outputTypeLabel(o);
  if (!o.destinationId) return `${type}, you download it`;
  const d = destinations?.find((x) => x.id === o.destinationId);
  return d ? `${type} to ${d.name}` : type;
}

/** The We send step: the flow's outputs, and the chosen one edited in place as part of the draft. */
export function FlowOutputs({ flow, outputId, previewDocumentId }: { flow: Flow; outputId: string | null; previewDocumentId: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const enabled = useTenantQueriesEnabled();
  const router = useRouter();
  const go = useContext(GoContext);
  const { flushAll, leave } = useFlowDraft();
  const [adding, setAdding] = useState(false);
  const deleting = useRef(false);
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  // The same entry the step's latest-read query fills: no second request.
  const source = useQuery({ queryKey: ["document", previewDocumentId], queryFn: () => getDocument(previewDocumentId!), enabled: enabled && !!previewDocumentId });
  const remove = useMutation({
    mutationFn: async (o: FlowOutput) => { await flushAll(); await deleteOutput(flow.id, o.id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); },
    onSettled: () => { deleting.current = false; },
  });

  if (outputs.isError && !outputs.data) return <Failed error={outputs.error} retry={() => outputs.refetch()} />;
  if (!outputs.data) return <Quiet>Loading outputs…</Quiet>;
  const chosen = outputs.data.find((o) => o.id === outputId) ?? outputs.data[0];
  const preview = previewDocumentId ?? undefined;

  const ask = async (o: FlowOutput) => {
    if (deleting.current) return;
    deleting.current = true;
    if (await confirm({ title: "Delete output", description: `Delete "${o.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true })) remove.mutate(o);
    else deleting.current = false;
  };
  const open = (o: FlowOutput) => {
    setAdding(false);
    const href = flowAddress(flow.id, "send", { output: o.id });
    if (go) go(href);
    else router.replace(href);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
      <Card flush>
        <div className="grid gap-0.5 px-4 pt-3">
          <h2 className="m-0 text-[16px] font-semibold text-ink">Outputs</h2>
          <p className="m-0 text-[13px] text-ink-muted">Each output is one file made from every document in this flow.</p>
        </div>
        {outputs.data.length === 0 ? (
          <div className="px-4 pt-3"><Quiet>No outputs yet.</Quiet></div>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {outputs.data.map((o) => (
              <li key={o.id} className="border-t border-border-faint">
                <FlowLink
                  href={flowAddress(flow.id, "send", { output: o.id })} current={!adding && o.id === chosen?.id}
                  className={`grid min-h-11 gap-px px-4 py-2.5 text-ink no-underline ${!adding && o.id === chosen?.id ? "bg-surface-2" : "hover:bg-surface-2"}`}
                >
                  <span className="text-[14px] font-semibold">{o.name}</span>
                  <span className="text-[13px] text-ink-muted">{outputLine(o, destinations.data)}</span>
                </FlowLink>
              </li>
            ))}
          </ul>
        )}
        <div className="p-3">
          <Button
            variant="secondary" className="w-full border-dashed border-brand-blue text-brand-blue" aria-expanded={adding}
            onClick={() => leave(() => setAdding(true))}
          >
            Add an output
          </Button>
        </div>
      </Card>

      {adding ? (
        <OutputBuilder flow={flow} previewDocumentId={preview} onDone={() => setAdding(false)} onCreated={open} />
      ) : chosen ? (
        <Card as="section" aria-label={`Edit the output ${chosen.name}`}>
          <div className="grid gap-4">
            <OutputEditor
              key={chosen.id} mode="draft" flow={flow} output={chosen} previewDocumentId={preview} previewFile={source.data?.summary.fileName}
              onSaved={() => {}} onCancel={() => {}}
            />
            {remove.isError && <StatusNotice tone="error">{draftReason(remove.error)}</StatusNotice>}
            <div className="flex flex-wrap items-center gap-2 border-t border-border-faint pt-3">
              <Button variant="ghost" loading={remove.isPending} onClick={() => ask(chosen)}>Delete this output</Button>
              {!chosen.standard && (
                <FlowLink href={`/flows/${flow.id}/outputs/${chosen.id}/advanced`} push className={buttonClass("ghost")}>Open in Advanced</FlowLink>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
