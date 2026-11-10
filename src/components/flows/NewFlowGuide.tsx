"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { DestinationForm, Field, INPUT } from "@/components/flows/DestinationForm";
import { FieldListEditor } from "@/components/flows/FieldListEditor";
import { FlowEmailCard } from "./FlowIntakePanel";
import { FlowUpload } from "@/components/flows/FlowUpload";
import { OutputEditor } from "@/components/flows/OutputEditor";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  createFlow, getDocument, getFlow, listDestinations, listOutputs, publishFlow, retryDocumentRead, testDestination, updateOutput,
} from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { Failed, Quiet, ReadProblem } from "@/components/flows/states";
import { fieldListFromRead } from "@/lib/flowFieldModel";

const NEW_DESTINATION = "\u0000new";

function ReadStep({ flow, docId, onConfirmed }: { flow: Flow; docId: string; onConfirmed(flow: Flow): void }) {
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: ["document", docId],
    queryFn: () => getDocument(docId), enabled: useTenantQueriesEnabled(),
    refetchInterval: (q) => (["received", "reading"].includes(q.state.data?.summary.status ?? "") ? 2000 : false),
  });
  const retry = useMutation({
    mutationFn: () => retryDocumentRead(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document", docId] }),
  });
  if (doc.isError) return <Failed error={doc.error} retry={() => doc.refetch()} />;
  if (!doc.data) return <Quiet>Loading…</Quiet>;
  const { summary, read } = doc.data;
  if (summary.status === "received" || summary.status === "reading")
    return <p role="status" className="text-[13px] text-ink-muted">Reading your document…</p>;
  const nothingRead = read.fields.length + read.tables.length === 0;
  if (summary.status === "read_failed" || (summary.statusReason === "duplicate_file" && nothingRead))
    return <ReadProblem summary={summary} nothingRead={nothingRead} retry={retry} scansOn={flow.scansOn} />;
  return <FieldListEditor flow={flow} initial={fieldListFromRead(read)} onSaved={onConfirmed} />;
}

function DestinationStep({ flow, output, onDone }: { flow: Flow; output: FlowOutput; onDone(): void }) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState(output.destinationId);
  const [adding, setAdding] = useState(false);
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled: useTenantQueriesEnabled() });
  const test = useMutation({ mutationFn: () => testDestination(choice!) });
  // The stored template goes back unchanged: leaving it out would make the server rebuild the default.
  // Finishing publishes the flow; "nothing to publish" means it already is.
  const save = useMutation({
    mutationFn: async () => {
      if (choice !== output.destinationId)
        await updateOutput(flow.id, output.id, {
          name: output.name, format: output.format, tableKey: output.tableKey, template: output.template, sendWhen: output.sendWhen, destinationId: choice,
        });
      // An older backend sends no publishedVersion and has no publish endpoint.
      if (flow.publishedVersion !== undefined) await publishFlow(flow.id).catch((e) => { if (refusalToken(e) !== "nothing_to_publish") throw e; });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); onDone(); },
  });
  const result = test.data;
  return (
    <Card edge="green" title="Where it goes">
      <div className="grid gap-3">
        <Field label="Send to">
          <select
            className={INPUT}
            value={adding ? NEW_DESTINATION : (choice ?? "")}
            onChange={(e) => {
              test.reset();
              setAdding(e.target.value === NEW_DESTINATION);
              if (e.target.value !== NEW_DESTINATION) setChoice(e.target.value || null);
            }}
          >
            <option value="">Download only</option>
            {destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value={NEW_DESTINATION}>New destination…</option>
          </select>
        </Field>
        {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
        {adding && (
          <DestinationForm
            onCancel={() => setAdding(false)}
            onSaved={(d) => { setChoice(d.id); setAdding(false); qc.invalidateQueries({ queryKey: ["destinations"] }); }}
          />
        )}
        {choice && !adding && (
          <div className="grid gap-2">
            <div><Button type="button" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>Send a test</Button></div>
            {test.isError && <StatusNotice tone="error">{documentRefusalMessage(test.error)}</StatusNotice>}
            {result && (
              <StatusNotice tone={result.success ? "success" : "error"}>
                {result.message ?? (result.success ? "The test went through." : "The test failed.")}
              </StatusNotice>
            )}
          </div>
        )}
        {save.isError && <StatusNotice tone="error">{documentRefusalMessage(save.error)}</StatusNotice>}
        <div><Button type="button" variant="primary" disabled={adding} loading={save.isPending} onClick={() => save.mutate()}>Finish</Button></div>
      </div>
    </Card>
  );
}

export function NewFlowGuide() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const flowId = params.get("flow");
  const docId = params.get("doc");
  const asked = flowId ? Math.min(6, Math.max(2, Number(params.get("step")) || 2)) : 1;
  // Step 3 reads a sample, so without one the guide goes back to the upload.
  const step = asked === 3 && !docId ? 2 : asked;
  const [name, setName] = useState("");

  const go = (patch: Record<string, string>) =>
    router.replace(`/flows/new?${new URLSearchParams({ ...Object.fromEntries(params), ...patch })}`);

  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId!), enabled: enabled && !!flowId && step >= 3 && step < 6 });
  const outputs = useQuery({ queryKey: ["outputs", flowId], queryFn: () => listOutputs(flowId!), enabled: enabled && !!flowId && step >= 4 && step < 6 });
  const create = useMutation({
    mutationFn: () => createFlow(name.trim()),
    onSuccess: (f) => { qc.invalidateQueries({ queryKey: ["flows"] }); go({ flow: f.id, step: "2" }); },
  });

  let body;
  if (step === 1) {
    body = (
      <Card title="Name your flow">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <Field label="Flow name"><input className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {create.isError && <StatusNotice tone="error">{documentRefusalMessage(create.error)}</StatusNotice>}
          <div><Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>Next</Button></div>
        </form>
      </Card>
    );
  } else if (step === 2) {
    body = (
      <Card edge="blue" title="Upload a sample">
        <div className="grid gap-3">
          <p className="text-[13px] text-ink-muted">Add one document like the ones you will send. We read it and suggest the fields to pick up.</p>
          <FlowUpload flowId={flowId!} onUploaded={(d) => { qc.invalidateQueries({ queryKey: ["flows"] }); go({ doc: d.id, step: "3" }); }} />
        </div>
      </Card>
    );
  } else if (step === 6) {
    body = (
      <div className="grid gap-4">
        <Card title="Your flow is ready">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => router.push(`/flows/${flowId}`)}>Open the flow</Button>
            <Button variant="secondary" onClick={() => router.push(`/flows/${flowId}?tab=documents`)}>Upload more documents</Button>
          </div>
        </Card>
        <FlowEmailCard flowId={flowId!} />
      </div>
    );
  } else if (flow.isError) {
    body = <Failed error={flow.error} retry={() => flow.refetch()} />;
  } else if (!flow.data) {
    body = <Quiet>Loading…</Quiet>;
  } else if (step === 3) {
    body = <ReadStep flow={flow.data} docId={docId!} onConfirmed={(f) => { qc.setQueryData(["flow", f.id], f); go({ step: "4" }); }} />;
  } else if (outputs.isError) {
    body = <Failed error={outputs.error} retry={() => outputs.refetch()} />;
  } else if (!outputs.data) {
    body = <Quiet>Loading…</Quiet>;
  } else if (step === 4) {
    body = (
      // Save is the only way forward, so edits made after "Create" are never skipped. An existing output is
      // edited, never duplicated.
      <OutputEditor
        flow={flow.data}
        output={outputs.data[0]}
        previewDocumentId={docId ?? undefined}
        hideDestination
        onSaved={() => go({ step: "5" })}
        onCancel={() => go({ step: "3" })}
      />
    );
  } else if (outputs.data[0]) {
    body = <DestinationStep flow={flow.data} output={outputs.data[0]} onDone={() => go({ step: "6" })} />;
  } else {
    body = <StatusNotice tone="warning">Add an output first.</StatusNotice>;
  }

  return (
    <PageShell>
      <PageHeader titleHidden title="New flow" sub={`Step ${step} of 6`} />
      {body}
    </PageShell>
  );
}
