"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { ActionBar } from "@/components/bridge/layout/ActionBar";
import { Card } from "@/components/bridge/layout/Card";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { SourceDocumentBody, scrollTo, type SourcePick } from "@/components/bridge/document/SourceDocumentBody";
import { DOCX_MEDIA_TYPE, sourceRenderFor } from "@/lib/sourceDocument";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useShortcut } from "@/hooks/useShortcut";
import { ariaOf } from "@/lib/shortcuts";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { reviewQueueQuery } from "@/hooks/useDocumentEngine";
import { reviewMarks } from "@/lib/reviewMarks";
import { documentHref, pickNext, positionText, queuePosition } from "@/lib/reviewQueue";
import { documentsAddress } from "@/lib/documentTabs";
import { relativeTime } from "@/lib/relativeTime";
import { nextTabIndex } from "@/lib/tabKeys";
import { fetchDocumentSource, getDocument, getFlow, getDocumentHistory, retryDocumentRead, sendDocument, teachDocument } from "@/lib/api/documents";
import { formatDateTime } from "@/lib/format-date";
import { COPY, documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { isPlanGateError } from "@/lib/planGate";
import { ApiHttpError } from "@/lib/api/core";
import { documentStatus } from "@/lib/documentStatusManifest";
import type { DocumentDetail, DocumentPage, Flow, SourceLocation, TeachRequest } from "@/lib/api/documents";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { INPUT } from "./DestinationForm";
import { ADDED_TO_CHANGES, ReadValuesPanel, SAVE_WORDS, type Teach } from "./ReadValuesPanel";
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

type PaneId = "original" | "read" | "send";
const PANES: readonly { id: PaneId; title: string }[] = [
  { id: "original", title: "Original" }, { id: "read", title: "What we read" }, { id: "send", title: "What we'll send" },
];
const DOTS = { blue: "bg-brand-blue", navy: "bg-navy", green: "bg-brand-green" } as const;

/** One of the three panes. Used by 14.5's first run too (R24). Below lg it is the panel of its tab (R15). */
export function Pane({ id, title, dot, aside, hidden, children }: {
  id: PaneId; title: string; dot: keyof typeof DOTS; aside?: ReactNode; hidden?: boolean; children: ReactNode;
}) {
  const isLg = useLgViewport();
  const original = id === "original";
  return (
    <Card
      flush as="section" id={`review-pane-${id}`} role={isLg ? undefined : "tabpanel"} tabIndex={isLg ? undefined : 0}
      aria-labelledby={isLg ? `review-heading-${id}` : `review-tab-${id}`}
      className={`min-w-0 ${hidden ? "max-lg:hidden" : ""} ${original ? "flex flex-col lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 id={`review-heading-${id}`} className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink">
          <span aria-hidden className={`h-2 w-2 rounded-full ${DOTS[dot]}`} />
          {title}
        </h2>
        {aside}
      </div>
      {original ? children : <div className="px-4 pb-4">{children}</div>}
    </Card>
  );
}

/** The pane tabs below lg (R15): one pane at a time, arrow keys move between them. Used by 14.5's check step too. */
export function PaneTabs({ panes, active, onSelect }: {
  panes: readonly { id: PaneId; title: string }[]; active: string; onSelect(id: string): void;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label="Parts of this document" className="flex gap-1 border-b border-border lg:hidden">
      {panes.map((pane, i) => (
        <button
          key={pane.id} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`review-tab-${pane.id}`}
          aria-controls={`review-pane-${pane.id}`} aria-selected={active === pane.id} tabIndex={active === pane.id ? 0 : -1}
          className={`-mb-px min-h-[44px] border-b-2 px-3 text-[13px] font-semibold ${active === pane.id ? "border-navy text-ink" : "border-transparent text-ink-muted"}`}
          onClick={() => onSelect(pane.id)}
          onKeyDown={(e) => {
            const to = nextTabIndex(e.key, i, panes.length);
            if (to === undefined) return;
            e.preventDefault();
            onSelect(panes[to].id);
            tabRefs.current[to]?.focus();
          }}
        >{pane.title}</button>
      ))}
    </div>
  );
}

/** A change typed on this document could not be saved, so nothing was sent. */
const UNSAVED = new Error("unsaved");
const UNSAVED_TEXT = "Nothing was sent: your last change isn't saved yet.";

const WAY_ON = "inline-flex items-center text-[12.5px] font-semibold text-brand-blue";

/** A refused send in words, read by machine code only (never message text), with the way on when there is one. */
function sendRefusal(e: unknown, flowId: string): { text: string; wayOn: ReactNode } {
  const t = refusalToken(e);
  if (t === "processing_paused" || (t && (LIMIT_CODES.has(t) || isPlanGateError(t))))
    return { text: documentRefusalMessage(e), wayOn: <Link href="/settings?tab=billing" className={WAY_ON}>Open Plan &amp; billing</Link> };
  if (t === "no_outputs" || t === "no_output_matches")
    return { text: documentRefusalMessage(e), wayOn: <Link href={`/flows/${flowId}?tab=outputs`} className={WAY_ON}>Open the flow&apos;s outputs</Link> };
  if (rateLimited(e)) return { text: "Couldn't send just now. Try again in a moment.", wayOn: null };
  return { text: documentRefusalMessage(e), wayOn: null };
}
/** The global rate limiter's 429: no code, a sentence. Every coded 429 is in `COPY` or is a plan gate. */
const rateLimited = (e: unknown) => {
  const t = refusalToken(e);
  return e instanceof ApiHttpError && e.status === 429 && !(t && (Object.hasOwn(COPY, t) || isPlanGateError(t)));
};

/** The route's component: everything below is keyed by the document, so nothing carries over to the next one. */
export function DocumentScreen(p: { flowId: string; documentId: string }) {
  return <Review key={p.documentId} {...p} />;
}

function Review({ flowId, documentId }: { flowId: string; documentId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const isLg = useLgViewport();
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<PaneId>("read");
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
      setLeaving(true);
      // The document itself is not refetched: the screen is leaving, and drawing it as sent first is what R4 rules out.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["document", documentId], refetchType: "none" }),
        ...[["documents"], ["deliveries", documentId], ["document-history", documentId]].map((queryKey) => qc.invalidateQueries({ queryKey })),
      ]);
      // R2: a refresh that failed tells us nothing, so the person goes to Needs you rather than to a guess.
      const refreshFailed = qc.getQueryState(reviewQueueQuery.queryKey)?.status === "error";
      const next = refreshFailed ? null : pickNext(before, qc.getQueryData<DocumentPage>(reviewQueueQuery.queryKey)?.items, documentId);
      router.replace(next ? documentHref(next) : documentsAddress("needs-you"));
    },
    onError: (e) => {
      // A refusal may mean the document moved under us: it and the lists are refreshed. A rate limit leaves it ready.
      if (e === UNSAVED || refusalToken(e) === null || rateLimited(e)) return;
      for (const queryKey of [["document", documentId], ["documents"]]) qc.invalidateQueries({ queryKey });
    },
  });
  const skip = useMutation({
    mutationFn: async () => { await saved(); if (nextNow) { setLeaving(true); router.replace(documentHref(nextNow)); } },
  });
  // A second press before the first one re-renders does nothing; after a success the screen is leaving, so none does.
  const pressed = useRef(false);
  const press = (m: typeof send | typeof skip) => {
    if (pressed.current) return;
    pressed.current = true;
    send.reset();
    skip.reset();   // the notice says the newest press, never an older one
    m.mutate(undefined, { onError: () => { pressed.current = false; } });
  };
  const busy = send.isPending || skip.isPending || leaving;
  useShortcut("send-and-next", () => press(send), !!status?.editable && !busy);
  const canSkip = !!status?.editable && !!nextNow;
  const located = !!marks?.places.length || !!doc.data?.read.fields.some((f) => f.location?.box || f.location?.address)
    || !!doc.data?.read.tables.some((t) => t.rows.some((r) => Object.values(r.cells).some((c) => c.location?.box || c.location?.address)));
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
    <PageShell variant="full">
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
                {canSkip && <Button variant="secondary" className="hidden md:inline-flex" disabled={busy} onClick={() => press(skip)}>Skip</Button>}
                <Button variant="send" className="hidden md:inline-flex" disabled={busy} loading={send.isPending || leaving} onClick={() => press(send)} aria-keyshortcuts={ariaOf("send-and-next")}>Send and open next</Button>
              </>
            ) : nextNow && <Link replace href={documentHref(nextNow)} className={`${buttonClass("send", "md")} hidden items-center md:inline-flex`}>Review next</Link>}
          </div>
        )}
      />
      {refused && (
        <div ref={scrollTo} data-testid="review-refusal" className="mb-4">
          {refused === UNSAVED ? (
            <StatusNotice tone="error" action={!isLg && tab !== "read" && <Button size="sm" variant="secondary" onClick={() => setTab("read")}>Show what we read</Button>}>{UNSAVED_TEXT}</StatusNotice>
          ) : (() => {
            const r = sendRefusal(refused, summary?.flowId ?? flowId);
            return <StatusNotice tone="error" action={r.wayOn}>{r.text}</StatusNotice>;
          })()}
        </div>
      )}
      {!doc.data || !summary || !status ? (
        doc.isError ? <Failed error={doc.error} retry={() => doc.refetch()} /> : <Quiet>Loading document…</Quiet>
      ) : (
        <div className="grid gap-4">
          {doc.isError && <Failed error={doc.error} retry={() => doc.refetch()} />}
          <ReadProblem summary={summary} nothingRead={nothingRead} retry={retry} scansOn={flow.data?.scansOn} uploadHref={`/flows/${summary.flowId}?tab=documents`} />
          <PaneTabs panes={PANES} active={tab} onSelect={(id) => setTab(id as PaneId)} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Pane id="original" title="Original" dot="blue" hidden={tab !== "original"}>
              {located && <p className="m-0 hidden px-4 pb-2 text-[12.5px] text-ink-muted lg:block">Click a value on the right to see where it came from.</p>}
              {teach && <TeachBanner key={teachMutation.submittedAt} label={teach.label} render={originalKind} mutation={teachMutation} onCancel={cancelTeach} onSave={(value) => teachMutation.mutate({ ...teachMutation.variables, value })} />}
              {(isLg || tab === "original") && (
                <Original
                  documentId={documentId} fileName={summary.fileName} highlight={spot} marks={marks?.places}
                  onPick={teach && !teachMutation.isPending ? (pick) => teachMutation.mutate({ label: teach.label, ...(teach.key ? { key: teach.key } : { newLabel: teach.newLabel }), ...pick }) : undefined}
                />
              )}
            </Pane>
            {/* From lg the values sit above the outputs, so both get the width a table needs. */}
            <div className="grid min-w-0 gap-4 max-lg:contents">
            <Pane
              id="read" title="What we read" dot="navy" hidden={tab !== "read"}
              aside={editable && <span data-testid="save-state" aria-live="polite" className="text-[12.5px] text-ink-muted">{SAVE_WORDS[edits.state]}</span>}
            >
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
                  onTeach={canTeach ? (t) => { setTeach(t); setTaught(null); setTab("original"); teachMutation.reset(); } : undefined}
                />
              )}
            </Pane>
            <Pane id="send" title="What we'll send" dot="green" hidden={tab !== "send"}>
              <DocumentOutputsPanel flowId={summary.flowId} document={doc.data} />
            </Pane>
            </div>
          </div>
        </div>
      )}
      {status && (status.editable || nextNow) && (
        <ActionBar>
          {status.editable ? (
            <>
              {canSkip && <Button variant="secondary" className="!flex-none" disabled={busy} onClick={() => press(skip)}>Skip</Button>}
              <Button variant="send" disabled={busy} loading={send.isPending || leaving} onClick={() => press(send)} aria-keyshortcuts={ariaOf("send-and-next")}>Send and open next</Button>
            </>
          ) : nextNow && <Link replace href={documentHref(nextNow)} className={`${buttonClass("send", "md")} inline-flex items-center`}>Review next</Link>}
        </ActionBar>
      )}
    </PageShell>
  );
}
