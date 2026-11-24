"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { ActionBar } from "@/components/bridge/layout/ActionBar";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { documentCountQuery, documentsPageQuery, flowsQuery, needsYouQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listDocumentPage } from "@/lib/api/documents";
import { apiClient } from "@/lib/api-client";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { pageTotal } from "@/lib/pageTotal";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import {
  BEING_READ_STATUSES, DOCUMENT_TABS, DOCUMENTS_PAGE_SIZE, documentsAddress, documentsHelper, readDocumentsAddress, startOfWeek, type DocumentTab,
} from "@/lib/documentTabs";
import { intoStrip } from "@/lib/intoStrip";
import { nextTabIndex } from "@/lib/tabKeys";
import { useApple } from "@/hooks/useShortcut";
import { keyWord, openSearch } from "@/lib/shortcuts";
import { DocumentList, type ListSelection } from "./DocumentList";
import { SelectionBar, type BarReport } from "./SelectionBar";
import { firstRunOf } from "@/lib/firstRun";
import { CaughtUp, EmptyFilter, Failed, Quiet, Loading } from "./states";
import { StoppedAlert } from "./StoppedAlert";
import { Welcome } from "./Welcome";

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
  const week = useQuery({
    // A fixed key, and the week's start worked out when asked: a page left open over Sunday night moves on by itself.
    queryKey: ["documents", "count", "sent", "this-week"],
    queryFn: () => listDocumentPage({ status: ["sent"], sentFrom: startOfWeek(new Date()).toISOString(), page: 1, pageSize: 1 }),
    enabled: engine === "on",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  // Often while something is being read, so the number falls as reads finish.
  const beingRead = useQuery({
    ...documentCountQuery(BEING_READ_STATUSES),
    enabled: engine === "on",
    // A failed count keeps its old data: ask again once a minute, not every five seconds.
    refetchInterval: (q) => (q.state.status === "error" ? 60_000 : (pageTotal(q.state.data) ?? 0) > 0 ? 5_000 : 60_000),
    refetchOnWindowFocus: true,
  });
  const stopped = useQuery({
    queryKey: ["documents", "stopped"],
    queryFn: () => listDocumentPage({ status: ["send_failed"], page: 1, pageSize: 20 }),
    enabled: engine === "on",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  // With no tab in the address, the default is decided once per visit from the first known needs-you number.
  const latched = useRef<DocumentTab | null>(null);
  if (!latched.current && (counts[0].data || counts[0].isError)) {
    latched.current = (pageTotal(counts[0].data) ?? 0) > 0 ? "needs-you" : "all";
  }
  const tab = asked ?? latched.current;
  const tabDef = DOCUMENT_TABS.find((t) => t.id === tab);
  const docs = useQuery({
    ...documentsPageQuery(tab as DocumentTab, page), // the tab is known whenever this is enabled
    enabled: engine === "on" && !!tabDef,
    refetchInterval: (q) => (q.state.data?.items.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : 15_000),
  });
  const anyOldOrders = useQuery({
    queryKey: ["archive-any"],
    queryFn: () => apiClient.getOrders({ page: 1, pageSize: 1 }),
    enabled: useTenantQueriesEnabled(),
  });
  const apple = useApple();
  // Select mode, and the ticks: they belong to one tab and page, and only rows on screen count (R17).
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<{ at: string; ids: Set<string> }>({ at: "", ids: new Set() });
  // The last bulk run's result lives here, not in the bar, so Done, Clear or a tab change during a run does not lose it;
  // the person's next action clears it. What the screen sent is never sent again from a bar.
  const [report, setReport] = useState<BarReport | null>(null);
  const sent = useRef(new Set<string>()).current;
  const here = `${tab}:${page}`;
  const [seen, setSeen] = useState(here);
  if (seen !== here) { // a new tab or page clears the ticks and the last result
    setSeen(here);
    setPicked({ at: "", ids: new Set() });
    setReport(null);
  }
  const rows = docs.data?.items ?? [];
  const ticked = picked.at === here ? rows.filter((d) => picked.ids.has(d.id)) : [];
  const pick = (ids: Set<string>) => { setPicked({ at: here, ids }); setReport(null); };
  const clear = () => pick(new Set());
  const selection: ListSelection = {
    ids: new Set(ticked.map((d) => d.id)),
    toggle: (id) => {
      const ids = new Set(ticked.map((d) => d.id));
      if (!ids.delete(id)) ids.add(id);
      pick(ids);
    },
    all: (on) => pick(new Set(on ? rows.map((d) => d.id) : [])),
  };
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
  if (docs.isError && !docs.data) {
    panel = <Failed error={docs.error} retry={() => docs.refetch()} what="your documents" />;
  } else if (!tabDef || !docs.data) {
    panel = <Loading>Loading documents…</Loading>;
  } else if (docs.data.items.length === 0) {
    panel = page === 1 ? (tabDef.id === "needs-you" ? <CaughtUp /> : <EmptyFilter tab={tabDef.id} />) : (
      <div className="flex flex-col items-start gap-2">
        <Quiet>There is nothing on this page.</Quiet>
        <Link href={documentsAddress(tabDef.id)} className={buttonClass("secondary", "sm")}>First page</Link>
      </div>
    );
  } else {
    const { items } = docs.data;
    const totalCount = pageTotal(docs.data) ?? 0;
    const from = (page - 1) * DOCUMENTS_PAGE_SIZE + 1;
    const to = from + items.length - 1;
    panel = (
      <div className="flex flex-col gap-3">
        <Card flush>
          <DocumentList key={`${tabDef.id}:${page}`} documents={items} showFlow sendable label={`Documents: ${tabDef.label}`}
            needHeading="What happened" selection={selecting ? selection : undefined} />
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
        {tabDef.id === "needs-you" && to >= totalCount && (
          <p className="m-0 text-[14px] text-ink-muted">That is everything that needs you.</p>
        )}
      </div>
    );
  }

  // Only an answered list can say the workspace is new: loading or failed draws its own state below.
  if (engine !== "off" && flows.data && firstRunOf(flows.data).state === "new") return <Welcome flows={flows.data} />;

  let body;
  if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (flows.isError && !flows.data) {
    body = <Failed error={flows.error} retry={() => flows.refetch()} what="your documents" />;
  } else if (engine === "unknown" || !flows.data) {
    body = <Loading>Loading documents…</Loading>;
  } else {
    body = (
      <div className="flex min-w-0 flex-col gap-3">
        <StoppedAlert page={stopped.data} />
        {/* Phones: Select drops under the tabs so all four tabs fit at 360px. */}
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:border-b sm:border-border">
          <div role="tablist" aria-label="Show" className="no-scrollbar flex w-full min-w-0 flex-nowrap overflow-x-auto border-b border-border sm:w-auto sm:flex-1 sm:border-b-0">
            {DOCUMENT_TABS.map((t, i) => {
              const n = pageTotal(counts[i].data);
              const selected = t.id === tab;
              return (
                <button
                  key={t.id} type="button" role="tab" id={`documents-tab-${t.id}`} aria-controls="documents-panel" aria-selected={selected}
                  tabIndex={selected || (!tab && i === 0) ? 0 : -1} onKeyDown={onTabKey} onClick={() => go(t.id)}
                  ref={selected ? (el) => intoStrip(el) : undefined}
                  className={`flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-[13px] sm:px-3 ${selected ? "border-b-2 border-brand-blue font-semibold text-ink" : "text-ink-muted"}`}
                >
                  {t.label}
                  {n !== undefined && <>{" "}<span>{n}</span></>}
                </button>
              );
            })}
          </div>
          {(rows.length > 0 || selecting) && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0"
              title={selecting ? "Stop ticking documents" : "Tick several documents to send, download or remove them together"}
              onClick={() => { setSelecting(!selecting); clear(); }}>
              {selecting ? "Done" : "Select"}
            </Button>
          )}
        </div>
        <div role="tabpanel" id="documents-panel" aria-labelledby={tab ? `documents-tab-${tab}` : undefined}>{panel}</div>
        {selecting ? (
          <SelectionBar key={here} selected={ticked} sent={sent} report={report} onReport={setReport} onClear={clear}
            onSent={(id) => {
              sent.add(id);
              setPicked((p) => ({ ...p, ids: new Set([...p.ids].filter((x) => x !== id)) }));
            }} />
        ) : report && <StatusNotice tone={report.ok ? "success" : "error"}>{report.lines}</StatusNotice>}
        {/* One line for everything older. History is not in the top bar; it is reached from here. Its links keep a 44px tap height; the negative margin keeps the lines even (A-10). */}
        <p className="m-0 text-[13px] text-ink-muted">
          To download or remove several at once, press Select and tick them. Open any document to remove it from there.{" "}
          Older documents are under All
          {pagePopulation(anyOldOrders.data).rows > 0 && <> and <Link href="/archive" className="-my-3 inline-flex items-center font-medium text-brand-blue-deep underline">Old orders</Link></>}
          <span className="hidden md:inline">
            , or press{" "}
            <button type="button" onClick={openSearch} aria-label={`Search all documents, ${keyWord("Mod", apple)} K`}
              className="-my-3 inline-flex items-center font-medium text-brand-blue-deep underline">{`${keyWord("Mod", apple)} K`}</button>
            {" "}to find any document
          </span>
          . What happened to each one is in{" "}
          <Link href="/operations/log" className="-my-3 inline-flex items-center font-medium text-brand-blue-deep underline">History</Link>.
        </p>
      </div>
    );
  }

  const needs = counts[0].data;
  const needTotal = pageTotal(needs);
  const next = needs && (needTotal ?? 0) > 0 ? needs.items[0] : undefined;
  // While rows are ticked the selection bar's Send is the one filled button (R23).
  const reviewNext = (testId?: string, only = "") => next && (
    <Link
      href={`/flows/${next.flowId}/documents/${next.id}`} data-testid={testId}
      className={`${buttonClass(ticked.length ? "secondary" : "send", "lg")}${only}`}
      aria-label={`Review next, ${needTotal} ${needTotal === 1 ? "needs" : "need"} you`}
    >
      Review next
      <span className="rounded-full bg-navy/30 px-2 text-[12.5px]">{needTotal}</span>
    </Link>
  );
  return (
    // A being-read count that is unknown, or whose last request failed, says nothing (R6).
    <Frame sub={documentsHelper(needTotal, pageTotal(week.data), beingRead.isError ? undefined : pageTotal(beingRead.data))} actions={reviewNext("review-next", " hidden md:inline-flex")}>
      {body}
      {/* Not in Select mode: the selection bar and its result sit where this bar would cover them. */}
      {next && !selecting && <ActionBar>{reviewNext()}</ActionBar>}
    </Frame>
  );
}

const Frame = ({ children, sub, actions }: { children: React.ReactNode; sub?: string | null; actions?: React.ReactNode }) => (
  <PageShell variant="wide">
    {/* The line's height is kept while its words change from the plain line to the counts, so nothing below moves. */}
    <PageHeader title="Documents" sub={<span className="inline-block min-h-[2.9em] sm:min-h-[1.45em]">{sub ?? "Every document that has arrived, newest first."}</span>} actions={actions} />
    {children}
  </PageShell>
);

/** What the screen draws before its first answer; the route's Suspense fallback, so the first paint does not shift. */
export const DocumentsLoading = () => <Frame><Loading>Loading documents…</Loading></Frame>;
