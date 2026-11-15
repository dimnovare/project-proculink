"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFlow, listDocumentPage, listFlows } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { isFirstFlow, readFirstRunAddress } from "@/lib/firstRun";
import { CheckStep, Gone, notFound } from "./CheckStep";
import { Failed, Quiet } from "./states";
import { Welcome } from "./Welcome";

const BACK = { href: "/flows", label: "Flows" };
const PILLS = ["Add a document", "Check what we read", "Choose where it goes"] as const;

/** A step's frame before its title is known: the back link and a title-height line. */
function Bare({ children }: { children: React.ReactNode }) {
  return (
    <PageShell variant="narrow">
      <PageHeader title={" "} back={BACK} />
      {children}
    </PageShell>
  );
}

/** The Suspense fallback (R24): PageShell, the "Flows" back link, a title-height placeholder, "Loading…". */
export const FirstRunLoading = () => <Bare><Quiet>Loading…</Quiet></Bare>;

/** The frame both later steps share: PageShell, PageHeader (title per isFirstFlow, sub, back "Flows"), the pills. */
export function StepFrame({ step, sub, first, children }: { step: 2 | 3; sub: string; first: boolean; children: React.ReactNode }) {
  return (
    <PageShell variant="wide">
      <PageHeader title={first ? "Set up your first flow" : "Set up a new flow"} sub={sub} back={BACK} />
      <ol aria-label="Steps" className="m-0 mb-5 flex list-none flex-wrap gap-2 p-0">
        {PILLS.map((p, i) => (
          <li
            key={p} aria-current={i + 1 === step ? "step" : undefined}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${i + 1 === step ? "bg-navy text-white" : "bg-surface2 text-ink-muted"}`}
          >{p}</li>
        ))}
      </ol>
      {children}
    </PageShell>
  );
}

/** Where the document of this run is: its row on the flow's first page (for `isSample`), else unknown. */
export function useRunDocument(flowId: string, docId: string | null) {
  const page = useQuery({
    queryKey: ["documents", "first-run", flowId], enabled: useTenantQueriesEnabled() && !!flowId,
    queryFn: () => listDocumentPage({ flowId, page: 1, pageSize: 20 }),
  });
  const id = docId ?? page.data?.items[0]?.id ?? null;
  const row = page.data?.items.find((r) => r.id === id);
  return { row, isSample: row ? row.isSample : null, docId: id, isLoading: page.isLoading, error: page.error };
}

/** /flows/new: reads the address (Task 2), loads the flows, and renders Welcome, CheckStep or SendStep. */
export function FirstRun() {
  const address = readFirstRunAddress(useSearchParams());
  const enabled = useTenantQueriesEnabled();
  const flowId = address.step === "add" ? "" : address.flow!;
  const flows = useQuery({ queryKey: ["flows"], queryFn: listFlows, enabled });
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled: enabled && !!flowId });
  const run = useRunDocument(flowId, address.doc);

  if (!flows.data) return <Bare>{flows.isError ? <Failed error={flows.error} retry={() => flows.refetch()} /> : <Quiet>Loading flows…</Quiet>}</Bare>;
  if (!flowId) return <Welcome flows={flows.data} flowId={address.flow} />;
  if (!flow.data) {
    if (notFound(flow.error)) return <Bare><Gone text={COPY.flow_not_found} /></Bare>;
    return <Bare>{flow.isError ? <Failed error={flow.error} retry={() => flow.refetch()} /> : <Quiet>Loading…</Quiet>}</Bare>;
  }
  const first = isFirstFlow(flows.data, flow.data.id);
  // R2: send opens only once the fields are saved; until then the address's send reads as check.
  if (address.step === "send" && flow.data.fieldsConfirmed)
    return <StepFrame step={3} sub="" first={first}><Quiet>Loading…</Quiet></StepFrame>;
  const sub = `Step 2 of 3. This is what we read from ${run.isSample ? "our sample invoice" : "your document"}.`;
  return <StepFrame step={2} sub={sub} first={first}><CheckStep flow={flow.data} docId={run.docId} first={first} /></StepFrame>;
}
