"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { documentCountQuery, flowsQuery, needsYouQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listDocumentPage } from "@/lib/api/documents";
import { apiClient } from "@/lib/api-client";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { DOCUMENT_TABS, DOCUMENTS_PAGE_SIZE, documentsAddress, readDocumentsAddress, type DocumentTab } from "@/lib/documentTabs";
import { nextTabIndex } from "@/lib/tabKeys";
import { DocumentList } from "./DocumentList";
import { FirstFlowEmpty, Quiet } from "./states";

const Retry = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" size="sm" onClick={onClick}>Retry</Button>
);

export function DocumentsHome() {
  const engine = useDocumentEngine();
  const router = useRouter();
  const { tab: asked, page } = readDocumentsAddress(useSearchParams());
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  // The numbers rarely change: every minute, on focus, and on any ["documents"] invalidation (a send does one).
  const counts = useQueries({
    queries: DOCUMENT_TABS.map((t) => ({
      ...(t.id === "needs-you" ? needsYouQuery : documentCountQuery(t.statuses ?? [])),
      enabled: engine === "on" && t.statuses !== null,
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    })),
  });
  // With no tab in the address, the default is decided once per visit from the first known needs-you number.
  const latched = useRef<DocumentTab | null>(null);
  if (!latched.current && (counts[0].data || counts[0].isError)) {
    latched.current = (counts[0].data?.totalCount ?? 0) > 0 ? "needs-you" : "all";
  }
  const tab = asked ?? latched.current;
  const tabDef = DOCUMENT_TABS.find((t) => t.id === tab);
  const docs = useQuery({
    queryKey: ["documents", "page", tab, page],
    queryFn: () => listDocumentPage({ status: tabDef?.statuses ?? undefined, page, pageSize: DOCUMENTS_PAGE_SIZE }),
    enabled: engine === "on" && !!tabDef,
    refetchInterval: (q) => (q.state.data?.items.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : 15_000),
  });
  const anyOldOrders = useQuery({
    queryKey: ["archive-any"],
    queryFn: () => apiClient.getOrders({ page: 1, pageSize: 1 }),
    enabled: useTenantQueriesEnabled(),
  });
  const go = (t: DocumentTab) => router.replace(documentsAddress(t));
  const onTabKey = (e: React.KeyboardEvent) => {
    // From the focused tab, not the address: a second press can land before the route commits.
    const to = nextTabIndex(e.key, DOCUMENT_TABS.findIndex((t) => `documents-tab-${t.id}` === e.currentTarget.id), DOCUMENT_TABS.length);
    if (to === undefined) return;
    e.preventDefault();
    go(DOCUMENT_TABS[to].id);
    document.getElementById(`documents-tab-${DOCUMENT_TABS[to].id}`)?.focus();
  };

  let panel;
  if (docs.isError) {
    panel = (
      <StatusNotice tone="error" action={<Retry onClick={() => docs.refetch()} />}>
        {documentRefusalMessage(docs.error)}
      </StatusNotice>
    );
  } else if (!tabDef || !docs.data) {
    panel = <Quiet>Loading documents…</Quiet>;
  } else if (docs.data.items.length === 0) {
    panel = page === 1 ? <Quiet>No documents here.</Quiet> : (
      <div className="flex flex-col items-start gap-2">
        <Quiet>There is nothing on this page.</Quiet>
        <Link href={documentsAddress(tabDef.id)} className={buttonClass("secondary", "sm")}>First page</Link>
      </div>
    );
  } else {
    const { items, totalCount } = docs.data;
    const from = (page - 1) * DOCUMENTS_PAGE_SIZE + 1;
    const to = from + items.length - 1;
    panel = (
      <div className="flex flex-col gap-3">
        <Card flush>
          <DocumentList key={`${tabDef.id}:${page}`} documents={items} showFlow sendable label={`Documents: ${tabDef.label}`}
            needHeading={tabDef.id === "needs-you" ? "What's needed" : "Status"} />
        </Card>
        {/* Edge-aligned, with room below: on phones the round Add button rises over the page's centre. */}
        {totalCount > DOCUMENTS_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
            <p className="m-0 text-[13px] text-ink-muted">{`Documents ${from} to ${to} of ${totalCount}`}</p>
            <div className="flex gap-2">
              {page > 1 && <Link href={documentsAddress(tabDef.id, page - 1)} className={buttonClass("secondary", "sm")}>Previous</Link>}
              {to < totalCount && <Link href={documentsAddress(tabDef.id, page + 1)} className={buttonClass("secondary", "sm")}>Next</Link>}
            </div>
          </div>
        )}
      </div>
    );
  }

  let body;
  if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (flows.isError && !flows.data) {
    body = (
      <StatusNotice tone="error" action={<Retry onClick={() => flows.refetch()} />}>
        {documentRefusalMessage(flows.error)}
      </StatusNotice>
    );
  } else if (engine === "unknown" || !flows.data) {
    body = <Quiet>Loading flows…</Quiet>;
  } else if (flows.data.length === 0) {
    body = <FirstFlowEmpty />;
  } else {
    body = (
      <div className="flex min-w-0 flex-col gap-3">
        <div role="tablist" aria-label="Show" className="flex overflow-x-auto border-b border-border">
          {DOCUMENT_TABS.map((t, i) => {
            const n = counts[i].data?.totalCount;
            const selected = t.id === tab;
            return (
              <button
                key={t.id} type="button" role="tab" id={`documents-tab-${t.id}`} aria-controls="documents-panel" aria-selected={selected}
                tabIndex={selected || (!tab && i === 0) ? 0 : -1} onKeyDown={onTabKey} onClick={() => go(t.id)}
                className={`flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] ${selected ? "border-b-2 border-brand-blue font-semibold text-ink" : "text-ink-muted"}`}
              >
                {t.label}
                {n !== undefined && <>{" "}<span>{n}</span></>}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="documents-panel" aria-labelledby={tab ? `documents-tab-${tab}` : undefined}>{panel}</div>
        {pagePopulation(anyOldOrders.data).rows > 0 && <Link href="/archive" className="text-[13px]">Old orders</Link>}
      </div>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader title="Documents" sub="Every document that has arrived, newest first." />
      {body}
    </PageShell>
  );
}
