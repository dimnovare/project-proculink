"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getBillingStatus } from "@/lib/api-client";
import { ApiHttpError } from "@/lib/api/core";
import { listDocumentPage, type DocumentRow, type DocumentSummary, type Flow } from "@/lib/api/documents";
import { COPY, documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { acceptFor, MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { NUMBER_LOCALE } from "@/lib/format-number";
import { chooseFlow, readLastFlow } from "@/lib/lastFlow";
import { knownPlanId, LIMIT_CODES, limitRefusalCopy, readLimitRefusal } from "@/lib/limitRefusal";
import { PLAN_BY_ID } from "@/lib/plans";
import type { BillingStatus } from "@/types/procurement";
import { rowNeed, useRowSend, type ListedDocument } from "./DocumentList";
import { FlowChoice } from "./FlowChoice";
import { PhotoCheck, useCamera } from "./PhotoCheck";
import { canRetryUpload, STOP_CODES, uploadRefusalMessage, useUploadQueue, type UploadItem } from "./UploadQueue";
import { Failed, FirstFlowEmpty, Quiet } from "./states";

/** How many of the newest documents are matched against this visit's uploads (R4). */
export const UPLOADED_LOOKBACK = 100;
const JUST_UPLOADED = ["documents", "just-uploaded"] as const;
const BILLING = "/settings?tab=billing";

const kindsLine = (f: Flow) =>
  `Each file becomes its own document. ${f.formatsOn ? "PDF, Word, Excel, CSV, text, XML or JSON" : "PDF, Excel or CSV"}${f.scansOn ? ", or photos of paper documents" : ""}. Up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB each.`;

const working = (d: { status: string; statusReason: string | null }) => documentStatus(d.status, d.statusReason).tone === "working";
/** The newest page, and every row seen on a page this visit (a file that falls off the page keeps its last known status). */
type Uploaded = { items: DocumentRow[]; seen: Record<string, DocumentRow> };
/** A done item's document as last seen: its row on a page, else what its upload answered. */
const seen = (i: UploadItem, data: Uploaded | undefined): DocumentSummary | undefined =>
  i.document && (data?.seen[i.document.id] ?? i.document);

/** The one notice when uploads are refused by the plan or processing is paused: from the newest refusal that stops the queue, else the billing status. */
function pausedBy(items: readonly UploadItem[], billing: BillingStatus | undefined): { code: string; body: unknown } | null {
  const stopped = items.find((i) => i.state === "refused" && STOP_CODES.has(refusalToken(i.error) ?? ""));
  if (stopped) return { code: refusalToken(stopped.error)!, body: stopped.error instanceof ApiHttpError ? stopped.error.body : null };
  if (!billing || billing.canProcessOrders) return null;
  const code = billing.isTrialExpired ? "pilot_expired" : billing.isOrderLimitReached ? "order_limit_reached" : "processing_paused";
  return { code, body: { error: code, plan: billing.plan } };
}

function PausedNotice({ code, body }: { code: string; body: unknown }) {
  if (LIMIT_CODES.has(code)) {
    const copy = limitRefusalCopy(readLimitRefusal(body));
    return (
      <StatusNotice tone="error" action={<Link href={copy.href ?? BILLING} className={buttonClass("secondary", "sm")}>{copy.cta}</Link>}>
        <strong>{copy.title}</strong> {copy.message}
      </StatusNotice>
    );
  }
  return (
    <StatusNotice tone="error" action={<Link href={BILLING} className={buttonClass("secondary", "sm")}>Plan and billing</Link>}>
      {COPY.processing_paused}
    </StatusNotice>
  );
}

function UsageLine({ billing }: { billing: BillingStatus | undefined }) {
  const id = billing ? knownPlanId(billing.plan) : null;
  const plan = id ? PLAN_BY_ID[id] : null;
  if (!billing || !plan || plan.orderLimit === null) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
      {billing.ordersThisMonth.toLocaleString(NUMBER_LOCALE)} of {billing.orderLimit.toLocaleString(NUMBER_LOCALE)}{" "}
      {plan.orderLimitIsMonthly ? "documents used this month." : "trial documents used."}
      <Link href={BILLING} className="inline-flex min-h-[44px] items-center font-semibold sm:min-h-0">Plan and billing</Link>
    </p>
  );
}

const NAME = "min-w-0 truncate text-[14.5px] font-semibold text-ink";

function UploadedRow({ item, listed, sent, onSent, retry }: {
  item: UploadItem; listed: DocumentSummary | undefined; sent: boolean; onSent(): void; retry(): void;
}) {
  const name = item.file.name;
  // A row this screen sent says Sending while the list still calls it ready, as DocumentList does.
  const doc: ListedDocument | undefined = listed && sent && listed.status === "ready" ? { ...listed, status: "sending", statusReason: null } : listed;
  const send = useRowSend(item.document?.id ?? "", onSent);
  const need = doc && rowNeed(doc);
  return (
    <li aria-live="polite" className="relative grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t border-border px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(124px,auto)_132px] sm:px-[18px]">
      {doc
        ? <Link href={`/flows/${doc.flowId}/documents/${doc.id}`} className={`${NAME} after:absolute after:inset-0`}>{name}</Link>
        : <span className={NAME}>{name}</span>}
      <span>
        {item.state === "waiting" ? <Pill>Waiting</Pill>
          : item.state === "uploading" ? <Pill tone="blue">Uploading</Pill>
          : item.state === "refused" ? <Pill tone="danger">Not uploaded</Pill>
          : need && <Pill tone={need.tone}>{need.text}</Pill>}
      </span>
      <span className="col-span-full justify-self-start sm:col-span-1 sm:justify-self-end">
        {doc?.status === "ready" ? (
          <Button variant="secondary" size="sm" aria-label={`Send ${name}`} loading={send.isPending} onClick={() => send.mutate()}
            className="relative z-[1] !border-brand-green-deep !text-brand-green-deep">Send</Button>
        ) : doc?.status === "needs_review" ? (
          <span aria-hidden className={buttonClass("secondary", "sm")}>Review</span>
        ) : item.state === "refused" && canRetryUpload(item.error) ? (
          <Button variant="secondary" size="sm" aria-label={`Try ${name} again`} onClick={retry} className="relative z-[1]">Try again</Button>
        ) : null}
      </span>
      {item.state === "refused" && <p className="col-span-full m-0 text-[13px] text-danger-text">{uploadRefusalMessage(item.error)}</p>}
      {send.isError && doc?.status === "ready" && <p role="alert" className="col-span-full m-0 text-[13px] text-danger-text">{documentRefusalMessage(send.error)}</p>}
    </li>
  );
}

/** Pick a flow, drop one file or several; each file's result shows where it was dropped. */
export function UploadToFlow() {
  const qc = useQueryClient();
  const tenant = useTenantQueriesEnabled();
  const { items, add, retry } = useUploadQueue();
  const flows = useQuery({ ...flowsQuery, enabled: tenant });
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000, enabled: tenant });
  const [lastId] = useState(readLastFlow);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const camera = useCamera(setPhoto, "camera-input");
  const done = items.filter((i) => i.state === "done");
  const uploaded = useQuery({
    queryKey: JUST_UPLOADED,
    queryFn: async () => {
      const before = qc.getQueryData<Uploaded>(JUST_UPLOADED);
      const { items } = await listDocumentPage({ page: 1, pageSize: UPLOADED_LOOKBACK });
      const next: Uploaded = { items, seen: { ...before?.seen, ...Object.fromEntries(items.map((r) => [r.id, r])) } };
      // The counts change when reading ends, not at the upload: refresh them then (R5).
      if (done.some((i) => working(seen(i, before)!) && !working(seen(i, next)!))) void qc.invalidateQueries({ queryKey: ["documents", "count"] });
      return next;
    },
    enabled: tenant && done.length > 0,
    // Once a page is in, only files found on it keep the polling going: one off the newest page is not asked for again.
    refetchInterval: (q) => {
      const page = q.state.data?.items;
      return done.some((i) => { const d = page ? page.find((r) => r.id === i.document!.id) : i.document; return !!d && working(d); }) ? 2000 : false;
    },
  });

  const list = flows.data ?? [];
  const flow = list.find((f) => f.id === picked) ?? chooseFlow(list, lastId)?.flow;

  let body;
  if (flows.isError && !flows.data) {
    body = <Failed error={flows.error} retry={() => void flows.refetch()} />;
  } else if (!flows.data) {
    body = <Quiet>Loading flows…</Quiet>;
  } else if (!flow) {
    body = <FirstFlowEmpty />;
  } else {
    const paused = pausedBy(items, billing.data);
    const flowIds = new Set(items.map((i) => i.flowId));
    const n = items.length;
    const pick = (files: FileList | null) => files && files.length > 0 && add([...files], flow);
    body = (
      <div className="grid gap-6">
        {paused && <PausedNotice {...paused} />}
        <div className="flex flex-wrap items-start gap-x-8 gap-y-6">
          <div className="min-w-0 max-w-[460px] flex-[1_1_380px]">
            <FlowChoice flows={list} value={flow.id} lastUsedId={lastId} onChange={setPicked} />
            <Link href="/flows/new" className="mt-2 inline-flex min-h-[44px] items-center text-[14px] font-semibold">A new kind of document? Set up a new flow</Link>
          </div>
          <div className="grid min-w-0 flex-[2_1_480px] gap-5">
            <section
              aria-label="Add files"
              data-testid="upload-drop"
              className={`grid justify-items-center gap-3 rounded-2xl border-2 border-dashed px-6 pb-7 pt-8 text-center ${over ? "border-brand-blue" : "border-border-strong"}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
              onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
            >
              <span aria-hidden className="relative flex h-[92px] items-end justify-center">
                {[0, 1, 2].map((k) => (
                  <span key={k} className={`-mx-2 flex h-[84px] w-[66px] flex-col gap-1.5 rounded-[6px] border border-border bg-surface p-2.5 ${k === 1 ? "z-[1] -translate-y-2" : k === 0 ? "-rotate-6" : "rotate-6"}`}>
                    {k === 1 && <span className="block h-2 w-8 rounded-sm bg-brand-blue-soft" />}
                    <span className="block h-[3px] rounded-sm bg-border" />
                    <span className="block h-[3px] rounded-sm bg-border" />
                    <span className="block h-[3px] w-2/3 rounded-sm bg-border" />
                  </span>
                ))}
                <span className="absolute -bottom-1 left-1/2 z-[2] ml-3 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-brand-blue text-white">
                  <Plus size={18} />
                </span>
              </span>
              <h2 className="m-0 text-[20px] font-semibold text-ink">
                <span className="hidden sm:inline">Drop one file or several at once</span>
                <span className="sm:hidden">Add one file or several at once</span>
              </h2>
              <p className="m-0 max-w-[460px] text-[14.5px] text-ink-muted">{kindsLine(flow)}</p>
              <div className="flex flex-col gap-2.5 self-stretch sm:self-center">
                {flow.scansOn && (
                  <Button variant="blue" size="lg" className="!h-12 w-full px-6 text-[15px] sm:hidden" onClick={camera.open}>
                    <Camera size={18} aria-hidden />Take a photo
                  </Button>
                )}
                {/* Outlined below 640px when Take a photo is the filled one: one filled button per width. */}
                <Button variant="blue" size="lg" onClick={() => input.current?.click()}
                  className={`!h-12 w-full px-6 text-[15px] sm:w-auto ${flow.scansOn ? "max-sm:border-border-strong max-sm:bg-surface max-sm:text-ink max-sm:hover:bg-surface-2" : ""}`}>Choose files</Button>
              </div>
              {camera.input}
              <input
                ref={input} type="file" multiple accept={acceptFor(flow)} className="hidden" data-testid="upload-files-input" aria-label="Choose files"
                onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
              />
              <p className="m-0 text-[13.5px] text-ink-muted">They go to <strong className="text-ink">{flow.name}</strong>.</p>
            </section>
            {n > 0 && (
              <Card flush as="section" aria-label="Just uploaded">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-[18px]">
                  <h2 className="m-0 text-[16px] font-semibold text-ink">Just uploaded</h2>
                  <span className="text-[13px] text-ink-muted">
                    {flowIds.size === 1 ? `${n === 1 ? "1 file" : `${n} files`} to ${items[0].flowName}` : `${n} files`}
                  </span>
                </div>
                <ul className="m-0 list-none p-0">
                  {items.map((i) => (
                    <UploadedRow
                      key={i.key} item={i} listed={seen(i, uploaded.data)} sent={!!i.document && sent.has(i.document.id)}
                      onSent={() => setSent((s) => new Set(s).add(i.document!.id))} retry={() => retry(i.key)}
                    />
                  ))}
                </ul>
              </Card>
            )}
            <UsageLine billing={billing.data} />
          </div>
        </div>
        {photo && (
          <PhotoCheck
            file={photo} flows={list} flowId={flow.id} lastUsedId={lastId} onFlow={setPicked}
            onBack={() => setPhoto(null)} onRetake={() => { setPhoto(null); camera.open(); }} onUse={() => { add([photo], flow); setPhoto(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <PageShell variant="narrow">
      <PageHeader title="Upload a document" sub="Add files by hand. Anything sent by email or collected from a server arrives by itself." />
      {body}
    </PageShell>
  );
}
