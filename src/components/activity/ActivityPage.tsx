"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import { Download, Search } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { EmptyState } from "@/components/bridge/EmptyState";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listActivity, listDestinations, type ActivityEvent } from "@/lib/api/documents";
import {
  ACTIVITY_PAGE_SIZE, ACTIVITY_TABS, activityAddress, activityCsv, activityDay, activityView, activityWho, memberNames, readActivityAddress, type ActivityTabKey,
} from "@/lib/activityRows";
import { intoStrip } from "@/lib/intoStrip";
import { saveBlob } from "@/lib/saveBlob";
import { nextTabIndex } from "@/lib/tabKeys";
import { ACTIVITY_GRID, ActivityRow } from "./ActivityRow";

const Quiet = ({ children }: { children: string }) => <p role="status" className="m-0 text-[13px] text-ink-muted">{children}</p>;
const count = (n: number) => n.toLocaleString("en-GB");
const EXPORT_CAP = 2000;
const EXPORT_KEY = ["activity-export"];
/** A delivery row that names its destination only by id. */
const unnamed = (e: ActivityEvent) => {
  const p = e.payload as { destinationId?: unknown; destination?: unknown } | null;
  return !!p && typeof p === "object" && p.destinationId != null && p.destination == null;
};

export function ActivityPage() {
  const router = useRouter();
  const { tab, page } = readActivityAddress(useSearchParams());
  const tabDef = ACTIVITY_TABS.find((t) => t.key === tab)!;
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const enabled = useTenantQueriesEnabled();
  const { memberships } = useOrganization({ memberships: { pageSize: 100 } });
  const members = memberNames(memberships?.data);

  // A new search lands on the first page of the tab, after a pause in typing. Off page 1 the address moves first and
  // the effect runs again there, so the server is never asked for the old page under the new term.
  useEffect(() => {
    const next = text.trim();
    if (next === term) return;
    const t = setTimeout(() => {
      if (page > 1) router.replace(activityAddress(tab));
      else { setTerm(next); setOpenId(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [text, term, tab, page, router]);

  // No placeholderData: a new tab or page shows "Loading history…", never the rows of the one before.
  const activity = useQuery({
    queryKey: ["activity", tab, term, page],
    queryFn: () => listActivity({ page, pageSize: ACTIVITY_PAGE_SIZE, actions: tabDef.actions, q: term }),
    enabled,
  });
  const destinations = useQuery({
    queryKey: ["destinations"], queryFn: listDestinations, enabled: enabled && !!activity.data?.events.some(unnamed),
  });
  const destinationName = (id: string) => destinations.data?.find((d) => d.id === id)?.name ?? null;

  // Walks the tab and search in pages of 200, newest first, up to EXPORT_CAP events.
  // A tab press bumps `exportRun`: a walk started on another tab stops and hands over no file.
  const qc = useQueryClient();
  const exportRun = useRef(0);
  const exporting = useMutation({
    mutationKey: EXPORT_KEY,
    mutationFn: async () => {
      const run = exportRun.current;
      const events: ActivityEvent[] = [];
      let total = EXPORT_CAP;
      for (let p = 1; run === exportRun.current && events.length < Math.min(total, EXPORT_CAP); p++) {
        const r = await listActivity({ page: p, pageSize: 200, actions: tabDef.actions, q: term });
        total = r.total;
        if (r.events.length === 0) break;
        events.push(...r.events);
      }
      const kept = events.slice(0, EXPORT_CAP);
      const names = kept.some(unnamed) ? await qc.ensureQueryData({ queryKey: ["destinations"], queryFn: listDestinations }) : [];
      const name = (id: string) => names.find((d) => d.id === id)?.name ?? null;
      if (run !== exportRun.current) return null;
      saveBlob(new Blob([activityCsv(kept, members, name)], { type: "text/csv" }), `history-${new Date().toLocaleDateString("en-CA")}.csv`);
      return { kept: kept.length, total };
    },
  });

  const go = (t: ActivityTabKey) => {
    setOpenId(null);
    exportRun.current++;
    exporting.reset();
    router.replace(activityAddress(t));
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    const to = nextTabIndex(e.key, ACTIVITY_TABS.findIndex((t) => `activity-tab-${t.key}` === e.currentTarget.id), ACTIVITY_TABS.length);
    if (to === undefined) return;
    e.preventDefault();
    go(ACTIVITY_TABS[to].key);
    document.getElementById(`activity-tab-${ACTIVITY_TABS[to].key}`)?.focus();
  };

  let panel;
  if (activity.isError && !activity.data) {
    panel = (
      <StatusNotice tone="error" action={<Button size="sm" onClick={() => activity.refetch()}>Try again</Button>}>
        We couldn&apos;t load your history. Nothing is lost. Check your connection and try again.
      </StatusNotice>
    );
  } else if (!activity.data) {
    panel = <Quiet>Loading history…</Quiet>;
  } else if (activity.data.events.length === 0) {
    panel = page > 1 ? (
      <div className="flex flex-col items-start gap-2">
        <Quiet>There is nothing on this page.</Quiet>
        <Link href={activityAddress(tab)} className={buttonClass("secondary", "sm")}>First page</Link>
      </div>
    ) : term ? (
      <Card>
        <EmptyState compact title={`Nothing matches “${term}”.`} sub="Search looks at file names and document numbers." />
        <div className="flex justify-center pb-4">
          <Button onClick={() => { setText(""); setTerm(""); }}>Clear the search</Button>
        </div>
      </Card>
    ) : (
      <Card>
        <EmptyState compact title={tabDef.emptyTitle} sub={tabDef.emptySub} />
        {tab === "all" && (
          <div className="flex justify-center pb-4">
            <Link href="/upload" className={buttonClass("blue")}>Upload a document</Link>
          </div>
        )}
      </Card>
    );
  } else {
    const { events, total } = activity.data;
    const now = new Date();
    const days: { day: string; events: ActivityEvent[] }[] = [];
    for (const e of events) {
      const day = activityDay(e.ts, now);
      if (days.at(-1)?.day === day) days.at(-1)!.events.push(e);
      else days.push({ day, events: [e] });
    }
    const from = (page - 1) * ACTIVITY_PAGE_SIZE + 1;
    const to = from + events.length - 1;
    const shown = page === 1 ? (to >= total ? `Showing all ${count(total)}.` : `Showing the newest ${count(events.length)} of ${count(total)}.`)
      : `Showing ${count(from)} to ${count(to)} of ${count(total)}.`;
    panel = (
      <div className="flex flex-col gap-3">
        <Card flush>
          <div aria-hidden className={`${ACTIVITY_GRID} hidden min-h-[42px] pl-5 pr-2 text-[12.5px] text-ink-muted lg:grid`}>
            <span>Time</span><span>What happened</span><span>Flow</span><span>Who</span><span>Result</span><span />
          </div>
          {days.map((d) => (
            <Fragment key={d.day}>
              <h2 className="m-0 border-t border-border-faint bg-bg px-4 py-2.5 text-[13px] font-semibold text-ink-muted lg:px-5">{d.day}</h2>
              <ul className="m-0 list-none p-0">
                {d.events.map((e) => {
                  const who = activityWho(e, members);
                  return (
                    <ActivityRow key={e.id} event={e} who={who} view={activityView(e, { who, destinationName })}
                      open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </Card>
        {/* Edge-aligned, with room below: on phones the round Add button rises over the page's centre. */}
        <nav aria-label="History pages" className="flex flex-wrap items-center gap-x-4 gap-y-2.5 pb-6">
          <p className="m-0 flex-[1_1_200px] text-[13px] text-ink-muted">{shown}</p>
          <div className="flex gap-2.5">
            {page > 1 && <Link href={activityAddress(tab, page - 1)} className={buttonClass()}>Newer</Link>}
            {to < total && <Link href={activityAddress(tab, page + 1)} className={buttonClass()}>Older</Link>}
          </div>
        </nav>
      </div>
    );
  }

  return (
    <Frame actions={
      <Button disabled={!enabled || exporting.isPending} onClick={() => qc.isMutating({ mutationKey: EXPORT_KEY }) || exporting.mutate()}>
        <Download size={16} aria-hidden />Export
      </Button>
    }>
      <div className="flex min-w-0 flex-col gap-3">
        {exporting.isPending && <StatusNotice tone="working">Preparing the file…</StatusNotice>}
        {exporting.isError && <StatusNotice tone="error">We couldn&apos;t prepare the file. Try again.</StatusNotice>}
        {exporting.data && exporting.data.total > exporting.data.kept && (
          <StatusNotice tone="warning">The file has the newest {count(exporting.data.kept)} of {count(exporting.data.total)} events.</StatusNotice>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
          <div role="tablist" aria-label="Show" className="flex min-w-0 flex-[1_1_360px] gap-1 overflow-x-auto">
            {ACTIVITY_TABS.map((t) => {
              const selected = t.key === tab;
              return (
                <button
                  key={t.key} type="button" role="tab" id={`activity-tab-${t.key}`} aria-controls="activity-panel" aria-selected={selected}
                  tabIndex={selected ? 0 : -1} onKeyDown={onTabKey} onClick={() => go(t.key)} ref={selected ? (el) => intoStrip(el) : undefined}
                  className={`-mb-px flex h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-[14px] ${selected ? "border-brand-blue font-semibold text-ink" : "border-transparent text-ink-muted"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="relative mb-1.5 w-full sm:w-auto sm:flex-[0_1_360px]">
            <label className="sr-only" htmlFor="activity-search">Search history</label>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              id="activity-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by file name or document number"
              className="h-11 w-full rounded-lg border border-border-strong bg-surface pl-9 pr-3 text-[14px] text-ink sm:h-10"
            />
          </div>
        </div>
        <section id="activity-panel" role="tabpanel" aria-label="History, newest first">{panel}</section>
      </div>
    </Frame>
  );
}

const Frame = ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
  <PageShell variant="wide">
    <PageHeader title="History" sub="Everything that happened to your documents." back={{ href: "/documents", label: "Documents" }} actions={actions} />
    {children}
  </PageShell>
);

/** The route's Suspense fallback: the page frame and the in-page loading line, so the first paint does not shift. */
export const ActivityLoading = () => <Frame actions={<Button disabled><Download size={16} aria-hidden />Export</Button>}><Quiet>Loading history…</Quiet></Frame>;
