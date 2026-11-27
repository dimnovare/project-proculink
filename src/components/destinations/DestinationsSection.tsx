"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { DestinationForm } from "@/components/flows/DestinationForm";
import { Failed, Loading } from "@/components/flows/states";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteDestination, listDestinations, testDestination } from "@/lib/api/documents";
import type { Destination } from "@/lib/api/documents";
import { destinationsAddress, destinationWhere, lastSendWords, readDestinationsAddress, usedByWords } from "@/lib/destinations";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { activityAddress } from "@/lib/activityRows";
import { documentsAddress } from "@/lib/documentTabs";
import { GoogleAccounts } from "./GoogleAccounts";
import { TestOutcome, WaitingDocuments } from "./TestOutcome";

/** Name, where, used by, last send, the buttons. Below lg a row stacks: name and where left, buttons right, the rest under. */
const COLUMNS = "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,1fr)_9rem]";
const TONE = { ok: "text-brand-green-deep", failed: "text-danger-text", never: "text-ink-muted" };

/** Settings › Destinations: every destination, tested and edited in place; one deleted only when nothing uses it. */
export function DestinationsSection() {
  const qc = useQueryClient();
  const router = useRouter();
  const { open } = readDestinationsAddress(useSearchParams());
  const list = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled: useTenantQueriesEnabled() });
  const [gone, setGone] = useState<string | null>(null);
  const go = (id?: string) => { setGone(null); router.replace(destinationsAddress(id), { scroll: false }); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["destinations"] });
  const missing = !!open && open !== "new" && !!list.data && !list.data.some((d) => d.id === open);

  let rows: React.ReactNode;
  if (list.isError && !list.data) rows = <div className="p-4"><Failed error={list.error} retry={() => list.refetch()} /></div>;
  else if (!list.data) rows = <div className="p-4"><Loading>Loading destinations…</Loading></div>;
  else if (!list.data.length)
    rows = (
      <div className="grid gap-1 p-4">
        <p className="m-0 text-[14px] font-semibold text-ink">No destinations yet.</p>
        <p className="m-0 text-[14px] text-ink-muted">Add one here, or while you set up a flow&apos;s file.</p>
      </div>
    );
  else
    rows = (
      <>
        <div aria-hidden className={`hidden gap-x-4 border-b border-border px-4 py-2 text-[12.5px] font-semibold text-ink-muted lg:grid ${COLUMNS}`}>
          <span>Name</span><span>Where</span><span>Used by</span><span>Last send</span><span />
        </div>
        <ul aria-label="Destinations" className="m-0 list-none p-0">
          {list.data.map((d) => (
            <DestinationRow key={d.id} d={d} open={open === d.id} go={go} refresh={refresh}
              onDeleted={() => { go(); setGone(d.name); refresh(); }} />
          ))}
        </ul>
      </>
    );

  return (
    // Width comes from the Settings page, so it matches the tab rule and the other tabs.
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[14px] text-ink-muted">Every place your files can be sent. Change a login or send a test here at any time.</p>
        <Button type="button" variant="secondary" aria-expanded={open === "new"} onClick={() => go(open === "new" ? undefined : "new")}>
          Add a destination
        </Button>
      </div>
      {gone && <StatusNotice tone="success">{`${gone} was deleted.`}</StatusNotice>}
      {missing && <StatusNotice tone="warning">We can&apos;t find that destination. It may have been deleted.</StatusNotice>}
      <Card flush>
        {open === "new" && (
          <div role="region" aria-label="New destination" className="border-b border-border bg-bg p-4">
            <DestinationForm inline testAfterSave onSaved={refresh} onCancel={() => go()} />
          </div>
        )}
        {rows}
      </Card>
      <GoogleAccounts destinations={list.data} />
    </div>
  );
}

function DestinationRow({ d, open, go, refresh, onDeleted }: {
  d: Destination; open: boolean; go(id?: string): void; refresh(): void; onDeleted(): void;
}) {
  const confirm = useConfirm();
  // Held from the press itself, so a second press before the next render sends no second test.
  const busy = useRef(false);
  const test = useMutation({
    mutationFn: () => testDestination(d.id),
    onSettled: () => { busy.current = false; refresh(); },
  });
  const del = useMutation({
    mutationFn: () => deleteDestination(d.id),
    onSuccess: onDeleted,
    // An output saved since the list loaded: ask again, so its name appears.
    onError: (e) => { if (refusalToken(e) === "destination_in_use") refresh(); },
  });
  // An older server may send neither key: absent says nothing; only an explicit null is "Never sent". It also sent the newer of the
  // last real send and the last test as one: a test there is read as the test, so it never stands in for the real send.
  const sent = d.lastSend?.kind === "test" ? undefined : d.lastSend;
  const tested = d.lastTest ?? (d.lastSend?.kind === "test" ? d.lastSend : null);
  const last = sent === undefined ? null : lastSendWords(sent, new Date(), d.protocol);
  const lastTest = tested && lastSendWords(tested, new Date(), d.protocol);
  const uses: number | undefined = d.usedBy?.length;
  // Focus follows the panel: into its first field on opening (also on arriving from an address, so the panel is
  // brought into view once), back to this row's Edit when it closes.
  const item = useRef<HTMLLIElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const el = item.current;
    if (open && !wasOpen.current) {
      el?.querySelector("[role=region]")?.scrollIntoView({ block: "nearest" });
      el?.querySelector<HTMLElement>("[role=region] input, [role=region] select, [role=region] textarea")?.focus({ preventScroll: true });
    }
    if (!open && wasOpen.current && (!document.activeElement || document.activeElement === document.body))
      el?.querySelector<HTMLElement>("[data-row-edit]")?.focus();
    wasOpen.current = open;
  }, [open]);

  async function remove() {
    const yes = await confirm({
      title: "Delete destination", description: `Delete "${d.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true,
    });
    if (yes) del.mutate();
  }

  return (
    <li ref={item} className="border-b border-border last:border-b-0">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 lg:items-center ${COLUMNS}`}>
        <span className="min-w-0 break-words text-[14.5px] font-semibold text-ink">{d.name}</span>
        {/* Below sm the "where" goes under the name, so a narrow phone never splits the name mid-word. */}
        <span className="min-w-0 break-words text-[13px] text-ink-muted max-sm:col-span-full">{destinationWhere(d)}</span>
        <span className="col-span-full min-w-0 break-words text-[13px] text-ink lg:col-span-1">
          {/* Phones have no column heading, so the line names itself. */}
          {!!uses && <span className="text-ink-muted lg:hidden">Used by </span>}
          {d.usedBy && usedByWords(d.usedBy)}
        </span>
        <span className={`col-span-full text-[13px] lg:col-span-1 ${last ? TONE[last.tone] : ""}`}>
          {last?.tone === "ok" && <Check aria-hidden size={14} className="mr-1 inline align-[-2px]" />}
          {last?.text}
          {last?.tone === "failed" && (
            <>
              <span aria-hidden>{" · "}</span>
              <Link href={sent?.kind === "document" ? documentsAddress("failed") : activityAddress("all", 1, sent?.at)} className="inline-flex items-center font-semibold underline max-lg:min-h-[44px]">See why</Link>
            </>
          )}
          {lastTest && <span className={`block text-[12.5px] ${TONE[lastTest.tone]}`}>{lastTest.text}</span>}
        </span>
        <span className="col-span-full flex items-start gap-2 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-end lg:col-start-5 lg:row-span-1 lg:items-center">
          {open ? (
            <span className="text-[13px] font-semibold text-ink-muted">Editing</span>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" aria-label={`Send a test to ${d.name}`} loading={test.isPending}
                onClick={() => { if (busy.current) return; busy.current = true; test.mutate(); }}>Send a test</Button>
              <Button type="button" variant="secondary" size="sm" aria-label={`Edit ${d.name}`} aria-expanded={open} data-row-edit
                onClick={() => go(d.id)}>Edit</Button>
            </>
          )}
        </span>
      </div>
      {open ? (
        <div role="region" aria-label={`Edit ${d.name}`} className="grid gap-3 border-t border-border bg-bg p-4">
          <DestinationForm destination={d} inline testAfterSave onSaved={refresh} onCancel={() => go()} />
          {uses === undefined ? null : uses > 0 ? (
            <div className="grid gap-1 text-[13px] text-ink-muted">
              <p className="m-0">
                {uses === 1 ? "One file uses this destination, so it can't be deleted." : `${uses} files use this destination, so it can't be deleted.`}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {d.usedBy.map((u) => (
                  <Link key={u.outputId} href={`/flows/${u.flowId}?tab=outputs`} className="inline-flex items-center font-semibold text-ink underline">
                    {`${u.outputName} in ${u.flowName}`}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            // Below a line, in red text, away from the test result and the form's own buttons.
            <div className="border-t border-border pt-3"><Button type="button" variant="ghost" className="!px-0 !text-danger-text" loading={del.isPending} onClick={remove}>Delete destination</Button></div>
          )}
          {del.isError && <StatusNotice tone="error">{documentRefusalMessage(del.error)}</StatusNotice>}
        </div>
      ) : (
        <>
          {(test.data || test.isError) && (
            <div className="px-4 pb-3">
              <TestOutcome destinationId={d.id} protocol={d.protocol} result={test.data ?? null} error={test.error} at={test.submittedAt} place="row" />
            </div>
          )}
          {/* From the server, so it stays after a reload while documents wait; a passed test above already shows it. */}
          {sent?.ok === false && !test.data?.success && <div className="px-4 pb-3 empty:hidden"><WaitingDocuments destinationId={d.id} at={0} /></div>}
        </>
      )}
    </li>
  );
}
