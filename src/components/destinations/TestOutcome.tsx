"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { scrollTo } from "@/lib/scrollTo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listDocumentPage } from "@/lib/api/documents";
import type { DestinationTestResult, DocumentRow } from "@/lib/api/documents";
import { sendMoment, testPassedWords } from "@/lib/destinations";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { eachDocument, sendOne, type Each } from "@/lib/eachDocument";
import { documentsAddress } from "@/lib/documentTabs";
import { pageTotal } from "@/lib/pageTotal";
import { serverReasonOrNull } from "@/lib/serverText";

const GO_ON = { form: "Check the details above, save, and test again.", row: "Press Edit to check the details, then test again." };
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** A test's result where it was pressed, worded by what that kind of test proves, and, after a pass, the documents still waiting. */
export function TestOutcome({ destinationId, protocol, result, error, at, place, offerResend = true }: {
  destinationId: string;
  protocol: string;
  /** The answer, or null while there is none. */
  result: DestinationTestResult | null;
  /** A refused or failed request. */
  error: unknown;
  /** When the test was pressed (epoch ms). */
  at: number;
  place: "form" | "row";
  /** False: no "Send it now", e.g. after a test of a flow's draft, which a resend would not use. */
  offerResend?: boolean;
}) {
  if (!result && !error) return null;
  // A new element per press (key), scrolled into view as it mounts: clear of a phone's tab bar, and once per test.
  const shown = (body: ReactNode) => <div key={at} ref={scrollTo} className="grid gap-2">{body}</div>;
  if (!result) return shown(<StatusNotice tone="error">{documentRefusalMessage(error)}</StatusNotice>);

  const reason = serverReasonOrNull(result.message);
  const moment = sendMoment(new Date(at).toISOString(), new Date());
  if (!result.success)
    return shown(
      <StatusNotice tone="error">
        {reason ? <>The test didn&apos;t arrive: <span>{sentence(reason)}</span></> : "The test didn't arrive."} {GO_ON[place]}
      </StatusNotice>
    );

  return shown(
    <>
      <StatusNotice tone="success">
        {protocol === "ksef" || protocol === "b2brouter" ? reason : <>
          {protocol === "google_sheets"
            ? `We could open the spreadsheet and the tab${moment ? ` ${moment}` : ""}. No rows were added.`
            : `${testPassedWords(protocol)}${moment ? ` ${moment}` : ""}.`}
          {reason && <> <span>{reason}</span></>}
        </>}
      </StatusNotice>
      {offerResend && <WaitingDocuments destinationId={destinationId} at={at} />}
    </>
  );
}

/** The documents this destination stopped trying, with one button that sends them all. Nothing while none wait. */
export function WaitingDocuments({ destinationId, at }: { destinationId: string; /** Keys the list, so a new test asks again. */ at: number }) {
  const qc = useQueryClient();
  const waiting = useQuery({
    queryKey: ["documents", "waiting", destinationId, at],
    queryFn: () => listDocumentPage({ waitingOnDestination: destinationId, page: 1, pageSize: 50 }),
    enabled: useTenantQueriesEnabled(),
  });
  // Held from the press itself, so a second press before the next render sends nothing.
  const busy = useRef(false);
  // When the last run ended: a list fetched before then (even mid-run) may name documents already on their way.
  const [ranAt, setRanAt] = useState(0);
  const send = useMutation({
    mutationFn: (run: Promise<Each<DocumentRow, unknown>>) => run,
    onSettled: () => {
      busy.current = false;
      setRanAt(Date.now());
      for (const key of ["documents", "destinations", "activity"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });

  const n = pageTotal(waiting.data) ?? 0;
  const items = waiting.data?.items ?? [];
  const latest = items.reduce<string | null>((m, d) => (d.failedAt && (!m || Date.parse(d.failedAt) > Date.parse(m)) ? d.failedAt : m), null);
  const when = latest && sendMoment(latest, new Date());
  const done = send.data;
  const tried = done ? done.done.length + done.refused.length : 0;
  return (
    <>
      {/* After a run, only a list fetched since it ended is offered. During the run the band stays, its button loading. */}
      {n > 0 && (send.isPending || waiting.dataUpdatedAt > ranAt) && (
        <div data-testid="destination-waiting"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-soft px-3 py-2.5 text-[13px] text-amber-text">
          <p className="m-0">
            <strong>{n === 1 ? "1 document is waiting for this destination." : `${n} documents are waiting for this destination.`}</strong>{" "}
            {`${n === 1 && items[0] ? items[0].fileName : "The latest"} couldn't be sent${when ? ` ${when}` : ""}. We stopped trying.`}
          </p>
          <Button type="button" variant="secondary" size="sm" loading={send.isPending}
            className="!border-brand-green-deep !text-brand-green-deep"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              send.mutate(eachDocument(items, sendOne));
            }}>
            {/* It sends every document listed (one page of 50 at most), so it says how many. */}
            {items.length === 1 ? "Send it now" : items.length < n ? `Send the first ${items.length} now` : `Send all ${n} now`}
          </Button>
        </div>
      )}
      {done && done.refused.length > 0 && (
        <StatusNotice tone="error" action={
          <Link href={documentsAddress("failed")} className="inline-flex items-center font-semibold underline">Show what couldn&apos;t be sent</Link>
        }>
          {`${tried === 1 ? done.refused[0].item.fileName : `${done.refused.length} of ${tried}`} couldn't be sent again: ${documentRefusalMessage(done.refused[0].error)}`}
        </StatusNotice>
      )}
      {done && (done.stopped ? (
        <StatusNotice tone="error">
          {`${done.done.length ? `${done.done.length} sent. ` : ""}${documentRefusalMessage(done.stopped.error)}`}
        </StatusNotice>
      ) : done.refused.length === 0 && (
        <StatusNotice tone="success">
          {done.done.length === 1 ? `${done.done[0].item.fileName} is on its way again.` : `${done.done.length} documents are on their way again.`}
        </StatusNotice>
      ))}
    </>
  );
}
