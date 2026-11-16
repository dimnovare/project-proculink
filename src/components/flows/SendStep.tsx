"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { capture } from "@/lib/analytics";
import {
  downloadDeliveryFile, getDocument, listDestinations, listOutputs, previewOutput, publishFlow, sendDocument, updateFlow, updateOutput,
  type Destination, type Flow,
} from "@/lib/api/documents";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "@/lib/deliveryMode";
import { COPY, documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { saveBlob } from "@/lib/saveBlob";
import { nextTabIndex } from "@/lib/tabKeys";
import { destinationNameFor, firstRunAddress, foundSummary, keepsSummary } from "@/lib/firstRun";
import { DestinationForm, Field, INPUT } from "./DestinationForm";
import { notFound, useRunDocument } from "./CheckStep";
import { useLinkedAccounts } from "./GoogleTargetFields";
import { Failed, Gone } from "./states";

type NewTile = "email" | "google_drive" | "google_sheets" | "server" | "s3" | "http";
export type SendChoice =
  | { kind: "download" }
  | { kind: "existing"; destinationId: string | null }
  | { kind: "new"; tile: NewTile };

/** R16: exactly the kinds FlowDestinationService allows, in order; Google only when the server says it is available. */
const TILES: readonly { tile: NewTile; title: string; sub: string; protocols: readonly string[]; google?: true }[] = [
  { tile: "email", title: "Email", sub: "To one or more addresses", protocols: ["email"] },
  { tile: "google_drive", title: "Google Drive", sub: "A folder you choose", protocols: ["google_drive"], google: true },
  { tile: "google_sheets", title: "Google Sheets", sub: "New rows in a sheet", protocols: ["google_sheets"], google: true },
  { tile: "server", title: "SFTP or FTPS", sub: "A folder on a server", protocols: ["sftp", "ftps"] },
  { tile: "s3", title: "S3 bucket", sub: "Amazon S3 or compatible", protocols: ["s3"] },
  { tile: "http", title: "Web address", sub: "Posted to another system", protocols: ["http"] },
];
const WAY_ON = "inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand-blue sm:min-h-0";
const LINK_BUTTON = `${WAY_ON} underline disabled:opacity-50`;

type Tested = { destinationId: string; ok: boolean };
/** R20. `tested` is the last `onTested` outcome for the destination the new form saved. Our sample is never sent, and a
 *  document not known to be ours or the sample can only be finished: unknown is never ready. */
export function readiness(choice: SendChoice, tested: Tested | null, isSample: boolean | null | undefined): "sample" | "unknown" | "download" | "ready" | "not-ready" {
  if (isSample === true) return "sample";
  if (isSample !== false) return "unknown";
  if (choice.kind === "download") return "download";
  return (choice.kind === "existing" ? !!choice.destinationId : !!tested?.ok) ? "ready" : "not-ready";
}

/** A refusal in the server's words, under the control that was pressed; the plan's codes with their way on. */
function Refusal({ error }: { error: unknown }) {
  const code = refusalToken(error) ?? "";
  const billing = code === "processing_paused" || LIMIT_CODES.has(code);
  return (
    <StatusNotice tone="error" action={billing && <Link href="/settings?tab=billing" className="inline-flex items-center text-[12.5px] font-semibold text-brand-blue">Open Plan &amp; billing</Link>}>
      {documentRefusalMessage(error)}
    </StatusNotice>
  );
}

const MODES = [
  ["review", REVIEW_BEFORE_DELIVERY_LABEL, "It waits in Documents, under Needs you, until you press Send."],
  ["auto", AUTOMATIC_DELIVERY_LABEL, "It is sent as soon as it is read. A document we couldn't read, or one with a number we've already received, still waits for you."],
] as const;

/** One radio of the group: only the checked one is a tab stop, and the arrow keys move and pick (the radiogroup pattern). */
function Tile({ id, title, sub, checked, stop, onPick, onKeyDown }: {
  id: string; title: string; sub: string; checked: boolean; stop: boolean; onPick(): void; onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}) {
  return (
    <button
      type="button" role="radio" aria-checked={checked} tabIndex={stop ? 0 : -1} data-testid={`send-tile-${id}`} onClick={onPick} onKeyDown={onKeyDown}
      className={`grid min-h-[44px] content-start gap-0.5 rounded-card border px-3 py-2.5 text-left ${checked ? "border-navy bg-surface-2" : "border-border bg-surface"}`}
    >
      <span className="text-[14px] font-semibold text-ink">{title}</span>
      <span className="text-[12.5px] text-ink-muted">{sub}</span>
    </button>
  );
}

/** Step 3 of first run: where the file goes, from the kinds the server supports. */
export function SendStep({ flow, docId, first }: { flow: Flow; docId: string | null; first: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const enabled = useTenantQueriesEnabled();
  const run = useRunDocument(flow.id, docId);
  const id = run.docId ?? "";
  const google = useLinkedAccounts().data?.available === true;
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const doc = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id), enabled: enabled && !!id });
  const output = outputs.data?.[0];
  const [picked, setPicked] = useState<SendChoice | null>(null);
  const [saved, setSaved] = useState<Destination | null>(null);
  const [tested, setTested] = useState<Tested | null>(null);
  // R18: the output's saved destination, else Download.
  const choice: SendChoice = picked ?? (output?.destinationId ? { kind: "existing", destinationId: output.destinationId } : { kind: "download" });
  const pick = (c: SendChoice) => {
    if (JSON.stringify(c) === JSON.stringify(choice)) return; // the same tile again keeps its form
    setPicked(c); setSaved(null); setTested(null);
  };
  const tile = choice.kind === "new" ? TILES.find((t) => t.tile === choice.tile)! : null;

  // A document we could not read answers an empty read: it found nothing, so the finished steps claim no values.
  const read = doc.data?.read && doc.data.read.fields.length + doc.data.read.tables.length > 0 ? doc.data.read : undefined;
  const fileName = run.row?.fileName ?? doc.data?.summary.fileName ?? "";
  const kept = read ? read.fields.filter((f) => flow.fields.fields.some((k) => k.key === f.key)).length : 0;
  const passed = !!saved && tested?.destinationId === saved.id && tested.ok;
  const listed = choice.kind === "existing" ? destinations.data?.find((d) => d.id === choice.destinationId) : undefined;
  // Ready only when known (I4): the output is there, and a saved destination is one the list still names.
  const known = !!output && (choice.kind !== "existing" || !!listed);
  // A document that cannot be sent (it could not be read, or it is already sent) is said in its status's words and only finished.
  const status = doc.data && documentStatus(doc.data.summary.status, doc.data.summary.statusReason);
  const state = !known ? "unknown" : status && !status.editable && run.isSample === false ? "closed" : readiness(choice, passed ? tested : null, run.isSample);
  // What Finish attaches: null is Download; a destination only when it was set up before or passed its test now;
  // undefined leaves the output as it is (a new destination not saved, or saved but not passed).
  const going: Destination | undefined = choice.kind === "existing" ? listed : passed ? saved! : undefined;
  const target: string | null | undefined = choice.kind === "download" ? null : going?.id;

  const mode = useMutation({
    mutationFn: (automation: "review" | "auto") => updateFlow(flow.id, { automation }),
    onSuccess: (f) => { qc.setQueryData(["flow", flow.id], f); void qc.invalidateQueries({ queryKey: ["flows"] }); },
  });
  const automation = mode.isPending ? mode.variables : flow.automation;

  /** R18, R19: link the chosen destination, then publish ("nothing to publish" is done). */
  const prepare = async () => {
    if (output && target !== undefined && output.destinationId !== target) {
      const { name, format, tableKey, template, sendWhen, layout } = output;
      await updateOutput(flow.id, output.id, { name, format, tableKey, template, sendWhen, layout, destinationId: target });
    }
    await publishFlow(flow.id).catch((e: unknown) => { if (refusalToken(e) !== "nothing_to_publish") throw e; });
  };
  const done = () => {
    for (const queryKey of [["documents"], ["flows"], ["flow", flow.id], ["outputs", flow.id]]) void qc.invalidateQueries({ queryKey });
    capture("wizard_step_completed", { step: 3, step_name: "send", first });
    router.push(`/flows/${flow.id}`);
  };
  // One press at a time: a second press before the next render does nothing; a refusal gives the buttons back.
  const pressed = useRef(false);
  const settle = () => { pressed.current = false; };
  const send = useMutation({
    mutationFn: async () => {
      // Only a document known not to be our sample is ever sent (R19).
      if (run.isSample !== false || (state !== "ready" && state !== "download")) throw new Error("Not ready to send.");
      await prepare();
      const deliveries = await sendDocument(id);
      const stored = choice.kind === "download" ? deliveries.find((d) => d.status === "stored") : undefined;
      if (stored) saveBlob(await downloadDeliveryFile(id, stored.id), stored.fileName ?? "document.csv");
    },
    onSuccess: done, onError: settle,
    // A send that went out but whose file then failed to download still changed the document.
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
  const finish = useMutation({ mutationFn: prepare, onSuccess: done, onError: settle });
  const sample = useMutation({
    mutationFn: async () => {
      const p = await previewOutput(id, output!.id);
      const body = p.base64 ? Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)) : p.content;
      saveBlob(new Blob([body], { type: p.contentType }), p.fileName);
    },
    onSettled: settle,
  });
  const press = (m: typeof send | typeof finish | typeof sample) => {
    if (pressed.current) return;
    pressed.current = true;
    for (const x of [send, finish, sample]) x.reset();
    m.mutate();
  };
  const busy = send.isPending || finish.isPending || sample.isPending || !output;
  const later = going && `From now on, documents in this flow go to ${going.name}.${automation === "auto" ? " They are sent as soon as they are read." : " Each one waits for you to check it first."}`;
  const unused = choice.kind === "new" && saved && !passed
    ? `${saved.name} did not pass its test, so it is saved but not used yet. You can fix it on the flow page.` : null;
  const group = useRef<HTMLDivElement>(null);
  const options = [
    { id: "download", title: "Download", sub: "No setup needed", checked: choice.kind === "download", pick: () => pick({ kind: "download" }) },
    ...TILES.filter((t) => google || !t.google).map((t) => ({ id: t.tile, title: t.title, sub: t.sub, checked: tile?.tile === t.tile, pick: () => pick({ kind: "new", tile: t.tile }) })),
    ...(destinations.data?.length ? [{
      id: "existing", title: "Already set up", sub: "A destination you saved before", checked: choice.kind === "existing",
      pick: () => pick({ kind: "existing", destinationId: choice.kind === "existing" ? choice.destinationId : destinations.data[0].id }),
    }] : []),
  ];
  if (notFound(doc.error)) return <Gone text={COPY.document_not_found} />;
  const refused = send.error ?? finish.error ?? sample.error;
  const sendLabel = `Send ${fileName} now`;

  return (
    <div className="grid gap-6">
      <Card as="section" aria-label="Finished steps">
        <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{fileName}</span>
          {read && <span className="text-[13px] text-ink-muted">was read: {foundSummary(read)}</span>}
          <Link href={firstRunAddress({ flow: flow.id })} className={WAY_ON}>Use another file</Link>
        </div>
        <div className="grid gap-0.5">
          <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{flow.name}</span>
          {read && <span className="text-[13px] text-ink-muted">{keepsSummary(kept, read.fields.length)}</span>}
          <Link href={firstRunAddress({ step: "check", flow: flow.id, doc: id })} className={WAY_ON}>Change values</Link>
        </div>
        </div>
      </Card>

      <section aria-labelledby="send-where" className="grid gap-3">
        <h2 id="send-where" className="m-0 text-[18px] font-semibold text-ink">Where should the file go?</h2>
        <div ref={group} role="radiogroup" aria-labelledby="send-where" className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-2">
          {options.map((o, i) => (
            <Tile key={o.id} id={o.id} title={o.title} sub={o.sub} checked={o.checked} stop={o.checked || (i === 0 && !options.some((x) => x.checked))} onPick={o.pick} onKeyDown={(e) => {
              const to = nextTabIndex(e.key, i, options.length);
              if (to === undefined) return;
              e.preventDefault();
              options[to].pick();
              group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[to]?.focus();
            }} />
          ))}
        </div>
        {/* Rows stay through a failed refresh: only a list that never answered is replaced. */}
        {destinations.isError && !destinations.data && <Failed error={destinations.error} retry={() => destinations.refetch()} />}
        {choice.kind === "existing" && !!destinations.data?.length && (
          <div className="max-w-[420px]">
            <Field label="Destination">
              <select className={INPUT} value={choice.destinationId ?? ""} onChange={(e) => pick({ kind: "existing", destinationId: e.target.value })}>
                {destinations.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {tile && (
          <DestinationForm
            key={tile.tile} inline testAfterSave onSaved={(d) => { setSaved(d); setTested(null); }} onCancel={() => pick({ kind: "download" })}
            chosen={{ protocols: tile.protocols, name: destinationNameFor(tile.protocols[0], flow.name), onTested: setTested, outlined: state !== "not-ready" }}
          />
        )}
      </section>

      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={mode.isPending}>
        <legend className="mb-1 text-[14px] font-semibold text-ink">When a new document is read</legend>
        {MODES.map(([value, label, line]) => (
          <label key={value} className="flex min-h-[44px] items-start gap-2 text-[14px] text-ink">
            <input type="radio" name="first-run-mode" className="mt-1 h-4 w-4" checked={automation === value} onChange={() => mode.mutate(value)} />
            <span className="grid gap-0.5"><span className="font-semibold">{label}</span><span className="text-[13px] text-ink-muted">{line}</span></span>
          </label>
        ))}
        <p className="m-0 text-[13px] text-ink-muted">You can change this later.</p>
        {mode.isError && <StatusNotice tone="error">{documentRefusalMessage(mode.error)}</StatusNotice>}
      </fieldset>

      <section aria-label="Finish" className="sticky bottom-0 grid gap-2 border-t border-border bg-bg py-3">
        {outputs.isError && !outputs.data ? (
          <StatusNotice tone="error" action={<Button size="sm" variant="secondary" onClick={() => outputs.refetch()}>Try again</Button>}>
            {documentRefusalMessage(outputs.error)}
          </StatusNotice>
        ) : !outputs.data || run.isLoading ? <p role="status" className="m-0 text-[13px] text-ink-muted">Loading…</p> : <>
        <p className="m-0 text-[14px] text-ink">
          {state === "sample" ? "This is our sample invoice, so we never send it. Download its CSV file to see what your documents will become, then add one of your own."
            : state === "unknown" ? "Finish now and send your document later from Documents."
            : state === "closed" ? `${fileName}: ${status!.label}.`
            : state === "download" ? "Your document is ready. You download it as a CSV file."
            : state === "ready" ? `Your document is ready. It goes to ${going!.name} as a CSV file.`
            : "Send a test first to check the settings. Or finish now and send your document later from Documents."}
        </p>
        {(later || unused) && <p className="m-0 text-[14px] text-ink">{later || unused}</p>}
        <div className="flex flex-wrap items-center gap-4">
          {state === "sample" || state === "unknown" || state === "closed" ? (
            <Button variant="primary" disabled={busy} loading={finish.isPending} onClick={() => press(finish)}>Finish</Button>
          ) : (
            <Button variant={state === "not-ready" ? "secondary" : "send"} disabled={busy || state === "not-ready"} loading={send.isPending} onClick={() => press(send)}>
              {state === "download" ? "Make the file and download it" : sendLabel}
            </Button>
          )}
          {state === "sample" && <button type="button" className={LINK_BUTTON} disabled={busy} onClick={() => press(sample)}>Download the sample&apos;s CSV file</button>}
          {state !== "sample" && state !== "unknown" && state !== "closed" && (
            <button type="button" className={LINK_BUTTON} disabled={busy} onClick={() => press(finish)}>
              {state === "download" ? "Finish without downloading" : "Finish without sending"}
            </button>
          )}
        </div>
        {!!refused && <Refusal error={refused} />}
        </>}
      </section>
    </div>
  );
}
