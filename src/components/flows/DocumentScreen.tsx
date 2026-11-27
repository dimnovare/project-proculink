"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { ActionBar } from "@/components/bridge/layout/ActionBar";
import { Card } from "@/components/bridge/layout/Card";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { SourceDocumentBody, scrollTo, type SourcePick } from "@/components/bridge/document/SourceDocumentBody";
import type { SourceSpot } from "@/components/bridge/document/SourceHighlight";
import { DOCX_MEDIA_TYPE, sourceRenderFor } from "@/lib/sourceDocument";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useApple, useShortcut } from "@/hooks/useShortcut";
import { ariaOf, keyWord } from "@/lib/shortcuts";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { inboxQuery, reviewQueueQuery } from "@/hooks/useDocumentEngine";
import { inInbox } from "@/lib/documentKind";
import { editKey, reviewMarks } from "@/lib/reviewMarks";
import { documentHref, pickNext, positionText, queuePosition } from "@/lib/reviewQueue";
import { documentsAddress } from "@/lib/documentTabs";
import { changeFileAddress, flowAddress } from "@/lib/flowSteps";
import { relativeTime } from "@/lib/relativeTime";
import { nextTabIndex } from "@/lib/tabKeys";
import { downloadDeliveryFile, fetchDocumentSource, getDocument, getFlow, getDocumentHistory, listDeliveries, listOutputs, retryDocumentRead, sendDocument, teachDocument } from "@/lib/api/documents";
import { filesOf, finishedLabel, flowWords } from "@/lib/flowWords";
import { saveBlob } from "@/lib/saveBlob";
import { formatDateTime } from "@/lib/format-date";
import { COPY, documentRefusalMessage, rateLimited, refusalToken } from "@/lib/documentRefusals";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { isPlanGateError } from "@/lib/planGate";
import { DOCUMENT_STATUSES, documentStatus } from "@/lib/documentStatusManifest";
import type { DocumentDetail, DocumentPage, Flow, KsefSummary, SourceLocation, TeachRequest } from "@/lib/api/documents";
import { useConfirm } from "@/components/ui/confirm";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { INPUT } from "./DestinationForm";
import { ADDED_TO_CHANGES, ReadValuesPanel, SAVE_WORDS, type Teach } from "./ReadValuesPanel";
import { Checks, Failed, Gone, Quiet, ReadProblem, Loading } from "./states";
import { ApiHttpError } from "@/lib/api/core";
import { History as HistoryIcon } from "lucide-react";

const notFound = (e: unknown) => e instanceof ApiHttpError && e.status === 404;
import { LogoLoader } from "@/components/bridge/LogoLoader";
import { rowNeed } from "./DocumentList";
import { onItsWay } from "./SelectionBar";
import { removable, useRemove } from "./RowActions";
import { WaitingList } from "./WaitingList";
import { Changed, InboxAnswers, REVIEW_NOTE_KEY, SortNotice, saveFirst, UNSAVED, UNSAVED_TEXT, useAnswers } from "./InboxAnswers";

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
  ["upload", "upload"], ["email", "email"], ["api", "the API"], ["assistant", "an AI assistant"], ["imap", "mailbox"], ["outlook", "mailbox"],
  ["sftp", "SFTP"], ["ftp", "FTP"], ["ftps", "FTPS"], ["s3", "S3"],
]);

/** A toggle "History"; open, the entries, the first one the flow version the document was read with when known. */
function History({ documentId, version }: { documentId: string; version: number | null | undefined }) {
  const enabled = useTenantQueriesEnabled();
  const [open, setOpen] = useState(false);
  const history = useQuery({ queryKey: ["document-history", documentId], queryFn: () => getDocumentHistory(documentId), enabled });
  return (
    <div className="grid justify-items-start gap-2 text-[12.5px] sm:justify-items-end">
      {/* A text link flush with the edge, not a ghost button whose padding floats it (A-04). */}
      <button type="button" aria-expanded={open} aria-controls="document-history" onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-brand-blue hover:underline sm:min-h-8">
        <HistoryIcon size={14} aria-hidden />History
      </button>
      <div id="document-history" hidden={!open} className="justify-self-stretch">
        {history.isError ? <p className="m-0 text-ink-muted">{documentRefusalMessage(history.error)}</p> : (
          <ul className="m-0 grid list-none gap-1 p-0 text-ink-muted">
            {typeof version === "number" && <li>Processed with version {version}</li>}
            {!history.data ? <li className="flex items-center gap-2"><LogoLoader />Loading…</li> :history.data.length === 0 ? <li>No changes yet.</li> : history.data.map((h, i) => (
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
  sheet: "Choose the cell that holds {label}.",
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

export function Original({ documentId, fileName, highlight, marks, onPick, spots, onSpot }: { documentId: string; fileName: string; highlight?: SourceLocation | null; marks?: readonly SourceLocation[]; onPick?(p: SourcePick): void; spots?: readonly SourceSpot[]; onSpot?(key: string): void }) {
  const isLg = useLgViewport();
  const enabled = useTenantQueriesEnabled();
  const source = useQuery({ queryKey: ["document-source", documentId], queryFn: () => fetchDocumentSource(documentId), enabled });
  const type = typeOf(fileName);
  if (source.isPending) return <Loading className="px-4 pb-4">Opening the document…</Loading>;
  if (source.isError || source.data.size === 0)
    return <p className="px-4 pb-4 text-[12.5px] text-ink-muted">The original isn&apos;t available right now.</p>;
  return <SourceDocumentBody cacheKey={documentId} document={{ blob: source.data, contentType: type, filename: fileName }} bounded={isLg} highlight={highlight} marks={marks} onPick={onPick} spots={spots} onSpot={onSpot} />;
}

/** Loading the document; after 15 seconds, the two ways on. */
function SlowLoading({ retry }: { retry(): void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { if (slow) return; const t = setTimeout(() => setSlow(true), 15_000); return () => clearTimeout(t); }, [slow]);
  if (!slow) return <Loading>Loading document…</Loading>;
  return (
    <StatusNotice tone="warning" action={
      <span className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { setSlow(false); retry(); }}>Try again</Button>
        <Link href="/documents" className={buttonClass("secondary", "sm")}>Go to Documents</Link>
      </span>
    }>Still loading. Try again, or go to Documents.</StatusNotice>
  );
}

type PaneId = "original" | "read" | "send";
const PANES: readonly { id: PaneId; title: string }[] = [
  { id: "original", title: "Original" }, { id: "read", title: "What we read" }, { id: "send", title: "What we'll send" },
];
const DOTS = { blue: "bg-brand-blue", navy: "bg-navy", green: "bg-brand-green" } as const;

/** One of the three panes. Used by 14.5's first run too (R24). Below lg it is the panel of its tab (R15). */
export function Pane({ id, title, dot, aside, hidden, sticky, children }: {
  id: PaneId; title: string; dot: keyof typeof DOTS; aside?: ReactNode; hidden?: boolean; children: ReactNode;
  /** Where the original sticks and how tall it is, from lg. Absent: it has its height and scrolls with the page. */
  sticky?: string;
}) {
  const isLg = useLgViewport();
  const original = id === "original";
  return (
    <Card
      flush as="section" id={`review-pane-${id}`} role={isLg ? undefined : "tabpanel"} tabIndex={isLg ? undefined : 0}
      aria-labelledby={isLg ? `review-heading-${id}` : `review-tab-${id}`}
      className={`min-w-0 ${hidden ? "max-lg:hidden" : ""} ${original ? `flex flex-col ${sticky ? `lg:!sticky ${sticky}` : "lg:h-[calc(100vh-150px)]"}` : ""}`}
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

/** How much of the row the original takes, in percent: dragged, or moved with the arrow keys, and remembered on this device. */
const SPLIT_KEY = "plk:review-split";
const SPLIT = { min: 25, max: 65, start: 42 };
const clampSplit = (n: number) => Math.min(SPLIT.max, Math.max(SPLIT.min, Math.round(n)));
function useSplit() {
  const [split, set] = useState(() => {
    try { const n = Number(localStorage.getItem(SPLIT_KEY)); return n ? clampSplit(n) : SPLIT.start; } catch { return SPLIT.start; }
  });
  const save = (n: number) => {
    const v = clampSplit(n);
    set(v);
    try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* remembered for this visit only */ }
  };
  return [split, save] as const;
}

/** The handle between the original and its values, from lg. Its parent is the row it divides. */
function SplitGrip({ split, onChange, className }: { split: number; onChange(n: number): void; className: string }) {
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const row = e.currentTarget.parentElement!.getBoundingClientRect();
    const original = e.currentTarget.previousElementSibling!.getBoundingClientRect();
    onChange(((e.clientX - original.left) / row.width) * 100);
  };
  return (
    <div
      role="separator" aria-orientation="vertical" aria-label="Width of the original" aria-valuenow={split} aria-valuemin={SPLIT.min} aria-valuemax={SPLIT.max} tabIndex={0}
      data-testid="review-split" className={`group hidden cursor-col-resize touch-none items-center justify-center rounded lg:flex ${className}`}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e); }}
      onDoubleClick={() => onChange(SPLIT.start)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : 0;
        if (step) { e.preventDefault(); onChange(split + step); }
      }}
    >
      <span aria-hidden className="h-11 w-1 rounded-full bg-border-strong group-hover:bg-brand-blue group-focus-visible:bg-brand-blue" />
    </div>
  );
}

/** Where the original and the handle stick under the page's one-row header, and how tall they are. */
export const UNDER_HEADER = "lg:top-[73px] lg:h-[calc(100dvh-152px)]";
/** A key held down never presses Send again and again. */
const noRepeat = (e: ReactKeyboardEvent) => { if (e.repeat) e.preventDefault(); };

/** Clicking a value's place on the original puts the cursor in that value. */
const goToValue = (key: string) => {
  const box = document.querySelector<HTMLInputElement>(`#review-pane-read input[data-value="${CSS.escape(key)}"]`);
  box?.focus();
  box?.select();
};

/** Every read value that has a place on the original, by the key its box carries. */
function spotsOf(read: DocumentDetail["read"]): SourceSpot[] {
  const placed = (l: SourceLocation | null | undefined): l is SourceLocation => !!(l?.box || l?.address);
  return [
    ...read.fields.flatMap((f) => (f.value?.trim() && placed(f.location) ? [{ key: editKey({ field: f.key }), label: f.label, location: f.location }] : [])),
    ...read.tables.flatMap((t) => t.rows.flatMap((row, r) => t.columns.flatMap((c) => {
      const l = row.cells[c.key]?.value?.trim() ? row.cells[c.key]?.location : null;
      return placed(l) ? [{ key: editKey({ table: t.key, row: r, column: c.key }), label: `${t.label} row ${r + 1} ${c.label}`, location: l }] : [];
    }))),
  ];
}


const WAY_ON = "inline-flex items-center text-[12.5px] font-semibold text-brand-blue";

/** A refused send in words, read by machine code only (never message text), with the way on when there is one. */
function sendRefusal(e: unknown, flowId: string, documentId: string): { text: string; wayOn: ReactNode } {
  const t = refusalToken(e);
  if (t === "processing_paused" || (t && (LIMIT_CODES.has(t) || isPlanGateError(t))))
    return { text: documentRefusalMessage(e), wayOn: <Link href="/settings?tab=billing" className={WAY_ON}>Open Plan &amp; billing</Link> };
  if (t === "no_outputs" || t === "no_output_matches")
    return { text: documentRefusalMessage(e), wayOn: <Link href={`/flows/${flowId}?tab=outputs`} className={WAY_ON}>Open the flow&apos;s files</Link> };
  if (rateLimited(e)) return { text: "Couldn't send just now. Try again in a moment.", wayOn: null };
  // The 422 names the file that couldn't be made (`outputId`); an older backend leaves it out and the flow's files open.
  // Missing values are fixed by entering them, so the file is offered only when none are missing.
  if (t === "output_invalid") {
    const b = e instanceof ApiHttpError ? (e.body as { outputId?: unknown; missing?: unknown[] } | null) : null;
    const id = typeof b?.outputId === "string" ? b.outputId : undefined;
    const href = id ? changeFileAddress(flowId, { output: id, document: documentId, from: `/flows/${flowId}/documents/${documentId}` }) : flowAddress(flowId, "send");
    return { text: documentRefusalMessage(e), wayOn: !b?.missing?.length && <Link href={href} className={buttonClass("secondary", "sm")}>Change the file</Link> };
  }
  return { text: documentRefusalMessage(e), wayOn: null };
}

/** A KSeF Production send waiting for a person (plan 33): the summaries and the confirmation, or null when the refusal is not one
 *  or its body is not the shape this build knows (then the refusal is said as words, and nothing is issued). */
function ksefAsk(e: unknown): { summaries: KsefSummary[]; confirm: string } | null {
  const b = e instanceof ApiHttpError && refusalToken(e) === "ksef_confirm" ? (e.body as { summaries?: unknown; confirm?: unknown }) : null;
  return b && Array.isArray(b.summaries) && b.summaries.length > 0 && typeof b.confirm === "string" && b.confirm
    ? { summaries: b.summaries as KsefSummary[], confirm: b.confirm } : null;
}

/** C5.7: the values a person checks against the document before it is issued. */
function KsefRows({ s }: { s: KsefSummary }) {
  const rows: [string, string][] = [
    ["Seller", `${s.sellerName}, NIP ${s.sellerNip}`],
    ["Buyer", [s.buyerName, s.buyerId].filter(Boolean).join(", ")],
    ["Invoice number", s.number],
    ["Issue date", s.issueDate],
    ...(s.saleDate ? [["Sale date", s.saleDate] as [string, string]] : []),
    ...s.rates.map((r): [string, string] => [`VAT ${r.rate}%`, `net ${r.net} / VAT ${r.vat} ${s.currency}`]),
    ["Total", `${s.gross} ${s.currency}`],
    ["Number of lines", String(s.lines)],
    ["Buyer is a local government unit or VAT group member", "No"],
  ];
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-medium text-ink">{v}</dd></div>)}
    </dl>
  );
}

/** The route's component: everything below is keyed by the document, so nothing carries over to the next one. */
export function DocumentScreen(p: { flowId: string; documentId: string }) {
  return <Review key={p.documentId} {...p} />;
}

function Review({ flowId, documentId }: { flowId: string; documentId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const isLg = useLgViewport();
  const apple = useApple();
  const [split, setSplit] = useSplit();
  // The value Enter came from when it moved the cursor to Send: typing on goes back into it.
  const walked = useRef<HTMLInputElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<PaneId>("read");
  const [spot, setSpot] = useState<SourceLocation | null>(null);
  const edits = useDocumentEdits(documentId);
  const doc = useQuery({
    queryKey: ["document", documentId], enabled,
    queryFn: async () => {
      const prev = qc.getQueryData<DocumentDetail>(["document", documentId]);
      const next = await getDocument(documentId);
      // A status change means the worker did something: the deliveries and history beside it, and the lists and counts, are stale.
      if (prev && prev.summary.status !== next.summary.status) {
        for (const k of ["deliveries", "document-history"]) qc.invalidateQueries({ queryKey: [k, documentId] });
        qc.invalidateQueries({ queryKey: ["documents"] });
      }
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
      // Below lg the notice is on "What we read": go back to it, and the notice scrolls into view as it mounts.
      setTab("read");
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
  // P15: a flow that loads means the document is with a person's flow, and the inbox is not asked. Any failed flow request
  // asks it (the inbox has no flow routes). Unknown (loading, or the inbox pending or failed) draws neither the answers nor Send.
  const flow = useQuery({ queryKey: ["flow", docFlowId], queryFn: () => getFlow(docFlowId), enabled });
  const flowFailed = flow.isError && !flow.data;
  const inbox = useQuery({ ...inboxQuery, enabled: enabled && flowFailed });
  const there = summary && flowFailed ? inInbox(summary, inbox.data) : undefined;
  // Not in the inbox, and its flow route says there is no such flow: the flow is gone, and nothing is sent from here.
  const gone = there === false && refusalToken(flow.error) === "flow_not_found";
  const here = !summary || gone ? undefined : flow.data ? false : there;
  const status = summary && documentStatus(summary.status, summary.statusReason);
  // Only a document sorted into a flow can be sent or skipped; an inbox document is answered instead (Review Focus 1).
  // Our sample is never sent (the server refuses it too). The detail says so; an older API does not, and then a list row the screen already holds does.
  const isSample = !!doc.data?.isSample || qc.getQueriesData<Partial<DocumentPage>>({ queryKey: ["documents"] })
    .some(([, p]) => p?.items?.some?.((r) => r.id === documentId && r.isSample));
  const sends = here === false && !!status?.editable && !isSample;
  const answered = here === true && !!summary && ((!!status?.editable && summary.statusReason !== "duplicate_file") || (summary.status === "sent" && summary.statusReason === "downloaded"));
  // The answers live here, not in their panel: a refusal outlives the panel, and Send, Skip and Review next wait on them.
  const a = useAnswers(summary, { enabled: enabled && (answered || (sends && summary?.statusReason === "check_sort")), flush: edits.flush });
  const answering = a.pending === "set-up" || a.pending === "move";
  const originalKind = summary ? sourceRenderFor(typeOf(summary.fileName)) : "opaque";
  const canTeach = !!status?.editable && !!flow.data?.fieldsConfirmed && originalKind !== "opaque";
  const nothingRead = !doc.data || doc.data.read.fields.length + doc.data.read.tables.length === 0;
  const editable = !!status?.editable;
  const marks = useMemo(() => (doc.data ? reviewMarks(doc.data, editable) : null), [doc.data, editable]);
  const spots = useMemo(() => (doc.data ? spotsOf(doc.data.read) : undefined), [doc.data]);
  const history = <History documentId={documentId} version={summary?.flowVersion} />;

  const queue = useQuery({ ...reviewQueueQuery, enabled, staleTime: 60_000, refetchOnWindowFocus: true });
  const position = positionText(queuePosition(queue.data, documentId));
  // Listed beside the review when there is anything to choose: more than this document itself.
  const others = !!queue.data && queue.data.items.some((d) => d.id !== documentId);
  // Once shown it keeps its column for this visit: the page must not jump sideways when the queue changes.
  const [listed, setListed] = useState(false);
  if (others && !listed) setListed(true);
  const waiting = others || listed;
  const nextNow = pickNext(queue.data?.items, undefined, documentId);
  const saved = () => saveFirst(edits.flush);
  // Drawn empty first and filled after, so it is spoken; it takes no focus.
  const [sentNote, setSentNote] = useState<string | null>(null);
  useEffect(() => {
    const n = qc.getQueryData<string>(REVIEW_NOTE_KEY);
    if (n) { qc.removeQueries({ queryKey: REVIEW_NOTE_KEY }); setSentNote(n); }
  }, [qc]);
  const confirm = useConfirm();
  const send = useMutation({
    mutationFn: async (ksefConfirm?: string) => {
      const before = qc.getQueryData<DocumentPage>(reviewQueueQuery.queryKey)?.items;
      await saved();
      return { before, went: await (ksefConfirm ? sendDocument(documentId, ksefConfirm) : sendDocument(documentId)) };
    },
    onSuccess: async ({ before, went }) => {
      // Only made files to download, sent nowhere: stay, and the screen shows the file and the way on.
      if (went.length > 0 && went.every((d) => d.status === "stored")) {
        pressed.current = false;
        // From the answer first, so the screen turns to File ready even when a refetch fails.
        qc.setQueryData(["deliveries", documentId], went);
        qc.setQueryData<DocumentDetail>(["document", documentId], (d) => d && { ...d, summary: { ...d.summary, status: "sent", statusReason: null } });
        await Promise.all([["document", documentId], ["deliveries", documentId], ["documents"]].map((queryKey) => qc.invalidateQueries({ queryKey })));
        return;
      }
      setLeaving(true);
      // The document itself is not refetched: the screen is leaving, and drawing it as sent first is what R4 rules out.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["document", documentId], refetchType: "none" }),
        ...[["documents"], ["deliveries", documentId], ["document-history", documentId]].map((queryKey) => qc.invalidateQueries({ queryKey })),
      ]);
      // R2: a refresh that failed tells us nothing, so the person goes to Needs you rather than to a guess.
      const refreshFailed = qc.getQueryState(reviewQueueQuery.queryKey)?.status === "error";
      const next = refreshFailed ? null : pickNext(before, qc.getQueryData<DocumentPage>(reviewQueueQuery.queryKey)?.items, documentId);
      if (next && summary) qc.setQueryData(REVIEW_NOTE_KEY, onItsWay(summary.fileName));
      router.replace(next ? documentHref(next) : documentsAddress("needs-you"));
    },
    onError: (e) => {
      // A KSeF Production send: a person checks what is issued, and only a yes sends it, with that confirmation.
      const ask = ksefAsk(e);
      if (ask) {
        void confirm({
          title: "Issue this invoice in KSeF?",
          description: `You are issuing this invoice in the National e-Invoice System (KSeF) in the name of ${ask.summaries[0].sellerName}, NIP ${ask.summaries[0].sellerNip}. Once KSeF accepts it, it is an issued invoice: it can't be withdrawn, only corrected with a correcting invoice. Check these values against your document:`,
          details: <div className="grid gap-3">{ask.summaries.map((s, i) => <KsefRows key={i} s={s} />)}</div>,
          confirmLabel: "Issue in KSeF",
          cancelLabel: "Not now",
        }).then((yes) => {
          if (!yes || pressed.current) return;
          pressed.current = true;
          send.mutate(ask.confirm, { onError: () => { pressed.current = false; } });
        });
        return;
      }
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
  const press = (m: { mutate(v: undefined, o: { onError(): void }): void }) => {
    if (pressed.current) return;
    pressed.current = true;
    send.reset();
    skip.reset();   // the notice says the newest press, never an older one
    a.clear();
    m.mutate(undefined, { onError: () => { pressed.current = false; } });
  };
  const busy = send.isPending || skip.isPending || leaving || answering;
  const words = flowWords(flow.data?.downloadOnly);
  // The same request as the "What we'll send" pane. A flow that makes no file yet is set up first: the server would refuse the send.
  const outputs = useQuery({ queryKey: ["outputs", docFlowId, "published"], queryFn: () => listOutputs(docFlowId, { published: true }), enabled: enabled && here === false });
  const setUp = sends && outputs.data?.length === 0;
  const sendFailed = summary?.status === "send_failed";
  const primary = sendFailed ? "Send again" : words.primary;
  // Green only when the press sends the document out; "Make the file" is navy.
  const primaryVariant = /^Send\b/.test(primary) ? "send" : "primary";
  const setUpLink = (cls: string) => <Link href={`/flows/${docFlowId}?tab=outputs`} className={`${buttonClass("primary", "md")} ${cls}`}>Set up the file</Link>;
  // The document's own queries are dropped once the screen has left, so it never draws "gone" on the way out.
  const removed = useRef(false);
  useEffect(() => () => {
    if (removed.current) for (const key of ["document", "deliveries"]) qc.removeQueries({ queryKey: [key, documentId] });
  }, [qc, documentId]);
  const remove = useRemove(() => { removed.current = true; setLeaving(true); router.replace(nextNow ? documentHref(nextNow) : "/documents"); }, true);
  const canRemove = !!doc.data?.canRemove && !!summary && removable(summary.status);
  // From md it sits first in the header, 24px clear of Skip and Send; a phone has those in the bar below.
  const removeButton = canRemove && (
    <Button variant="secondary" className="!text-danger-text md:order-first md:mr-4" disabled={busy} loading={remove.pendingId === documentId} onClick={() => void remove.ask({ ...summary, countsThisMonth: doc.data?.countsThisMonth })}>Remove</Button>
  );
  // A sent document whose files were all made to download: File ready, and Download is the way on.
  const deliveries = useQuery({ queryKey: ["deliveries", documentId], queryFn: () => listDeliveries(documentId), enabled: enabled && here === false && (summary?.status === "sent" || sendFailed) });
  const files = filesOf(deliveries.data);
  // Once sent, the pane says what went, in the past: only when something was delivered (`sent` also covers files only stored).
  const sendPane = summary?.status === "sent" && !flow.data?.downloadOnly && !!deliveries.data?.some((d) => d.status === "delivered") ? "What we sent" : words.pane;
  // Why sending stopped, said above the panes beside Send again: the deliveries that also say it are far down the page.
  const unsent = (sendFailed && deliveries.data?.filter((d) => d.status === "dead_letter")) || [];
  const made = here === false && summary?.status === "sent" && files.length > 0 && files.every((f) => !f.delivered);
  const download = useMutation({ mutationFn: async () => saveBlob(await downloadDeliveryFile(documentId, files[0].deliveryId), files[0].fileName) });
  const madeActions = (cls: string) => made && (
    <>
      {nextNow && <Link replace href={documentHref(nextNow)} className={`${buttonClass("secondary", "md")} ${cls}`}>Open next</Link>}
      {files.length === 1 && <Button variant="primary" className={cls} loading={download.isPending} onClick={() => download.mutate()}>{`Download ${files[0].fileName}`}</Button>}
    </>
  );
  useShortcut("send-and-next", () => press(send), sends && !setUp && !outputs.isLoading && !busy);
  const canSkip = sends && !!nextNow;
  // Review next is the way on wherever nothing is sent from here; beside the inbox answers it is never the filled button.
  const next = here !== undefined && !sends && nextNow;
  // While an answer runs it is a disabled button: a link would still go on Enter.
  const reviewNext = (cls: string) => next && (answering ? <Button disabled className={cls}>Review next</Button>
    : <Link replace href={documentHref(next)} className={`${buttonClass(here || summary?.status === "read_failed" ? "secondary" : "primary", "md")} ${cls}`}>Review next</Link>);
  const located = !!marks?.places.length || !!doc.data?.read.fields.some((f) => f.location?.box || f.location?.address)
    || !!doc.data?.read.tables.some((t) => t.rows.some((r) => Object.values(r.cells).some((c) => c.location?.box || c.location?.address)));
  // A KSeF confirmation is asked in its dialog, not said as a refusal; a file the document is now held for is said once, by its hold.
  const sendError = ksefAsk(send.error) || (refusalToken(send.error) === "output_invalid" && summary?.statusReason === "output_invalid") ? null : send.error;
  const refused = sendError ?? skip.error ?? download.error;
  const failedCodes = doc.data?.checks.filter((c) => !c.passed).map((c) => c.code) ?? [];
  // A sent document says what its own files did once they are known; until then only that it is finished, never "Sent".
  const finished = summary?.status === "sent" && status?.label === DOCUMENT_STATUSES.sent.label;
  const tag = finished ? { text: deliveries.data && files.length ? finishedLabel(files) : "Finished", tone: "green" as const }
    : marks && marks.count > 0
    ? { text: marks.count === 1 ? "1 value to check" : `${marks.count} values to check`, tone: "amber" as const }
    : summary && rowNeed({ ...summary, inInbox: here, checks: failedCodes, failedChecks: 0, downloadOnly: flow.data?.downloadOnly });
  const ago = relativeTime(summary?.createdAt);
  const by = summary?.source ? `by ${SOURCES.get(summary.source) ?? summary.source}` : "";
  const when = `${summary?.sourceRef ? ` from ${summary.sourceRef}` : ""}${ago ? ` ${ago}` : ""}`;
  const panes = here === false ? PANES.map((p) => (p.id === "send" ? { ...p, title: sendPane } : p)) : PANES.filter((p) => p.id !== "send");

  return (
    <PageShell variant="full">
      <PageHeader
        compact
        title={summary?.fileName ?? "Document"}
        sub={summary && here !== undefined && (
          <span data-testid="review-sub">
            {here ? `Added${by && ` ${by}`}${when}` : (
              <>
                <Link href={`/flows/${summary.flowId}`} className="inline-flex min-h-[44px] items-center text-brand-blue sm:min-h-0">{summary.flowName}</Link>
                {by && `, arrived ${by}`}{when}
              </>
            )}
          </span>
        )}
        back={{ href: "/documents", label: "Documents" }}
        actions={status && tag && (
          <div data-testid="review-header-actions" className="flex flex-wrap items-center gap-2">
            {/* A failed read says so in its own notice below. */}
            {/* Below 1440 the row is shared with the name: the pill shortens and the position waits, so the name stays readable (V-01). */}
            {summary?.status !== "read_failed" && <Pill tone={tag.tone} title={tag.text} className="max-[1439px]:max-w-[8rem]">{tag.text}</Pill>}
            {position && <span className="text-[12.5px] text-ink-muted max-[1439px]:lg:hidden">{position}</span>}
            {removeButton}
            {made ? madeActions("hidden md:inline-flex") : sends ? (
              <>
                {canSkip && <Button variant="secondary" className="hidden md:inline-flex" disabled={busy} onClick={() => press(skip)}>Skip</Button>}
                {setUp ? setUpLink("hidden md:inline-flex") : <Button id="review-send" variant={primaryVariant} className="hidden md:inline-flex" disabled={busy || outputs.isLoading} loading={send.isPending || leaving} onClick={() => press(send)} aria-keyshortcuts={ariaOf("send-and-next")}
                  // After Enter brought the cursor here, only Enter sends: a space or a letter is typing, and goes back into the value.
                  onKeyDown={(e) => { noRepeat(e); if (walked.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) walked.current.focus(); }}
                  onBlur={() => { walked.current = null; }}
                >
                  {primary}
                  <kbd aria-hidden className="hidden h-[22px] items-center rounded bg-brand-green-deep px-1.5 font-sans text-[12.5px] font-semibold xl:inline-flex">{keyWord("Mod", apple)} Enter</kbd>
                </Button>}
              </>
            ) : reviewNext("hidden items-center md:inline-flex")}
          </div>
        )}
      />
      {!!remove.error && <div className="mb-4"><StatusNotice tone="error">{documentRefusalMessage(remove.error)}</StatusNotice></div>}
      <div aria-live="polite" className="mb-4 empty:hidden">{sentNote && <StatusNotice tone="success">{sentNote}</StatusNotice>}</div>
      {refused && (
        <div ref={scrollTo} data-testid="review-refusal" className="mb-4">
          {refused === UNSAVED ? (
            <StatusNotice tone="error" action={!isLg && tab !== "read" && <Button size="sm" variant="secondary" onClick={() => setTab("read")}>Show what we read</Button>}>{UNSAVED_TEXT}</StatusNotice>
          ) : (() => {
            const r = sendRefusal(refused, summary?.flowId ?? flowId, documentId);
            return <StatusNotice tone="error" action={r.wayOn}>{r.text}</StatusNotice>;
          })()}
        </div>
      )}
      {!doc.data || !summary || !status ? (
        doc.isError ? (notFound(doc.error) ? <Gone text="This document isn't here any more. It may have been removed." back="documents" />
          : <Failed error={doc.error} retry={() => doc.refetch()} />) : <SlowLoading retry={() => doc.refetch()} />
      ) : (
        <div className="grid gap-4">
          {doc.isError && <Failed error={doc.error} retry={() => doc.refetch()} />}
          {inbox.isError && there === undefined && (
            <StatusNotice tone="error" action={<Button size="sm" variant="secondary" loading={inbox.isFetching} onClick={() => { flow.refetch(); inbox.refetch(); }}>Try again</Button>}>
              We couldn&apos;t check where this document is.
            </StatusNotice>
          )}
          {gone && <Gone text={COPY.flow_not_found} back="documents" />}
          {flowFailed && here === false && <Failed error={flow.error} retry={() => flow.refetch()} lead="We couldn't load this document's flow." />}
          <Changed a={a} />
          {sends && summary.statusReason === "check_sort" && <SortNotice detail={doc.data} a={a} />}
          {/* Announced when it changes (after a move: reading, or the hold). Drawn once the place is known: its links assume one. */}
          <div aria-live="polite" className="empty:hidden">
            {here !== undefined && (
              <ReadProblem
                summary={summary} retry={retry} scansOn={(here ? inbox.data : flow.data)?.scansOn}
                uploadHref={here ? "/upload" : `/flows/${summary.flowId}?tab=documents`} held={doc.data.checks.find((c) => !c.passed && c.code === "duplicate")?.message}
              />
            )}
          </div>
          <div className={`grid items-start gap-4 lg:gap-x-1 lg:grid-cols-[minmax(280px,var(--split))_10px_minmax(0,1fr)] ${waiting ? "min-[1700px]:grid-cols-[264px_minmax(280px,var(--split))_10px_minmax(360px,1fr)]" : ""}`} style={{ "--split": `${split}%` } as CSSProperties}>
            {/* Inside the grid so that below lg the inbox answers can sit above the tabs (order-first). */}
            {unsent.length > 0 && (
              <div className="lg:col-span-full"><StatusNotice tone="error">
                {unsent.map((d) => <span key={d.id} className="block">{`${d.outputName}: ${d.lastError ?? "it couldn't be delivered."}`}</span>)}
              </StatusNotice></div>
            )}
            <PaneTabs panes={panes} active={tab} onSelect={(id) => setTab(id as PaneId)} />
            {waiting && queue.data && (
              <div className={`hidden min-w-0 min-[1700px]:mr-3 min-[1700px]:block min-[1700px]:sticky ${UNDER_HEADER}`}>
                <WaitingList queue={queue.data} currentId={documentId} off={answering} />
              </div>
            )}
            <Pane id="original" title="Original" dot="blue" hidden={tab !== "original"} sticky={UNDER_HEADER}>
              {located && <p className="m-0 hidden px-4 pb-2 text-[12.5px] text-ink-muted lg:block">{editable ? "Click a value on either side to find it on the other." : "Click a value on the right to see where it came from."}</p>}
              {teach && <TeachBanner key={teachMutation.submittedAt} label={teach.label} render={originalKind} mutation={teachMutation} onCancel={cancelTeach} onSave={(value) => teachMutation.mutate({ ...teachMutation.variables, value })} />}
              {(isLg || tab === "original") && (
                <Original
                  documentId={documentId} fileName={summary.fileName} highlight={spot} marks={marks?.places}
                  spots={isLg && editable && !teach ? spots : undefined} onSpot={goToValue}
                  onPick={teach && !teachMutation.isPending ? (pick) => teachMutation.mutate({ label: teach.label, ...(teach.key ? { key: teach.key } : { newLabel: teach.newLabel }), ...pick }) : undefined}
                />
              )}
            </Pane>
            <SplitGrip split={split} onChange={setSplit} className={`lg:sticky ${UNDER_HEADER}`} />
            {/* From lg the values sit above the outputs, so both get the width a table needs. */}
            <div className="grid min-w-0 gap-4 max-lg:contents">
            {answered && <InboxAnswers detail={doc.data} a={a} />}
            <Pane
              id="read" title="What we read" dot="navy" hidden={tab !== "read"}
              aside={editable && <span data-testid="save-state" aria-live="polite" className="text-[12.5px] text-ink-muted">{SAVE_WORDS[edits.state]}</span>}
            >
              {taught && <div ref={scrollTo} className="mb-3"><StatusNotice tone="success">{taught}</StatusNotice></div>}
              {nothingRead || !marks ? (
                <div className="grid gap-3">
                  {summary.status === "sending" ? <Loading>Sending…</Loading>
                    : status.tone === "working" ? <Loading>Reading the document…</Loading>
                    : <Quiet>Nothing was read from this document.</Quiet>}
                  {summary.statusReason !== "duplicate_file" && <Checks checks={doc.data.checks} inbox={here !== false} flowId={summary.flowId} duplicateOf={doc.data.duplicateOf} downloadOnly={flow.data?.downloadOnly} />}
                  <div className="mt-1">{history}</div>
                </div>
              ) : (
                <ReadValuesPanel detail={doc.data} editable={status.editable} edits={edits} marks={marks} history={history} onLocate={setSpot} flow={flow.data} inbox={here !== false}
                  walk={isLg && sends} onChecked={(from) => { document.getElementById("review-send")?.focus(); walked.current = from; }}
                  onTeach={canTeach ? (t) => { setTeach(t); setTaught(null); setTab("original"); teachMutation.reset(); } : undefined}
                />
              )}
            </Pane>
            {here === false && (
              <Pane id="send" title={sendPane} dot="green" hidden={tab !== "send"}>
                <DocumentOutputsPanel flowId={summary.flowId} document={doc.data} />
              </Pane>
            )}
            </div>
          </div>
        </div>
      )}
      {/* Made with several files and nothing next: no bar, never an empty one. */}
      {(sends || next || (made && files.length === 1)) && (
        <ActionBar>
          {made ? madeActions("") : sends ? (
            <>
              {canSkip && <Button variant="secondary" className="!flex-none" disabled={busy} onClick={() => press(skip)}>Skip</Button>}
              {setUp ? setUpLink("inline-flex items-center") : <Button variant={primaryVariant} disabled={busy || outputs.isLoading} loading={send.isPending || leaving} onClick={() => press(send)} aria-keyshortcuts={ariaOf("send-and-next")}>{primary}</Button>}
            </>
          ) : reviewNext("inline-flex items-center")}
        </ActionBar>
      )}
    </PageShell>
  );
}
