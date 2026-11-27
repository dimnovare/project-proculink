"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { documentCountQuery } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listDocumentPage, updateFlow } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus, STATUS } from "@/lib/documentStatusManifest";
import { documentsAddress, NEEDS_YOU_STATUSES } from "@/lib/documentTabs";
import { acceptFor, kindsLine, MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { flowAddress } from "@/lib/flowSteps";
import { pageTotal } from "@/lib/pageTotal";
import { DocumentList } from "./DocumentList";
import { streakText } from "./FlowCheck";
import { FileDrop } from "./FileDrop";
import { useFlowSaved } from "./PublishBar";
import { useUploadQueue } from "./UploadQueue";
import { Failed, Quiet, Loading } from "./states";

const NEWEST = 10;

/** The count of this flow's documents that need a person, and the newest of them; one request for every reader. */
export const flowNeedsYouQuery = (flowId: string) => documentCountQuery(NEEDS_YOU_STATUSES, flowId);

/** "{n} needs you" / "{n} need you". */
export const needsYouWords = (n: number) => `${n} ${n === 1 ? "needs" : "need"} you`;

const dismissedKey = (flowId: string) => `plk:streak-dismissed:${flowId}`;
const readDismissed = (flowId: string) => {
  try { return localStorage.getItem(dismissedKey(flowId)) !== null; } catch { return false; }   // blocked storage: the band may show again
};

/** Five or more documents in a row sent with no correction, on review: a hint that checking only what we marked would do. */
export function StreakBand({ flow }: { flow: Flow }) {
  // The flow hidden in this visit, for when storage is blocked; storage is read again on every render.
  const [hidden, setHidden] = useState<string | null>(null);
  const saved = useFlowSaved(flow.id);
  const update = useMutation({ mutationFn: () => updateFlow(flow.id, { automation: "marked" }), onSuccess: saved });
  const streak = flow.noCorrectionStreak;
  // Said after the switch, which also takes the flow off review (and so would hide the band).
  if (update.isSuccess && hidden !== flow.id) return (
    <Card dense className="flex flex-wrap items-center gap-3">
      <p role="status" className="m-0 min-w-0 flex-[1_1_320px] text-[13.5px] text-ink">
        Done. Documents with nothing marked now go out by themselves. Change this on You check.
      </p>
      <span className="flex flex-wrap gap-2">
        <Link href={flowAddress(flow.id, "check")} className={buttonClass("secondary", "md")}>Open You check</Link>
        <Button variant="ghost" onClick={() => setHidden(flow.id)}>Close</Button>
      </span>
    </Card>
  );
  if (flow.automation !== "review" || typeof streak !== "number" || streak < 5 || hidden === flow.id || readDismissed(flow.id)) return null;
  const hide = () => {
    try { localStorage.setItem(dismissedKey(flow.id), "1"); } catch { /* blocked storage: hidden for this visit only */ }
    setHidden(flow.id);
  };
  return (
    <Card dense className="flex flex-wrap items-center gap-3">
      <p className="m-0 min-w-0 flex-[1_1_320px] text-[13.5px] text-ink">
        {`${streakText(streak)} With “Check only what we marked”, only a document with a marked value waits for you.`}
      </p>
      <span className="flex flex-wrap gap-2">
        <Button
          // Phones: the long label wraps inside the card instead of running past its edge (360).
          variant="secondary" className="border-brand-green text-brand-green-deep max-sm:h-auto max-sm:min-h-[44px] max-sm:whitespace-normal max-sm:py-2" loading={update.isPending}
          onClick={() => { if (!update.isPending) update.mutate(); }}
        >
          Send unmarked documents automatically
        </Button>
        <Button variant="ghost" onClick={hide}>Not now</Button>
      </span>
      {update.isError && <p role="alert" className="m-0 w-full text-[12.5px] text-danger">{documentRefusalMessage(update.error)}</p>}
    </Card>
  );
}

/** The flow's Documents view: a drop zone, then the newest ten of this flow with what needs a person. */
export function FlowDocuments({ flow }: { flow: Flow }) {
  const enabled = useTenantQueriesEnabled();
  const queue = useUploadQueue();
  const page = useQuery({
    queryKey: ["documents", "flow", flow.id, "newest"],
    queryFn: () => listDocumentPage({ flowId: flow.id, page: 1, pageSize: NEWEST }),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : false),
  });
  // Polled with the list while a row is being read, so a read that ends in review is counted (else "Nothing needs you").
  const reading = page.data?.items.some((d) => documentStatus(d.status, d.statusReason).tone === "working");
  const needs = useQuery({ ...flowNeedsYouQuery(flow.id), enabled, refetchInterval: reading ? 2000 : false });
  const total = pageTotal(page.data);
  const need = pageTotal(needs.data);
  const unsent = pageTotal(useQuery({ ...documentCountQuery([STATUS.send_failed], flow.id), enabled }).data);
  const couldNotSend = unsent ? `${unsent} couldn't be sent. ` : "";
  const next = need ? needs.data?.items[0] : undefined;

  return (
    <div className="grid gap-4">
      <FileDrop
        accept={acceptFor(flow)} maxBytes={MAX_UPLOAD_BYTES}
        prompt={<><span className="hidden md:inline">Drop a file to add it to this flow.</span><span className="md:hidden">Add a file to this flow.</span>{` ${kindsLine(flow)}`}</>}
        onFile={(file) => queue.add([file], flow)}
      />
      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="grid gap-0.5">
            {/* A desk names this view in the step row above, so the heading is for phones and screen readers. */}
            <h2 className="m-0 text-[16px] font-semibold text-ink lg:sr-only">Documents in this flow</h2>
            <p className="m-0 text-[13px] text-ink-muted">
              {need === undefined ? "Newest first." : need === 0 ? `${couldNotSend}${couldNotSend ? "Nothing else needs" : "Nothing needs"} you. Newest first.` : `${couldNotSend}${needsYouWords(need)}. Newest first.`}
            </p>
          </div>
          {next && (
            <Link href={`/flows/${next.flowId}/documents/${next.id}`} className={buttonClass("send", "lg")} aria-label={`Review next, ${needsYouWords(need!)}`}>
              Review next
              <span className="rounded-full bg-navy/30 px-2 text-[12.5px]">{need}</span>
            </Link>
          )}
        </div>
        {page.isError && !page.data ? (
          <div className="px-4 pb-4"><Failed error={page.error} retry={() => page.refetch()} /></div>
        ) : !page.data ? (
          <div className="px-4 pb-4"><Loading>Loading documents…</Loading></div>
        ) : page.data.items.length === 0 ? (
          <div className="px-4 pb-4"><Quiet>No documents in this flow yet. Drop a file above, or send one to this flow&apos;s email address.</Quiet></div>
        ) : (
          <DocumentList documents={page.data.items} showFlow={false} sendable label="Documents in this flow" />
        )}
        {total !== undefined && total > NEWEST && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 border-t border-border-faint px-4 py-3 text-[13px] text-ink-muted">
            {`Showing the newest ${NEWEST} of ${total}.`}
            <Link href={documentsAddress("all", 1)} className="inline-flex items-center font-semibold text-brand-blue">All documents</Link>
          </p>
        )}
      </Card>
    </div>
  );
}
