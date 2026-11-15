"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFlow, listFlows } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { isFirstFlow, readFirstRunAddress } from "@/lib/firstRun";
import { CheckStep, Gone, notFound, useRunDocument } from "./CheckStep";
import { SendStep } from "./SendStep";
import { Failed, Quiet } from "./states";
import { Welcome } from "./Welcome";

const BACK = { href: "/flows", label: "Flows" };
const PILLS = ["Add a document", "Check what we read", "Choose where it goes"] as const;

/** A step's frame before its title is known: the back link as PageHeader draws it, and a title-height line that is no heading
 *  (the title waits for the flows, R24; an empty heading would be announced). */
function Bare({ children }: { children: React.ReactNode }) {
  return (
    <PageShell variant="narrow">
      <Link href={BACK.href} aria-label={`Back to ${BACK.label}`} className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand-blue hover:underline sm:min-h-[40px]">
        <ChevronLeft size={18} aria-hidden />{BACK.label}
      </Link>
      <div aria-hidden className="mb-5 h-[29px] sm:h-[33px]" />
      {children}
    </PageShell>
  );
}

const SetUp = ({ flowId }: { flowId: string }) => (
  <div className="grid justify-items-start gap-2">
    <p className="m-0 text-[14px] text-ink">This flow is set up.</p>
    <Link href={`/flows/${flowId}`} className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand-blue sm:min-h-0">Open the flow</Link>
  </div>
);

/** The Suspense fallback (R24): PageShell, the "Flows" back link, a title-height placeholder, "Loading…". */
export const FirstRunLoading = () => <Bare><Quiet>Loading…</Quiet></Bare>;

/** The frame both later steps share: PageShell, PageHeader (title per isFirstFlow, sub, back "Flows"), the pills. */
export { useRunDocument };

export function StepFrame({ step, sub, first, children }: { step: 2 | 3; sub: string; first: boolean; children: React.ReactNode }) {
  return (
    <PageShell variant="wide">
      <PageHeader title={first ? "Set up your first flow" : "Set up a new flow"} sub={sub} back={BACK} />
      <ol aria-label="Steps" className="m-0 mb-5 flex list-none flex-wrap gap-2 p-0">
        {PILLS.map((p, i) => (
          <li
            key={p} aria-current={i + 1 === step ? "step" : undefined}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${i + 1 === step ? "bg-navy text-white" : "bg-surface-2 text-ink-muted"}`}
          >{p}</li>
        ))}
      </ol>
      {children}
    </PageShell>
  );
}

/** /flows/new: reads the address (Task 2), loads the flows, and renders Welcome, CheckStep or SendStep. */
export function FirstRun() {
  const address = readFirstRunAddress(useSearchParams());
  const enabled = useTenantQueriesEnabled();
  const flowId = address.flow ?? "";
  const flows = useQuery({ queryKey: ["flows"], queryFn: listFlows, enabled });
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled: enabled && !!flowId });
  const run = useRunDocument(flowId, address.doc);

  if (!flows.data) return <Bare>{flows.isError ? <Failed error={flows.error} retry={() => flows.refetch()} /> : <Quiet>Loading flows…</Quiet>}</Bare>;
  // A finished flow is set up: no step runs on it again, so Back after Finish cannot re-arm a send or rewrite its fields.
  if (flow.data && flow.data.publishedVersion != null) return <Bare><SetUp flowId={flow.data.id} /></Bare>;
  if (address.step === "add") return flowId && flow.isLoading ? <Bare><Quiet>Loading…</Quiet></Bare> : <Welcome flows={flows.data} flowId={address.flow} />;
  if (!flow.data) {
    if (notFound(flow.error)) return <Bare><Gone text={COPY.flow_not_found} /></Bare>;
    return <Bare>{flow.isError ? <Failed error={flow.error} retry={() => flow.refetch()} /> : <Quiet>Loading…</Quiet>}</Bare>;
  }
  const first = isFirstFlow(flows.data, flow.data.id);
  // R2: send opens only once the fields are saved; until then the address's send reads as check.
  if (address.step === "send" && flow.data.fieldsConfirmed)
    return <StepFrame step={3} sub="Step 3 of 3. Choose where the file goes." first={first}><SendStep flow={flow.data} docId={run.docId} first={first} /></StepFrame>;
  const sub = `Step 2 of 3. This is what we read from ${run.isSample ? "our sample invoice" : "your document"}.`;
  return <StepFrame step={2} sub={sub} first={first}><CheckStep flow={flow.data} docId={run.docId} first={first} /></StepFrame>;
}
