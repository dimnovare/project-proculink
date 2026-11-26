"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { AppNotFound } from "@/components/bridge/AppNotFound";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { isNotFoundFailure } from "@/lib/apiFailure";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFlow, listDestinations, listIntakes, listOutputs, updateFlow } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { foundSummary } from "@/lib/firstRun";
import { checkModeShort } from "@/lib/deliveryMode";
import { and, doesLine, waysInWords } from "@/lib/flowSentences";
import { FLOW_STEPS, flowAddress, readFlowOutput, readFlowView, stepTitle, type FlowStep, type FlowView } from "@/lib/flowSteps";
import { pageTotal } from "@/lib/pageTotal";
import { INPUT } from "./DestinationForm";
import { DeleteFlow } from "./DeleteFlow";
import { FlowCheck } from "./FlowCheck";
import { flowNeedsYouQuery, FlowDocuments, needsYouWords, StreakBand } from "./FlowDocuments";
import { FlowIntakePanel } from "./FlowIntakePanel";
import { FlowOutputs } from "./FlowOutputs";
import { outputTypeLabel } from "./OutputEditor";
import { FlowValues, useLatestRead } from "./FlowValues";
import { FlowDraftProvider, FlowLink, GoContext, leaveClick, useFlowDraft } from "./flowDraft";
import { FlowVersionsPanel } from "./FlowVersionsPanel";
import { PublishBar } from "./PublishBar";
import { Failed, Loading } from "./states";

const STEP_IDS: readonly FlowView[] = FLOW_STEPS.map((s) => s.id);
const isFlowStep = (v: FlowView): v is FlowStep => STEP_IDS.includes(v);

/** Each step's line, only from answers in hand: a list still loading or failed gives no line. */
function useStepSummaries(flow: Flow): Record<FlowStep, string | null> {
  const enabled = useTenantQueriesEnabled();
  const intakes = useQuery({ queryKey: ["intakes", flow.id], queryFn: () => listIntakes(flow.id), enabled });
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });

  const ways = intakes.data && waysInWords(intakes.data.filter((i) => i.isEnabled).map((i) => i.kind));
  let send: string | null = null;
  if (outputs.data?.length === 0) send = "No file yet";
  else if (outputs.data && flow.downloadOnly) send = outputs.data.length === 1 ? `1 ${outputTypeLabel(outputs.data[0])} file, you download it` : `${outputs.data.length} files, you download them`;
  else if (outputs.data?.length === 1) send = "1 file";
  else if (outputs.data && destinations.data) {
    const names = [...new Set(outputs.data.flatMap((o) => destinations.data.find((d) => d.id === o.destinationId)?.name ?? []))];
    send = `${outputs.data.length} files${names.length ? `, to ${and(names)}` : ""}`;
  }
  return {
    arrives: ways ? ways[0].toUpperCase() + ways.slice(1) : null,
    read: foundSummary(flow.fields) || "No values yet",
    check: checkModeShort(flow.automation),
    send,
  };
}

/** The step number: 1 and 2 bring in (blue), 3 is neutral (it is not a warning), 4 sends (green). */
const BADGE: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-brand-blue-soft text-brand-blue-deep", 2: "bg-brand-blue-soft text-brand-blue-deep",
  3: "bg-border text-ink", 4: "bg-brand-green-soft text-brand-green-deep",
};
const Badge = ({ n, big }: { n: 1 | 2 | 3 | 4; big?: boolean }) => (
  <span aria-hidden className={`inline-flex flex-none items-center justify-center rounded-full font-bold ${big ? "h-[30px] w-[30px] text-[14px]" : "h-6 w-6 text-[13px]"} ${BADGE[n]}`}>{n}</span>
);
const documentsSoFar = (n: number) => (n ? `${n} so far` : "None yet");

function StepStrip({ flow, view, summaries }: { flow: Flow; view: FlowView; summaries: Record<FlowStep, string | null> }) {
  const id = useId();
  // One row, one underline: the four steps, then Documents and History after a divider.
  const tab = (on: boolean) => `flex h-full w-full flex-col justify-center gap-0.5 border-b-[3px] px-5 pb-[11px] pt-3.5 text-ink no-underline ${on ? "border-navy bg-surface-2" : "border-transparent hover:bg-surface-2"}`;
  const side = (to: "documents" | "history", text: string) => (
    <li className="flex flex-none border-l border-border-faint first:border-l-0">
      <FlowLink href={flowAddress(flow.id, to)} current={view === to} className={tab(view === to)}>
        <span className="whitespace-nowrap text-[15px] font-semibold">{text}</span>
      </FlowLink>
    </li>
  );
  return (
    <nav aria-label="Flow sections" className="hidden lg:block">
      <Card flush>
        <div className="flex min-w-0">
          <ol className="m-0 flex min-w-0 flex-1 list-none p-0">
            {FLOW_STEPS.map((s) => (
              <li key={s.id} className="flex min-w-0 flex-1 border-l border-border-faint first:border-l-0">
                <FlowLink
                  href={flowAddress(flow.id, s.id)} current={view === s.id} label={stepTitle(s.id, flow.downloadOnly)} describedBy={summaries[s.id] ? `${id}-${s.id}` : undefined}
                  className={tab(view === s.id)}
                >
                  <span className="flex items-center gap-2 text-[15px] font-semibold"><Badge n={s.number} />{stepTitle(s.id, flow.downloadOnly)}</span>
                  {summaries[s.id] && <span id={`${id}-${s.id}`} className="pl-8 text-[13px] text-ink-muted">{summaries[s.id]}</span>}
                </FlowLink>
              </li>
            ))}
          </ol>
          <ul className="m-0 flex list-none border-l border-border p-0">
            {side("documents", flow.documentCount ? `Documents · ${flow.documentCount}` : "Documents")}
            {flow.publishedVersion !== undefined && side("history", "History")}
          </ul>
        </div>
      </Card>
    </nav>
  );
}

const ROW = "flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-2.5 text-ink no-underline";
const Row = ({ href, title, line, lead, tag }: { href: string; title: string; line: string | null; lead?: React.ReactNode; tag?: React.ReactNode }) => (
  <li className="border-t border-border-faint first:border-t-0">
    <FlowLink href={href} className={ROW}>
      {lead}
      <span className="grid min-w-0 flex-1 gap-px">
        <span className="text-[16px] font-semibold">{title}</span>
        {line && <span className="text-[14px] text-ink-muted">{line}</span>}
      </span>
      {tag}
      <ChevronRight size={18} aria-hidden className="flex-none text-ink-muted" />
    </FlowLink>
  </li>
);

/** A phone with no step chosen: the four steps as rows, then Documents and History. */
function PhoneOverview({ flow, summaries }: { flow: Flow; summaries: Record<FlowStep, string | null> }) {
  const need = pageTotal(useQuery({ ...flowNeedsYouQuery(flow.id), enabled: useTenantQueriesEnabled() }).data);
  return (
    <div className="grid gap-4">
      <nav aria-label="The four steps of this flow">
        <Card flush>
          <ul className="m-0 list-none p-0">
            {FLOW_STEPS.map((s) => <Row key={s.id} href={flowAddress(flow.id, s.id)} title={stepTitle(s.id, flow.downloadOnly)} line={summaries[s.id]} lead={<Badge n={s.number} big />} />)}
          </ul>
        </Card>
      </nav>
      <nav aria-label="This flow's documents and history">
        <Card flush>
          <ul className="m-0 list-none p-0">
            <Row
              href={flowAddress(flow.id, "documents")} title="Documents in this flow" line={documentsSoFar(flow.documentCount)}
              tag={need ? <span className="flex-none rounded-full bg-amber-soft px-2.5 py-0.5 text-[12.5px] font-semibold text-amber-text">{needsYouWords(need)}</span> : undefined}
            />
            {flow.publishedVersion !== undefined && <Row href={flowAddress(flow.id, "history")} title="History of changes" line="Earlier versions of this flow" />}
          </ul>
        </Card>
      </nav>
    </div>
  );
}

/** The name saves at once (it is not part of a draft). A refusal keeps what was typed and says why under it. */
function RenameForm({ flow, onDone }: { flow: Flow; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(flow.name);
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);   // one request per change, however often Enter is pressed
  useEffect(() => input.current?.focus(), []);
  const save = useMutation({
    mutationFn: (n: string) => updateFlow(flow.id, { name: n }),
    onSuccess: (f) => { qc.setQueryData(["flow", flow.id], f); qc.invalidateQueries({ queryKey: ["flows"] }); onDone(); },
    onSettled: () => { sending.current = false; },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (sending.current || !n) return;
    if (n === flow.name) return onDone();
    sending.current = true;
    save.mutate(n);
  };
  return (
    <form onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape") onDone(); }} className="grid max-w-[480px] gap-2">
      <label className="grid gap-1 text-[13px] font-medium text-ink">
        Flow name
        <input ref={input} className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {save.isError && <p role="alert" className="m-0 text-[12.5px] text-danger">{documentRefusalMessage(save.error)}</p>}
      <span className="flex gap-2">
        <Button type="submit" variant="secondary" loading={save.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </span>
    </form>
  );
}

/** What the chosen view shows. The four steps are filled in by their own pieces; the publish bar sits under them. */
/** We send previews and tests with the newest read document. */
function SendStep({ flow, output }: { flow: Flow; output: string | null }) {
  return <FlowOutputs flow={flow} outputId={output} previewDocumentId={useLatestRead(flow.id).latest?.id ?? null} />;
}

function ViewBody({ flow, view, output }: { flow: Flow; view: FlowView; output: string | null }) {
  const { bump, revision } = useFlowDraft();
  const [discarding, setDiscarding] = useState(false);
  if (view === "history") return <FlowVersionsPanel flowId={flow.id} onRestored={bump} />;
  if (!isFlowStep(view)) return <FlowDocuments flow={flow} />;
  const step: Record<FlowStep, React.ReactNode> = {
    arrives: <FlowIntakePanel flow={flow} />, read: <FlowValues flow={flow} />, check: <FlowCheck flow={flow} />,
    send: <SendStep flow={flow} output={output} />,
  };
  return (
    <div className="grid gap-4">
      <fieldset key={revision} disabled={discarding} className="m-0 min-w-0 border-0 p-0">{step[view]}</fieldset>
      <PublishBar flow={flow} onDiscarding={setDiscarding} />
    </div>
  );
}

function FlowFrame({ flowId }: { flowId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const view = readFlowView(params);
  const output = readFlowOutput(params);
  const draft = useFlowDraft();
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled: useTenantQueriesEnabled() });
  const [renaming, setRenaming] = useState(false);
  const { leave } = draft;
  const go = useCallback((href: string, push?: boolean) => leave(() => (push ? router.push(href) : router.replace(href))), [leave, router]);

  const f = flow.data;
  const live = f?.publishedVersion;
  if (flow.isError && !f && isNotFoundFailure(flow.error)) return <AppNotFound />;
  return (
    <GoContext.Provider value={go}>
      <PageShell variant="wide">
        <PageHeader
          title={f?.name ?? "Flow"}
          back={{ href: "/flows", label: "Flows", onClick: leaveClick(go, "/flows", true) }}
          sub={typeof live === "number" ? (
            <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2 w-2 rounded-full bg-brand-green" />In use</span>
          ) : undefined}
          titleAction={f && (
            <button
              type="button" aria-label="Rename this flow" aria-expanded={renaming} onClick={() => setRenaming((r) => !r)}
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Pencil size={18} aria-hidden />
            </button>
          )}
        />
        {flow.isError && !f ? (
          <Failed error={flow.error} retry={() => flow.refetch()} />
        ) : !f ? (
          <Loading>Loading flow…</Loading>
        ) : (
          <FlowBody flow={f} view={view} output={output} renaming={renaming} onRenamed={() => setRenaming(false)} blocked={draft.stay} />
        )}
      </PageShell>
    </GoContext.Provider>
  );
}

function FlowBody({ flow, view, output, renaming, onRenamed, blocked }: { flow: Flow; view: FlowView | null; output: string | null; renaming: boolean; onRenamed: () => void; blocked: string | null }) {
  const summaries = useStepSummaries(flow);
  // Single-flow answers carry no summary; the flows list does.
  const line = doesLine(useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() }).data?.find((x) => x.id === flow.id) ?? { summary: null });
  // The summary is of the setup in use; a draft waiting to be put in use is said, not shown as if it were live.
  const pending = typeof flow.publishedVersion === "number" && !!flow.hasChanges;
  return (
    <div className="grid gap-4">
      {line && <p className="m-0 text-[14.5px] text-ink">{pending ? `In use now: ${line}` : line}</p>}
      {pending && (!view || view === "documents") && (
        <StatusNotice tone="warning" action={<FlowLink href={flowAddress(flow.id, "send")} className={buttonClass("secondary", "md")}>Review changes</FlowLink>}>
          You have changes that aren&apos;t in use yet.
        </StatusNotice>
      )}
      {renaming && <RenameForm flow={flow} onDone={onRenamed} />}
      {renaming && flow.canDelete && <DeleteFlow flow={flow} />}
      <StepStrip flow={flow} view={view ?? "documents"} summaries={summaries} />
      {view && (
        <div className="lg:hidden">
          <FlowLink href={flowAddress(flow.id, null)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-brand-blue">All steps</FlowLink>
        </div>
      )}
      {blocked && <StatusNotice tone="error">{blocked}</StatusNotice>}
      {/* Above the phone's step cards, or above the desk's Documents: drawn once for both. */}
      {(!view || view === "documents") && !flow.fieldsConfirmed && (
        <StatusNotice tone="warning" action={<FlowLink href={flowAddress(flow.id, "read")} className={buttonClass("secondary", "md")}>Choose the values</FlowLink>}>
          Choose what we read from every document, so each one is read the same way.
        </StatusNotice>
      )}
      {/* No step chosen: a desk shows Documents, a phone the overview (R14). */}
      {!view && <div className="lg:hidden"><PhoneOverview flow={flow} summaries={summaries} /></div>}
      {(!view || view === "documents") && <StreakBand flow={flow} />}
      <div className={view ? undefined : "hidden lg:block"}><ViewBody flow={flow} view={view ?? "documents"} output={output} /></div>
    </div>
  );
}

export function FlowPage({ flowId }: { flowId: string }) {
  return <FlowDraftProvider flowId={flowId}><FlowFrame flowId={flowId} /></FlowDraftProvider>;
}
