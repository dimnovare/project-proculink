"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { CopyButton } from "@/components/bridge/CopyButton";
import { flowsQuery, inboxQuery } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getBillingStatus } from "@/lib/api-client";
import { ApiHttpError } from "@/lib/api/core";
import { listDocumentPage, type DocumentRow, type DocumentSummary, type Inbox } from "@/lib/api/documents";
import { COPY, documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { inInbox, kindSentence } from "@/lib/documentKind";
import { documentStatus } from "@/lib/documentStatusManifest";
import { acceptFor, anyDocumentLine } from "@/lib/fileKinds";
import { NUMBER_LOCALE } from "@/lib/format-number";
import { knownPlanId, LIMIT_CODES, limitRefusalCopy, readLimitRefusal } from "@/lib/limitRefusal";
import { PLAN_BY_ID } from "@/lib/plans";
import { HELD_MAX_BYTES, HELD_MAX_FILES } from "@/lib/pwa/heldUploads";
import type { BillingStatus } from "@/types/procurement";
import { rowNeed, type ListedDocument } from "./DocumentList";
import { RowActions, rowSecondLine } from "./RowActions";
import { PhotoCheck, useCamera } from "./PhotoCheck";
import { canRetryUpload, INBOX_TARGET, STOP_CODES, uploadRefusalMessage, useUploadQueue, type UploadItem } from "./UploadQueue";
import { firstRunOf } from "@/lib/firstRun";
import { changeFileAddress } from "@/lib/flowSteps";
import { aFileOf } from "./fileChoice";
import { Failed, Quiet } from "./states";
import { Welcome } from "./Welcome";
import { focusAfterRemove } from "@/components/pwa/HeldUploads";

/** How many of the newest documents are matched against this visit's uploads (R4). */
export const UPLOADED_LOOKBACK = 100;
const JUST_UPLOADED = ["documents", "just-uploaded"] as const;
const BILLING = "/settings?tab=billing";
/** A filled blue button drawn as an outlined one below 640px, where Take a photo is the filled one. */
const OUTLINED_ON_PHONE = "max-sm:border-border-strong max-sm:bg-surface max-sm:text-ink max-sm:hover:bg-surface-2";

const working = (d: { status: string; statusReason: string | null }) => documentStatus(d.status, d.statusReason).tone === "working";
/** The newest page, and every row seen on a page this visit (a file that falls off the page keeps its last known status). */
type Uploaded = { items: DocumentRow[]; seen: Record<string, DocumentRow> };
/** A done item's document as last seen: its row on a page, else what its upload answered. */
const seen = (i: UploadItem, data: Uploaded | undefined): ListedDocument | undefined =>
  i.document && (data?.seen[i.document.id] ?? i.document);

/** The one notice when uploads are refused by the plan or processing is paused: from the newest refusal that stops the queue, else the billing status. */
function pausedBy(items: readonly UploadItem[], billing: BillingStatus | undefined): { code: string; body: unknown } | null {
  const stopped = items.find((i) => i.state === "refused" && STOP_CODES.has(refusalToken(i.error) ?? ""));
  if (stopped) return { code: refusalToken(stopped.error)!, body: stopped.error instanceof ApiHttpError ? stopped.error.body : null };
  if (!billing || billing.canProcessOrders) return null;
  const code = billing.isTrialExpired ? "pilot_expired" : billing.isOrderLimitReached ? "order_limit_reached" : "processing_paused";
  return { code, body: { error: code, plan: billing.plan } };
}

export function PausedNotice({ code, body }: { code: string; body: unknown }) {
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
const ACTIONS = "col-span-full flex flex-wrap gap-2 justify-self-start sm:col-span-1 sm:justify-end sm:justify-self-end";

/** A row's second line (R22): reading, else what it is, and a new kind says so; null draws none. */
function rowLine(d: ListedDocument): string | null {
  if (d.status === "received" || d.status === "reading") return "We are reading it";
  const said = kindSentence(d.kind, d.sender);
  // A sender may end in its own full stop ("Example Bank Ltd."): one stop between the two sentences.
  return rowSecondLine(d, d.statusReason !== "new_kind" ? said : `${(said ?? "A document").replace(/\.$/, "")}. The first of its kind here.`);
}

function UploadedRow({ item, listed, inbox, sent, onSent, retry, remove }: {
  item: UploadItem; listed: ListedDocument | undefined; inbox: Inbox | undefined; sent: boolean; onSent(): void; retry(): void; remove(): void;
}) {
  const name = item.file.name;
  // A row this screen sent says Sending while the list still calls it ready, as DocumentList does.
  const doc: ListedDocument | undefined = listed && sent && listed.status === "ready" ? { ...listed, status: "sending", statusReason: null } : listed;
  const need = doc && rowNeed(doc);
  const line = doc && rowLine(doc);
  return (
    <li aria-live="polite" className="relative grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t border-border px-4 py-2.5 sm:col-span-full sm:grid-cols-subgrid sm:px-[18px]">
      <span className="grid min-w-0 gap-0.5">
        {doc
          ? <Link href={`/flows/${doc.flowId}/documents/${doc.id}`} className={`${NAME} after:absolute after:inset-0`}>{name}</Link>
          : <span className={NAME}>{name}</span>}
        {line && <span className="truncate text-[13px] text-ink-muted">{line}</span>}
      </span>
      <span>
        {item.state === "waiting" ? <Pill>Waiting</Pill>
          : item.state === "held" ? <Pill tone="amber">Waiting for connection</Pill>
          : item.state === "uploading" ? <Pill tone="blue">Uploading</Pill>
          : item.state === "refused" ? <Pill tone="danger">Not uploaded</Pill>
          : need && <Pill tone={need.tone}>{need.text}</Pill>}
      </span>
      {doc ? (
        // Only a row known to be in a flow is treated as sorted: Review and Send. In the inbox, or not known: Open.
        <RowActions d={{ ...doc, inInbox: inInbox(doc, inbox) }} sendable onSent={onSent} onRemoved={remove} className={ACTIONS} />
      ) : (
        <span className={ACTIONS}>
          {item.state === "refused" && canRetryUpload(item.error) && (
            <Button variant="secondary" size="sm" aria-label={`Try ${name} again`} onClick={retry} className="relative z-[1]">Try again</Button>
          )}
          {(item.state === "held" || item.state === "refused") && (
            <Button variant="secondary" size="sm" aria-label={`Remove ${name}`} onClick={remove} className="relative z-[1]">Remove</Button>
          )}
        </span>
      )}
      {item.state === "held" && <p className="col-span-full m-0 text-[13px] text-ink-muted">It uploads when you&apos;re back online.</p>}
      {item.state === "refused" && <p className="col-span-full m-0 text-[13px] text-danger-text">{uploadRefusalMessage(item.error)}</p>}

    </li>
  );
}

/** Drop any document, with no flow to choose: it is read, then sorted. Each file's result shows where it was dropped. */
export function UploadToFlow() {
  const qc = useQueryClient();
  const tenant = useTenantQueriesEnabled();
  const { items, add, retry, remove } = useUploadQueue();
  const flows = useQuery({ ...flowsQuery, enabled: tenant });
  const isNew = !!flows.data && firstRunOf(flows.data).state === "new";
  // A new workspace never reaches this screen's inbox (R23): it is not asked there.
  // Asked again after a minute here, so a new address or newly read file kinds show without a reload.
  const inbox = useQuery({ ...inboxQuery, staleTime: 60_000, enabled: tenant && !!flows.data && !isNew });
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000, enabled: tenant });
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const camera = useCamera(setPhoto, "camera-input");
  // The first file of the visit moves focus to the list, so a phone shows what happened (later ones never steal it).
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !listHeading.current) return;
    focused.current = true;
    listHeading.current.focus();
  }, [items.length, flows.data, inbox.data]);
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

  // The worker, or the middleware with no worker, lands a share it could not keep here (plan 19).
  const notKeptNotice = useSearchParams().get("shared") === "none" && (
    <StatusNotice tone="warning">
      The shared files couldn&apos;t be kept on this phone. It keeps up to {HELD_MAX_FILES} files, {HELD_MAX_BYTES / 1024 / 1024} MB in all. Share fewer at a time, or add them from Add documents.
    </StatusNotice>
  );

  // Only an answered list can say the workspace is new: loading or failed draws its own state below.
  if (isNew) return <>{notKeptNotice && <div className="px-4 pt-4 md:px-6">{notKeptNotice}</div>}<Welcome flows={flows.data!} /></>;

  let body;
  if (flows.isError && !flows.data) {
    body = <Failed error={flows.error} retry={() => void flows.refetch()} />;
  } else if (!flows.data) {
    body = <Quiet>Loading flows…</Quiet>;
  } else {
    const paused = pausedBy(items, billing.data);
    const n = items.length;
    const more = n > 0;
    // What the workspace reads comes from the inbox answer; an absent switch is off (P4).
    const target = inbox.data && INBOX_TARGET(inbox.data);
    const pick = (files: FileList | null) => target && files && files.length > 0 && add([...files], target);
    // Only from an answer that has not failed since: a failed refresh never leaves a dead address with Copy.
    const address = !inbox.isError && inbox.data?.address;
    // Every done file is in one flow, and that flow makes one file: say which, with a way to change it.
    const docs = done.map((i) => seen(i, uploaded.data));
    const one = docs.length > 0 && docs.every((d) => d && inInbox(d, inbox.data) === false && d.flowId === docs[0]!.flowId)
      ? flows.data.find((f) => f.id === docs[0]!.flowId) : undefined;
    const made = one?.summary?.outputs.length === 1 ? one.summary.outputs[0] : null;
    body = (
      <div className="grid gap-5">
        {notKeptNotice}
        {paused && <PausedNotice {...paused} />}
        {/* Above the drop zone: what was just added is the first thing in view, on a phone too. */}
        {n > 0 && (
          <Card flush as="section" aria-label="Just added">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-[18px]">
              <h2 ref={listHeading} tabIndex={-1} className="m-0 scroll-mt-16 text-[16px] font-semibold text-ink outline-none focus-visible:outline-none">Just added</h2>
              <span className="text-[13px] text-ink-muted">{n === 1 ? "1 document" : `${n} documents`}</span>
            </div>
            {one && made && (
              <p className="m-0 px-4 pb-3 text-[13px] text-ink-muted sm:px-[18px]">
                {`Each one becomes the file its flow makes. Your flow “${one.name}” makes ${aFileOf(made)}${made.destination ? ` and sends it to ${made.destination}.` : " that you download."} `}
                <Link href={changeFileAddress(one.id, { from: "/upload" })} className="inline-flex min-h-[44px] items-center font-semibold text-brand-blue sm:min-h-0">Change the file</Link>
              </p>
            )}
            <ul className="m-0 list-none p-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(124px,auto)_minmax(150px,auto)] sm:gap-x-3.5">
              {items.map((i) => (
                <UploadedRow
                  key={i.key} item={i} listed={seen(i, uploaded.data)} inbox={inbox.data} sent={!!i.document && sent.has(i.document.id)}
                  onSent={() => setSent((s) => new Set(s).add(i.document!.id))} retry={() => retry(i.key)} remove={() => { remove(i.key); focusAfterRemove(listHeading.current); }}
                />
              ))}
            </ul>
          </Card>
        )}
        {inbox.isError && !inbox.data ? (
          <Failed error={inbox.error} retry={() => void inbox.refetch()} />
        ) : !target ? (
          // Nothing that would guess what the workspace reads: a calm space of the drop zone's height.
          <div role="status" className={`min-h-[316px] rounded-2xl border-2 border-dashed border-border ${more ? "max-sm:min-h-[148px]" : ""}`}><span className="sr-only">Loading</span></div>
        ) : (
          <section
            aria-label="Add files"
            data-testid="upload-drop"
            // Below 640px, once files are added, a compact Add more block: the list above stays the thing in view.
            className={`grid justify-items-center gap-3 rounded-2xl border-2 border-dashed px-6 pb-7 pt-8 text-center ${more ? "max-sm:px-4 max-sm:py-4" : ""} ${over ? "border-brand-blue" : "border-border-strong"}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
          >
            <span aria-hidden className={`relative flex h-[92px] items-end justify-center ${more ? "max-sm:hidden" : ""}`}>
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
            <h2 className={`m-0 font-semibold text-ink ${more ? "text-[16px] sm:text-[20px]" : "text-[20px]"}`}>
              <span className="hidden sm:inline">Drop your files here</span>
              <span className="sm:hidden">{more ? "Add more" : "Add your documents"}</span>
            </h2>
            <p className={`m-0 max-w-[480px] text-[14.5px] text-ink-muted ${more ? "max-sm:hidden" : ""}`}>
              Invoices, orders, delivery notes, statements: any document. {anyDocumentLine(target)}
            </p>
            <div className="flex flex-col gap-2.5 justify-self-stretch sm:justify-self-center">
              {target.scansOn && (
                <Button variant="blue" size="lg" className="!h-12 w-full px-6 text-[15px] sm:hidden" onClick={camera.open}>
                  <Camera size={18} aria-hidden />Take a photo
                </Button>
              )}
              {/* Outlined below 640px when Take a photo is the filled one: one filled button per width. */}
              <Button variant="blue" size="lg" onClick={() => input.current?.click()}
                className={`!h-12 w-full px-6 text-[15px] sm:w-auto ${target.scansOn ? OUTLINED_ON_PHONE : ""}`}>Choose files</Button>
            </div>
            {camera.input}
            <input
              ref={input} type="file" multiple accept={acceptFor(target)} className="hidden" data-testid="upload-files-input" aria-label="Choose files"
              onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
            />
          </section>
        )}
        {address && (
          <Card edge="none" as="section" aria-label="Or send them by email">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <div className="grid min-w-0 flex-[1_1_280px] gap-0.5">
                <h2 className="m-0 text-[14.5px] font-semibold text-ink">Or send them by email</h2>
                <p className="m-0 text-[14px] text-ink-muted">
                  Forward any email with documents attached to <span className="break-all font-mono text-[13px] text-ink">{address}</span>
                </p>
                <p className="m-0 text-[13px] text-ink-muted sm:hidden">On a phone: in any app, tap Share, choose Mail, and send the file to this address.</p>
              </div>
              <CopyButton text={address} label="Copy address" />
            </div>
          </Card>
        )}
        <UsageLine billing={billing.data} />
        {photo && target && (
          <PhotoCheck
            file={photo}
            onBack={() => setPhoto(null)} onRetake={() => { setPhoto(null); camera.open(); }} onUse={() => { add([photo], target); setPhoto(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <PageShell variant="narrow">
      {HEADER}
      {body}
    </PageShell>
  );
}

const HEADER = <PageHeader title="Add documents" sub="Drop in anything you receive. We read each one, work out what it is, and handle it like the ones before it." />;

/** The page's Suspense fallback: exactly what UploadToFlow draws while the flows load. */
export const UploadLoading = () => <PageShell variant="narrow">{HEADER}<Quiet>Loading flows…</Quiet></PageShell>;
