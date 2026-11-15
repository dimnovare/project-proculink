"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { ApiHttpError } from "@/lib/api/core";
import { listDocumentPage, sendDocument } from "@/lib/api/documents";
import type { DestinationTestResult, DocumentRow } from "@/lib/api/documents";
import { sendMoment } from "@/lib/destinations";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { documentsAddress } from "@/lib/documentTabs";
import { pageTotal } from "@/lib/pageTotal";
import { serverReasonOrNull } from "@/lib/serverText";

/** `stopped`: a refusal about the workspace, after which nothing more was asked. */
type Resent = { sent: string[]; refused: { fileName: string; error: unknown }[]; stopped?: unknown };

const GO_ON = { form: "Check the details above, save, and test again.", row: "Press Edit to check the details, then test again." };
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
/** A plan, limit or access refusal, or paused processing (which Send answers 409): every next send would get the same. */
const aboutWorkspace = (e: unknown) =>
  (e instanceof ApiHttpError && [402, 403, 429].includes(e.status)) || refusalToken(e) === "processing_paused";

/** One request per document, one after another. Never throws: each refusal is kept with its file. */
async function sendEach(items: DocumentRow[]): Promise<Resent> {
  const out: Resent = { sent: [], refused: [] };
  for (const d of items) {
    try {
      await sendDocument(d.id);
      out.sent.push(d.fileName);
    } catch (error) {
      if (aboutWorkspace(error)) return { ...out, stopped: error };
      out.refused.push({ fileName: d.fileName, error });
    }
  }
  return out;
}

/** A test's result where it was pressed, and, after a pass, the documents that were waiting with "Send it now". */
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
  const qc = useQueryClient();
  const waiting = useQuery({
    queryKey: ["documents", "waiting", destinationId, at],
    queryFn: () => listDocumentPage({ waitingOnDestination: destinationId, page: 1, pageSize: 50 }),
    enabled: useTenantQueriesEnabled() && !!result?.success && offerResend,
  });
  // Held from the press itself, so a second press before the next render sends nothing.
  const busy = useRef(false);
  // When the last run ended: a list fetched before then (even mid-run) may name documents already on their way.
  const [ranAt, setRanAt] = useState(0);
  const send = useMutation({
    mutationFn: (run: Promise<Resent>) => run,
    onSettled: () => {
      busy.current = false;
      setRanAt(Date.now());
      for (const key of ["documents", "destinations", "activity"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });

  if (!result && !error) return null;
  if (!result) return <StatusNotice tone="error">{documentRefusalMessage(error)}</StatusNotice>;

  const reason = serverReasonOrNull(result.message);
  const moment = sendMoment(new Date(at).toISOString(), new Date());
  if (!result.success)
    return (
      <StatusNotice tone="error">
        {reason ? <>The test didn&apos;t arrive: <span>{sentence(reason)}</span></> : "The test didn't arrive."} {GO_ON[place]}
      </StatusNotice>
    );

  const n = pageTotal(waiting.data) ?? 0;
  const items = waiting.data?.items ?? [];
  const latest = items.reduce<string | null>((m, d) => (d.failedAt && (!m || Date.parse(d.failedAt) > Date.parse(m)) ? d.failedAt : m), null);
  const when = latest && sendMoment(latest, new Date());
  const done = send.data;
  const tried = done ? done.sent.length + done.refused.length : 0;
  return (
    <div className="grid gap-2">
      <StatusNotice tone="success">
        {protocol === "google_sheets"
          ? `We could open the spreadsheet and the tab${moment ? ` ${moment}` : ""}. No rows were added.`
          : `Test file arrived${moment ? ` ${moment}` : ""}.`}
        {reason && <> <span>{reason}</span></>}
      </StatusNotice>
      {/* After a run, only a list fetched since it ended is offered. During the run the band stays, its button loading. */}
      {offerResend && n > 0 && (send.isPending || waiting.dataUpdatedAt > ranAt) && (
        <div data-testid="destination-waiting"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-soft px-3 py-2.5 text-[13px] text-amber-text">
          <p className="m-0">
            <strong>{n === 1 ? "1 document was waiting for this destination." : `${n} documents were waiting for this destination.`}</strong>{" "}
            {`${n === 1 && items[0] ? items[0].fileName : "The latest"} couldn't be sent${when ? ` ${when}` : ""}. We stopped trying.`}
          </p>
          <Button type="button" variant="secondary" size="sm" loading={send.isPending}
            className="!border-brand-green-deep !text-brand-green-deep"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              send.mutate(sendEach(items));
            }}>
            Send it now
          </Button>
        </div>
      )}
      {done && done.refused.length > 0 && (
        <StatusNotice tone="error" action={
          <Link href={documentsAddress("failed")} className="inline-flex items-center font-semibold underline">Show what couldn&apos;t be sent</Link>
        }>
          {`${tried === 1 ? done.refused[0].fileName : `${done.refused.length} of ${tried}`} couldn't be sent again: ${documentRefusalMessage(done.refused[0].error)}`}
        </StatusNotice>
      )}
      {done && ("stopped" in done ? (
        <StatusNotice tone="error">
          {`${done.sent.length ? `${done.sent.length} sent. ` : ""}${documentRefusalMessage(done.stopped)}`}
        </StatusNotice>
      ) : done.refused.length === 0 && (
        <StatusNotice tone="success">
          {done.sent.length === 1 ? `${done.sent[0]} is on its way again.` : `${done.sent.length} documents are on their way again.`}
        </StatusNotice>
      ))}
    </div>
  );
}
