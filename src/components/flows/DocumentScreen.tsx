"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { SourceDocumentBody, scrollTo, type SourcePick } from "@/components/bridge/document/SourceDocumentBody";
import { DOCX_MEDIA_TYPE, sourceRenderFor } from "@/lib/sourceDocument";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { reviewQueueQuery } from "@/hooks/useDocumentEngine";
import { reviewMarks } from "@/lib/reviewMarks";
import { documentHref, pickNext, positionText, queuePosition } from "@/lib/reviewQueue";
import { documentsAddress } from "@/lib/documentTabs";
import { relativeTime } from "@/lib/relativeTime";
import { fetchDocumentSource, getDocument, getFlow, getDocumentHistory, retryDocumentRead, sendDocument, teachDocument } from "@/lib/api/documents";
import { formatDateTime } from "@/lib/format-date";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import type { DocumentDetail, DocumentPage, Flow, SourceLocation, TeachRequest } from "@/lib/api/documents";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { INPUT } from "./DestinationForm";
import { ADDED_TO_CHANGES, ReadValuesPanel, type Teach } from "./ReadValuesPanel";
import { Checks, Failed, Quiet, ReadProblem } from "./states";
import { rowNeed } from "./DocumentList";

// The file's own extension decides the viewer. The server's content type is not trusted for this.
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: DOCX_MEDIA_TYPE,
  txt: "text/plain",
  edi: "text/plain",
  x12: "text/plain",
  xml: "application/xml",
  cxml: "application/xml",
  json: "application/json",
};

/** `document.value_edited` becomes "Value edited". The payload is never shown. */
const actionWords = (action: string) => {
  const words = action.replace(/^document\./, "").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const SOURCES = new Map([
  ["upload", "upload"], ["email", "email"], ["api", "the API"], ["imap", "mailbox"],
  ["sftp", "SFTP"], ["ftp", "FTP"], ["ftps", "FTPS"], ["s3", "S3"],
]);

/** A toggle "History"; open, the entries, the first one the flow version the document was read with when known. */
function History({ documentId, version }: { documentId: string; version: number | null | undefined }) {
  const enabled = useTenantQueriesEnabled();
  const [open, setOpen] = useState(false);
  const history = useQuery({ queryKey: ["document-history", documentId], queryFn: () => getDocumentHistory(documentId), enabled });
  return (
    <div className="grid justify-items-end gap-2 text-[12.5px]">
      <Button size="sm" variant="ghost" aria-expanded={open} aria-controls="document-history" onClick={() => setOpen((o) => !o)}>History</Button>
      <div id="document-history" hidden={!open} className="justify-self-stretch">
        {history.isError ? <p className="m-0 text-ink-muted">{documentRefusalMessage(history.error)}</p> : (
          <ul className="m-0 grid list-none gap-1 p-0 text-ink-muted">
            {typeof version === "number" && <li>Processed with version {version}</li>}
            {!history.data ? <li>Loading…</li> : history.data.length === 0 ? <li>No changes yet.</li> : history.data.map((h, i) => (
              <li key={i}>{actionWords(h.action)}, {formatDateTime(h.at)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const typeOf = (fileName: string) => {
  const ext = /\.([^.]*)$/.exec(fileName)?.[1].toLowerCase() ?? "";
  return Object.hasOwn(TYPES, ext) ? TYPES[ext] : "application/octet-stream";
};

const PICK_HELP: Record<string, string> = {
  pdf: "Draw a box around {label} on the page, or click two corners.",
  image: "Draw a box around {label} on the page, or click two corners.",
  sheet: "Click the cell that holds {label}.",
  text: "Select the words for {label}, then choose Use selected words.",
};
const KEYS_HELP = "No mouse? Tab to the page, move the box with the arrow keys, resize it with Shift and the arrows, then press Enter.";

/** What to do while pointing, and the way out when the box held no words. */
function TeachBanner({ label, render, mutation, onSave, onCancel }: {
  label: string; render: string; mutation: { isError: boolean; error: unknown }; onSave(value: string): void; onCancel(): void;
}) {
  const [typed, setTyped] = useState("");
  const noText = mutation.isError && refusalToken(mutation.error) === "no_text_in_area";
  return (
    <div ref={scrollTo} className="grid gap-2 px-4 pb-2">
      <StatusNotice tone="working" action={<Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}>
        {PICK_HELP[render].replace("{label}", () => label)}
        {(render === "pdf" || render === "image") && <span className="mt-1 block">{KEYS_HELP}</span>}
      </StatusNotice>
      {mutation.isError && (noText ? (
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onSave(typed.trim()); }}>
          <StatusNotice tone="warning" action={<Button type="submit" size="sm" variant="secondary" disabled={!typed.trim()}>Save</Button>}>
            We couldn&apos;t find text there. Type what it says:
            <input autoFocus aria-label="What it says" className={`${INPUT} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </StatusNotice>
        </form>
      ) : <StatusNotice tone="error">{documentRefusalMessage(mutation.error)}</StatusNotice>)}
    </div>
  );
}

export function Original({ documentId, fileName, highlight, marks, onPick }: { documentId: string; fileName: string; highlight?: SourceLocation | null; marks?: readonly SourceLocation[]; onPick?(p: SourcePick): void }) {
  const isLg = useLgViewport();
  const enabled = useTenantQueriesEnabled();
  const source = useQuery({ queryKey: ["document-source", documentId], queryFn: () => fetchDocumentSource(documentId), enabled });
  const type = typeOf(fileName);
  if (source.isPending) return <p className="px-4 pb-4 text-[12.5px] text-ink-muted">Opening the document…</p>;
  if (source.isError || source.data.size === 0)
    return <p className="px-4 pb-4 text-[12.5px] text-ink-muted">The original isn&apos;t available right now.</p>;
  return <SourceDocumentBody cacheKey={documentId} document={{ blob: source.data, contentType: type, filename: fileName }} bounded={isLg} highlight={highlight} marks={marks} onPick={onPick} />;
}

/** A change typed on this document could not be saved, so nothing was sent. */
const UNSAVED = new Error("unsaved");
const UNSAVED_TEXT = "Nothing was sent: your last change isn't saved yet.";

/** The route's component: everything below is keyed by the document, so nothing carries over to the next one. */
export function DocumentScreen(p: { flowId: string; documentId: string }) {
  return <Review key={p.documentId} {...p} />;
}

function Review({ flowId, documentId }: { flowId: string; documentId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const [spot, setSpot] = useState<SourceLocation | null>(null);
  const edits = useDocumentEdits(documentId);
  const doc = useQuery({
    queryKey: ["document", documentId], enabled,
    queryFn: async () => {
      const prev = qc.getQueryData<DocumentDetail>(["document", documentId]);
      const next = await getDocument(documentId);
      // A status change means the worker did something: the deliveries and history beside it are stale.
      if (prev && prev.summary.status !== next.summary.status)
        for (const k of ["deliveries", "document-history"]) qc.invalidateQueries({ queryKey: [k, documentId] });
      return next;
    },
    refetchInterval: (q) => {
      const d = q.state.data?.summary;
      return d && documentStatus(d.status, d.statusReason).tone === "working" ? 2000 : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => retryDocumentRead(documentId),
    onSuccess: () => Promise.all(["document", "document-history"].map((k) => qc.invalidateQueries({ queryKey: [k, documentId] }))),
  });

  const [teach, setTeach] = useState<Teach | null>(null);
  const [taught, setTaught] = useState<string | null>(null);
  const teachMutation = useMutation({
    // `label` rides along for the notice only: Cancel can clear `teach` while the request is in flight.
    mutationFn: ({ label: _label, ...req }: TeachRequest & { label: string }) => teachDocument(documentId, req),
    onSuccess: (d, { label, ...req }) => {
      qc.setQueryData(["document", documentId], d);
      const keys = [["document-history", documentId], ...(req.newLabel ? [["flow", d.summary.flowId], ["flows"]] : [])];
      for (const queryKey of keys) qc.invalidateQueries({ queryKey });
      const saved = d.senderLabel
        ? `Saved. Next time a document from ${d.senderLabel} comes in, we'll look there for ${label}.`
        : `Saved. We'll look there for ${label} in every document in this flow.`;
      const unpublished = req.newLabel && typeof qc.getQueryData<Flow>(["flow", d.summary.flowId])?.publishedVersion === "number";
      setTaught(unpublished ? `${saved} ${ADDED_TO_CHANGES}` : saved);
      setTeach(null);
    },
  });
  const cancelTeach = () => { setTeach(null); teachMutation.reset(); };
  useEffect(() => {
    if (!teach) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelTeach();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const summary = doc.data?.summary;
  const docFlowId = summary?.flowId ?? flowId;
  const flow = useQuery({ queryKey: ["flow", docFlowId], queryFn: () => getFlow(docFlowId), enabled });
  const status = summary && documentStatus(summary.status, summary.statusReason);
  const originalKind = summary ? sourceRenderFor(typeOf(summary.fileName)) : "opaque";
  const canTeach = !!status?.editable && !!flow.data?.fieldsConfirmed && originalKind !== "opaque";
  const nothingRead = !doc.data || doc.data.read.fields.length + doc.data.read.tables.length === 0;
  const editable = !!status?.editable;
  const marks = useMemo(() => (doc.data ? reviewMarks(doc.data, editable) : null), [doc.data, editable]);
  const history = <History documentId={documentId} version={summary?.flowVersion} />;

  const queue = useQuery({ ...reviewQueueQuery, enabled, staleTime: 60_000, refetchOnWindowFocus: true });
  const position = positionText(queuePosition(queue.data, documentId));
  const nextNow = pickNext(queue.data?.items, undefined, documentId);
  const saved = () => edits.flush().catch((e: unknown) => { throw refusalToken(e) === null ? UNSAVED : e; });
  const send = useMutation({
    mutationFn: async () => {
      const before = qc.getQueryData<DocumentPage>(reviewQueueQuery.queryKey)?.items;
      await saved();
      await sendDocument(documentId);
      return before;
    },
    onSuccess: async (before) => {
      await Promise.all([["documents"], ["document", documentId], ["deliveries", documentId], ["document-history", documentId]].map((queryKey) => qc.invalidateQueries({ queryKey })));
      const next = pickNext(before, qc.getQueryData<DocumentPage>(reviewQueueQuery.queryKey)?.items, documentId);
      router.replace(next ? documentHref(next) : documentsAddress("needs-you"));
    },
    onError: (e) => { if (e !== UNSAVED && refusalToken(e) !== null) qc.invalidateQueries({ queryKey: ["document", documentId] }); },
  });
  const skip = useMutation({
    mutationFn: async () => { await saved(); if (nextNow) router.replace(documentHref(nextNow)); },
  });
  // A second press before the first one re-renders does nothing.
  const pressed = useRef(false);
  const press = (m: typeof send | typeof skip) => {
    if (pressed.current) return;
    pressed.current = true;
    m.mutate(undefined, { onSettled: () => { pressed.current = false; } });
  };
  const busy = send.isPending || skip.isPending;
  const refused = send.error ?? skip.error;
  const failedCodes = doc.data?.checks.filter((c) => !c.passed).map((c) => c.code) ?? [];
  const tag = marks && marks.count > 0
    ? { text: marks.count === 1 ? "1 value to check" : `${marks.count} values to check`, tone: "amber" as const }
    : summary && rowNeed({ ...summary, checks: failedCodes, failedChecks: 0 });
  const ago = relativeTime(summary?.createdAt);
  const arrived = summary && [
    summary.source ? `, arrived by ${SOURCES.get(summary.source) ?? summary.source}` : "",
    summary.sourceRef ? ` from ${summary.sourceRef}` : "",
    ago ? ` ${ago}` : "",
  ].join("");

  return (
    <PageShell variant="wide">
      <PageHeader
        title={summary?.fileName ?? "Document"}
        sub={summary && (
          <span data-testid="review-sub">
            <Link href={`/flows/${summary.flowId}`} className="inline-flex min-h-[44px] items-center text-brand-blue sm:min-h-0">{summary.flowName}</Link>
            {arrived}
          </span>
        )}
        back={{ href: "/documents", label: "Documents" }}
        actions={status && tag && (
          <div data-testid="review-header-actions" className="flex flex-wrap items-center gap-2">
            <Pill tone={tag.tone}>{tag.text}</Pill>
            {position && <span className="text-[12.5px] text-ink-muted">{position}</span>}
            {status.editable ? (
              <>
                {nextNow && <Button variant="secondary" className="hidden md:inline-flex" disabled={busy} onClick={() => press(skip)}>Skip</Button>}
                <Button variant="send" className="hidden md:inline-flex" disabled={busy} loading={send.isPending} onClick={() => press(send)}>Send and open next</Button>
              </>
            ) : nextNow && <Link href={documentHref(nextNow)} className={`${buttonClass("send", "md")} inline-flex items-center`}>Review next</Link>}
          </div>
        )}
      />
      {refused && (
        <div ref={scrollTo} className="mb-4">
          <StatusNotice tone="error">{refused === UNSAVED ? UNSAVED_TEXT : documentRefusalMessage(refused)}</StatusNotice>
        </div>
      )}
      {!doc.data || !summary || !status ? (
        doc.isError ? <Failed error={doc.error} retry={() => doc.refetch()} /> : <Quiet>Loading document…</Quiet>
      ) : (
        <div className="grid gap-4">
          {doc.isError && <Failed error={doc.error} retry={() => doc.refetch()} />}
          <ReadProblem summary={summary} nothingRead={nothingRead} retry={retry} scansOn={flow.data?.scansOn} />
          <div className="grid items-start gap-4 pb-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)] lg:pb-0">
            <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
              <Card edge="blue" flush as="section" aria-labelledby="doc-original" className="flex h-full flex-col">
                <h2 id="doc-original" className="px-4 pb-2 pt-3.5 text-[13px] font-semibold text-ink">Original document</h2>
                {teach && <TeachBanner key={teachMutation.submittedAt} label={teach.label} render={originalKind} mutation={teachMutation} onCancel={cancelTeach} onSave={(value) => teachMutation.mutate({ ...teachMutation.variables, value })} />}
                <Original
                  documentId={documentId} fileName={summary.fileName} highlight={spot} marks={marks?.places}
                  onPick={teach && !teachMutation.isPending ? (pick) => teachMutation.mutate({ label: teach.label, ...(teach.key ? { key: teach.key } : { newLabel: teach.newLabel }), ...pick }) : undefined}
                />
              </Card>
            </div>
            <Card as="section" aria-labelledby="doc-read" className="min-w-0">
              <h2 id="doc-read" className="mb-3 text-[13px] font-semibold text-ink">What we read</h2>
              {taught && <div ref={scrollTo} className="mb-3"><StatusNotice tone="success">{taught}</StatusNotice></div>}
              {nothingRead || !marks ? (
                <div className="grid gap-3">
                  <Quiet>
                    {summary.status === "sending" ? "Sending…" : status.tone === "working" ? "Reading the document…" : "Nothing was read from this document."}
                  </Quiet>
                  {summary.statusReason !== "duplicate_file" && <Checks checks={doc.data.checks} />}
                  <div className="mt-1">{history}</div>
                </div>
              ) : (
                <ReadValuesPanel detail={doc.data} editable={status.editable} edits={edits} marks={marks} history={history} onLocate={setSpot} flow={flow.data}
                  onTeach={canTeach ? (t) => { setTeach(t); setTaught(null); teachMutation.reset(); } : undefined}
                />
              )}
            </Card>
            <div className="min-w-0"><DocumentOutputsPanel flowId={summary.flowId} document={doc.data} /></div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
