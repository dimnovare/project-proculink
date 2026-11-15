"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getBillingStatus } from "@/lib/api/billing";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { deliveryModeLabel } from "@/lib/deliveryMode";
import { doesLine } from "@/lib/flowSentences";
import { PLAN_BY_ID, planName, type PlanId } from "@/lib/plans";
import { relativeTime } from "@/lib/relativeTime";
import { FirstFlowEmpty, Quiet } from "./states";

const COLUMNS = "minmax(0,2.4fr) minmax(0,1.2fr) minmax(0,1.4fr) 88px 120px 16px";
const HEADS = ["Flow", "When a document is ready", "Needs you", "Documents", "Last document"];

const Chevron = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-muted">
    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** What needs a person, in tags; "Nothing waiting" for a known zero; nothing without a summary. */
function Needs({ f }: { f: Flow }) {
  const s = f.summary;
  if (!s) return null;
  const tags = [
    s.needsYou > 0 && <Pill key="you" tone="amber">{`${s.needsYou} ${s.needsYou === 1 ? "needs" : "need"} you`}</Pill>,
    s.couldNotSend > 0 && <Pill key="send" tone="danger">{`${s.couldNotSend} couldn't be sent`}</Pill>,
    s.couldNotRead > 0 && <Pill key="read" tone="danger">{`${s.couldNotRead} couldn't be read`}</Pill>,
  ].filter(Boolean);
  return tags.length ? <div className="flex flex-wrap gap-2">{tags}</div> : <span className="text-[13px] text-ink-muted">Nothing waiting</span>;
}

/** The last document's time, "No documents yet" for a known none, or null when unknown (no summary, or a time we cannot read). */
function last(f: Flow): { text: string; time: boolean } | null {
  if (!f.summary) return null;
  if (f.summary.lastDocumentAt === null) return { text: "No documents yet", time: false };
  const when = relativeTime(f.summary.lastDocumentAt);
  return when ? { text: when, time: true } : null;
}

/** The link keeps the flow name as its name; the sentence (`{p}-line`) and the rest (`{p}-more`) describe it. */
const describedBy = (f: Flow, p: string) => (doesLine(f) ? `${p}-line ${p}-more` : `${p}-more`);

function Name({ f, p }: { f: Flow; p: string }) {
  const line = doesLine(f);
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-[15px] font-semibold text-ink">{f.name}</span>
      {line && <span id={`${p}-line`} className="text-[13px] text-ink-muted">{line}</span>}
    </div>
  );
}

function FlowRows({ flows }: { flows: Flow[] }) {
  return (
    <>
      <div data-testid="flows-table" className="hidden lg:block">
        <div aria-hidden className="grid gap-3 px-4 py-2 text-[12.5px] font-medium text-ink-muted" style={{ gridTemplateColumns: COLUMNS }}>
          {HEADS.map((h) => <span key={h}>{h}</span>)}
        </div>
        <ul className="m-0 list-none p-0">
          {flows.map((f) => {
            const p = `flow-${f.id}-desk`;
            return (
              <li key={f.id} className="border-t border-border">
                <Link href={`/flows/${f.id}`} aria-label={f.name} aria-describedby={describedBy(f, p)}
                  className="grid items-center gap-3 px-4 py-3 text-ink hover:bg-surface-2" style={{ gridTemplateColumns: COLUMNS }}>
                  <Name f={f} p={p} />
                  <div id={`${p}-more`} className="contents">
                    <span className="text-[13px] text-ink-muted">{deliveryModeLabel(f.automation === "auto")}</span>
                    <Needs f={f} />
                    <span className="text-[13px] text-ink">{f.documentCount || "None yet"}</span>
                    <span className="text-[13px] text-ink-muted">{last(f)?.text}</span>
                  </div>
                  <Chevron />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <ul data-testid="flows-phone-list" className="m-0 list-none p-0 lg:hidden">
        {flows.map((f) => {
          const lastOne = last(f);
          const p = `flow-${f.id}-phone`;
          return (
            <li key={f.id} className="border-t border-border first:border-t-0">
              <Link href={`/flows/${f.id}`} aria-label={f.name} aria-describedby={describedBy(f, p)} className="flex items-center gap-3 px-4 py-3 text-ink">
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Name f={f} p={p} />
                  <div id={`${p}-more`} className="contents">
                    <span className="text-[13px] text-ink-muted">{deliveryModeLabel(f.automation === "auto")}</span>
                    <Needs f={f} />
                    <div className="flex flex-wrap gap-x-3 text-[13px] text-ink-muted">
                      <span>{f.documentCount ? `${f.documentCount} ${f.documentCount === 1 ? "document" : "documents"}` : "None yet"}</span>
                      {lastOne && <span>{lastOne.time ? `Last one ${lastOne.text}` : lastOne.text}</span>}
                    </div>
                  </div>
                </div>
                <Chevron />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function FlowsHome() {
  const router = useRouter();
  const engine = useDocumentEngine();
  const enabled = useTenantQueriesEnabled();
  // Same key as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, refetchOnMount: "always", refetchInterval: 60_000, enabled });
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, enabled, staleTime: 60_000 });
  const newFlow = () => router.push("/flows/new");
  const plan = billing.data?.plan;
  const limit = plan ? PLAN_BY_ID[plan as PlanId]?.flowLimit : null;

  let body;
  if (flows.data) {
    body = flows.data.length === 0 ? <FirstFlowEmpty /> : (
      <div className="flex flex-col gap-3">
        <Card flush as="section" aria-labelledby="flows-heading">
          <h2 id="flows-heading" className="m-0 px-4 pb-2 pt-3.5 text-[14px] font-semibold text-ink">Your flows</h2>
          <FlowRows flows={flows.data} />
        </Card>
        {plan && typeof limit === "number" && (
          <p className="m-0 text-[13px] text-ink-muted">
            {`${flows.data.length} of ${limit} flows on ${planName(plan)}. Need more? `}
            <Link href="/settings?tab=billing" className="inline-flex items-center font-semibold underline">See plans</Link>
          </p>
        )}
      </div>
    );
  } else if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (flows.isError) {
    body = (
      <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={() => flows.refetch()}>Retry</Button>}>
        {documentRefusalMessage(flows.error)}
      </StatusNotice>
    );
  } else {
    body = <Quiet>Loading flows…</Quiet>;
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Flows"
        sub="A flow is one kind of document and where its data goes."
        actions={flows.data?.length ? <Button variant="primary" size="md" onClick={newFlow}>New flow</Button> : undefined}
      />
      {body}
    </PageShell>
  );
}
