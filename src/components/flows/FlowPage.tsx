"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { nextTabIndex } from "@/lib/tabKeys";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  deleteOutput, getDocument, getFlow, listDestinations, listDocuments, listOutputs, updateFlow,
} from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "@/lib/deliveryMode";
import { fieldListFromRead, withReadExtras } from "@/lib/flowFieldModel";
import { describeSendWhen } from "@/lib/flowOutputModel";
import { INPUT } from "./DestinationForm";
import { DocumentList } from "./DocumentList";
import { FieldListEditor } from "./FieldListEditor";
import { FlowChangesBar } from "./FlowChangesBar";
import { FlowIntakePanel } from "./FlowIntakePanel";
import { FlowVersionsPanel } from "./FlowVersionsPanel";
import { FlowUpload } from "./FlowUpload";
import { OutputBuilder } from "./OutputBuilder";
import { OutputEditor, outputTypeLabel } from "./OutputEditor";
import { destinationName, Failed, Quiet } from "./states";

const TABS = [["documents", "Documents"], ["fields", "Fields"], ["outputs", "Outputs"], ["intake", "Intake"], ["versions", "Versions"]] as const;
type Tab = (typeof TABS)[number][0];
const AUTOMATION = [["review", REVIEW_BEFORE_DELIVERY_LABEL], ["auto", AUTOMATIC_DELIVERY_LABEL]] as const;

function streakText(n: number) {
  if (n === 0) return "The last document sent needed a correction.";
  if (n === 1) return "The last document was sent without a correction.";
  return `The last ${n > 200 ? "200+" : n} documents were sent without a correction.`;
}

function Header({ flow }: { flow: Flow }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (patch: { name?: string; automation?: "review" | "auto" }) => updateFlow(flow.id, patch),
    onSuccess: (f) => { qc.setQueryData(["flow", flow.id], f); qc.invalidateQueries({ queryKey: ["flows"] }); },
  });
  const rename = (input: HTMLInputElement) => {
    const name = input.value.trim();
    if (!name) input.value = flow.name;
    else if (name !== flow.name) update.mutate({ name });
  };
  return (
    <Card>
      <div className="grid gap-3">
        <input
          key={flow.name} aria-label="Flow name" maxLength={120} className={`${INPUT} font-medium`} defaultValue={flow.name}
          onBlur={(e) => rename(e.target)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0" disabled={update.isPending}>
          <legend className="sr-only">When a document is ready</legend>
          {AUTOMATION.map(([value, label]) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="radio" name="automation" checked={flow.automation === value}
                onChange={() => update.mutate({ automation: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {typeof flow.noCorrectionStreak === "number" && <p className="m-0 text-[12.5px] text-ink-muted">{streakText(flow.noCorrectionStreak)}</p>}
        <p className="m-0 text-[12.5px] text-ink-muted">Documents with a number we&apos;ve already received always wait for you.</p>
        {update.isError && <StatusNotice tone="error">{documentRefusalMessage(update.error)}</StatusNotice>}
      </div>
    </Card>
  );
}

function Outputs({ flow, previewDocumentId }: { flow: Flow; previewDocumentId?: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const enabled = useTenantQueriesEnabled();
  const [editing, setEditing] = useState<FlowOutput | "new" | null>(null);
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const remove = useMutation({
    mutationFn: (id: string) => deleteOutput(flow.id, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); },
  });
  const ask = async (o: FlowOutput) => {
    if (await confirm({ title: "Delete output", description: `Delete "${o.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true })) remove.mutate(o.id);
  };

  if (outputs.isError && !outputs.data) return <Failed error={outputs.error} retry={() => outputs.refetch()} />;
  if (!outputs.data) return <Quiet>Loading outputs…</Quiet>;
  if (editing === "new") return <OutputBuilder flow={flow} previewDocumentId={previewDocumentId} onDone={() => setEditing(null)} />;
  if (editing)
    return (
      <OutputEditor
        flow={flow} output={editing} previewDocumentId={previewDocumentId}
        onSaved={() => setEditing(null)} onCancel={() => setEditing(null)}
      />
    );
  return (
    <div className="grid gap-2">
      {remove.isError && <StatusNotice tone="error">{documentRefusalMessage(remove.error)}</StatusNotice>}
      {destinations.isError && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
      {outputs.data.length === 0 && <Quiet>No outputs yet.</Quiet>}
      {outputs.data.map((o) => (
        <Card key={o.id} dense>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="grid">
              <span className="text-[13.5px] font-medium">{o.name}</span>
              {describeSendWhen(o.sendWhen, flow.fields) && <span className="text-[12px] text-ink-muted">{describeSendWhen(o.sendWhen, flow.fields)}</span>}
            </span>
            <span className="text-[12px] text-ink-muted">{outputTypeLabel(o)} · {destinationName(destinations, o.destinationId)}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(o)}>Edit</Button>
              {!o.standard && <Link href={`/flows/${flow.id}/outputs/${o.id}/advanced`} className="inline-flex items-center rounded border border-border px-2.5 text-[12.5px] font-medium text-ink">Open in Advanced</Link>}
              <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables === o.id} onClick={() => ask(o)}>Delete</Button>
            </span>
          </div>
        </Card>
      ))}
      <div><Button variant="primary" size="sm" onClick={() => setEditing("new")}>Add an output</Button></div>
    </div>
  );
}

export function FlowPage({ flowId }: { flowId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const asked = params.get("tab");
  const tab: Tab = TABS.some(([t]) => t === asked) ? (asked as Tab) : "documents";

  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled });
  const docs = useQuery({
    queryKey: ["documents", { flowId }], queryFn: () => listDocuments({ flowId }), enabled,
    refetchInterval: (q) => (q.state.data?.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : false),
  });
  // Newest document the engine has finished reading, so Fields and Preview have something real to show.
  const latest = [...(docs.data ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((d) => {
      const s = documentStatus(d.status, d.statusReason).stage;
      return (typeof s === "number" ? s : s.failed) >= 2;
    });
  const latestDoc = useQuery({
    queryKey: ["document", latest?.id], queryFn: () => getDocument(latest!.id), enabled: enabled && !!latest && tab !== "documents", placeholderData: keepPreviousData,
  });

  // An older backend sends no publishedVersion and has no versions endpoints.
  const tabs = TABS.filter(([t]) => t !== "versions" || flow.data?.publishedVersion !== undefined);
  const go = (t: Tab) => router.replace(`/flows/${flowId}?tab=${t}`);
  const onTabKey = (e: React.KeyboardEvent) => {
    // From the focused tab, not the URL: a second press can land before the route commits.
    const i = tabs.findIndex(([t]) => `flow-tab-${t}` === e.currentTarget.id);
    const to = nextTabIndex(e.key, i, tabs.length);
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[to][0];
    go(next);
    document.getElementById(`flow-tab-${next}`)?.focus();
  };
  const saved = (f: Flow) => qc.setQueryData(["flow", flowId], f);

  let body;
  if (tab === "documents") {
    body = (
      <div className="grid gap-4">
        <FlowUpload flowId={flowId} onUploaded={() => Promise.all([["documents", { flowId }], ["flows"]].map((queryKey) => qc.invalidateQueries({ queryKey })))} />
        {docs.isError ? <Failed error={docs.error} retry={() => docs.refetch()} />
          : !docs.data ? <Quiet>Loading documents…</Quiet>
          : docs.data.length === 0 ? <Quiet>No documents yet.</Quiet>
          : <Card flush><DocumentList documents={docs.data} showFlow={false} /></Card>}
      </div>
    );
  } else if (tab === "intake") {
    body = <FlowIntakePanel flowId={flowId} />;
  } else if (tab === "versions") {
    body = <FlowVersionsPanel flowId={flowId} />;
  } else if (!flow.data) {
    body = null;
  } else if (tab === "outputs") {
    body = <Outputs flow={flow.data} previewDocumentId={latest?.id} />;
  } else if (flow.data.fieldsConfirmed) {
    const { list, off } = withReadExtras(flow.data.fields, latestDoc.data?.read);
    // Keyed on the saved fields too, so a discard or restore replaces the form instead of leaving the old edits in it.
    body = <FieldListEditor key={`${latestDoc.data ? "read" : "none"}:${JSON.stringify(flow.data.fields)}`} flow={flow.data} initial={list} initialOff={off} onSaved={saved} />;
  } else if (docs.isError) {
    body = <Failed error={docs.error} retry={() => docs.refetch()} />;
  } else if (!docs.data || (latest && latestDoc.isPending)) {
    body = <Quiet>Loading…</Quiet>;
  } else if (latestDoc.isError) {
    body = <Failed error={latestDoc.error} retry={() => latestDoc.refetch()} />;
  } else if (!latestDoc.data) {
    body = <Quiet>Upload a document first</Quiet>;
  } else {
    body = <FieldListEditor flow={flow.data} initial={fieldListFromRead(latestDoc.data.read)} onSaved={saved} />;
  }

  return (
    <PageShell variant="wide">
      <PageHeader titleHidden title="Flow" />
      {flow.isError ? (
        <Failed error={flow.error} retry={() => flow.refetch()} />
      ) : !flow.data ? (
        <Quiet>Loading flow…</Quiet>
      ) : (
        <div className="grid gap-4">
          <Header flow={flow.data} />
          {!flow.data.fieldsConfirmed && (
            <StatusNotice
              tone="warning"
              action={<Button variant="secondary" size="sm" onClick={() => go("fields")}>Go to fields</Button>}
            >
              Confirm this flow&apos;s fields so every document is read the same way
            </StatusNotice>
          )}
          <FlowChangesBar flow={flow.data} />
          <div role="tablist" aria-label="Flow sections" className="flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map(([t, label]) => (
              <button
                key={t} type="button" role="tab" id={`flow-tab-${t}`} aria-controls="flow-panel" aria-selected={t === tab}
                tabIndex={t === tab ? 0 : -1} onKeyDown={onTabKey} onClick={() => go(t)}
                className={`whitespace-nowrap px-3 py-2 text-[13px] ${t === tab ? "border-b-2 border-brand-blue font-semibold" : "text-ink-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="flow-panel" aria-labelledby={`flow-tab-${tab}`}>{body}</div>
        </div>
      )}
    </PageShell>
  );
}
