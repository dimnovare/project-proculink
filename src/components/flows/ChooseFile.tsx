"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { ActionBar } from "@/components/bridge/layout/ActionBar";
import { Card } from "@/components/bridge/layout/Card";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getDocument, getFlow, listDestinations, listOutputs, outputFromDocumentation, outputFromSample, previewOutput } from "@/lib/api/documents";
import type { FileChoice } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { flowAddress, readChangeFile, type FileWay } from "@/lib/flowSteps";
import { DraftReview } from "./DraftReview";
import { FileDrop } from "./FileDrop";
import { FilePreview } from "./FilePreview";
import { useLatestRead } from "./FlowValues";
import { kindGroup, standardFamilies } from "@/lib/standardOutputs";
import { DOCS_ACCEPT, DOCS_BYTES, SAMPLE_ACCEPT, SAMPLE_BYTES, StandardList } from "./OutputBuilder";
import { FORMATS, outputTypeLabel } from "./OutputEditor";
import { COMMON_TYPES, aFileOf, replaceOutput, standardChoice, typeChoice } from "./fileChoice";
import { Failed, Quiet, Loading } from "./states";

const or = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`);
const H2 = "m-0 text-[17px] font-semibold text-ink";
const LINE = "m-0 text-[14px] leading-normal text-ink-muted";
/** A published flow with other changes waiting: a new file joins them instead of going into use. */
export const WAITING_LINE = "This flow has changes that aren't in use yet. The new file joins them and goes into use when you press Use these changes on the flow page.";

/** One of the four ways: a heading, its line, and either its button or what the button opened. */
function Way({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <Card as="section" pad={20} radius={12}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="grid min-w-0 flex-[1_1_380px] gap-1">
          <h2 className={H2}>{title}</h2>
          <p className={LINE}>{line}</p>
        </div>
        {children}
      </div>
    </Card>
  );
}

/** D5: change the file a flow makes (replace, not add). Nothing is saved until Use this file. */
export function ChooseFile({ flowId }: { flowId: string }) {
  const address = readChangeFile(useSearchParams());
  const router = useRouter();
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled });
  const outputs = useQuery({ queryKey: ["outputs", flowId], queryFn: () => listOutputs(flowId), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const { latest } = useLatestRead(flowId);
  const docId = address.document ?? latest?.id ?? null;
  const doc = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId!), enabled: enabled && !!docId });
  const output = address.output ? outputs.data?.find((o) => o.id === address.output) : outputs.data?.[0];

  const [open, setOpen] = useState<FileWay | null>(address.way);
  /** The pick and the way it came from, so a sample's CSV does not light the CSV button. */
  const [pick, setPick] = useState<{ by: "type" | FileWay; choice: FileChoice } | null>(null);
  const choice = pick?.choice ?? null;
  const fromDraft = (by: FileWay) => (c: FileChoice | null) => setPick(c && { by, choice: c });
  const sample = useMutation({ mutationFn: (file: File) => outputFromSample(flowId, file) });
  const docs = useMutation({ mutationFn: (file: File) => outputFromDocumentation(flowId, file) });
  const preview = useQuery({
    queryKey: ["output-preview", docId, output?.id, "as", choice],
    queryFn: () => previewOutput(docId!, output!.id, choice ? { as: choice } : {}),
    enabled: enabled && !!docId && !!output,
  });
  const back = address.from ?? flowAddress(flowId, "send", { output: output?.id });
  const use = useMutation({
    mutationFn: () => replaceOutput(flowId, output!, choice!),
    // Settled, not success: a publish refused after the update saved must still refetch the flow (its waiting line).
    onSettled: () => {
      for (const queryKey of [["outputs", flowId], ["flow", flowId], ["flows"], ["output-preview"]]) void qc.invalidateQueries({ queryKey });
      void qc.resetQueries({ queryKey: ["outputs", flowId, "published"] });
    },
    onSuccess: () => router.push(back),
  });

  const f = flow.data;
  const failed = [flow, outputs].find((q) => q.isError);
  const header = (sub?: string) => <PageHeader title="Change the file" sub={sub} back={{ href: back, label: f?.name ?? "Flow" }} />;
  if (failed) return <PageShell>{header()}<Failed error={failed.error} retry={() => failed.refetch()} /></PageShell>;
  if (!f || !outputs.data) return <PageShell>{header()}<Loading>Loading…</Loading></PageShell>;
  if (!output) return <PageShell>{header()}<Quiet>{address.output ? "This file no longer exists." : "No file yet."}</Quiet></PageShell>;

  const type = outputTypeLabel(output);
  // B-13: the standards line follows the documents' kind, as the list below it does.
  const fams = standardFamilies(f.peppolOn, f.ksefOn);
  const fit = kindGroup(doc.data?.read?.kindLabel ?? null);
  const fitting = fit ? fams[fit] : [...fams.invoices, ...fams.orders];
  // Neither group is ever empty: the Factur-X invoice and the order standards ship to every workspace.
  // The rest of the list sits under "Other standards": the line counts them, from the same families.
  const others = fit ? fams[fit === "invoices" ? "orders" : "invoices"].length : 0;
  const more = others ? ` ${others} more for ${fit === "invoices" ? "orders" : "invoices"} under Other standards.` : "";
  const standardLine = `${or(fitting.map((s) => s.name))}.${more} We fill the standard in from what each value means.`;
  const goesTo = destinations.data?.find((d) => d.id === output.destinationId);
  const blocked = goesTo?.protocol === "google_sheets" && !!choice && (!!choice.standard || choice.format !== "csv");
  // Only a new pick looks pressed: the type in use is tagged Current, so a grey Use this file never sits under a "chosen" button.
  const pressedType = (id: string) => pick?.by === "type" && choice!.format === id;
  const currentType = (id: string) => !output.standard && output.format === id;
  const opener = (way: FileWay, label: string) =>
    open !== way && <Button variant="secondary" size="md" onClick={() => setOpen(way)}>{label}</Button>;
  const drafted = (way: "sample" | "docs", m: typeof sample, accept: string, maxBytes: number, prompt: string, busyLabel: string) =>
    // Kept mounted while another way is open, so edits to a draft survive switching ways.
    (open === way || !!m.data) && (
      <div className={open === way ? "grid w-full gap-3" : "hidden"}>
        {m.data ? (
          <DraftReview flow={f} draft={m.data} requireTest={way === "docs"} previewDocumentId={docId ?? undefined}
            onCreated={() => {}} onRestart={() => { m.reset(); if (pick?.by === way) setPick(null); }}
            replacing={{ destinationId: output.destinationId, onChange: fromDraft(way) }} />
        ) : (
          <>
            {way === "docs" && <p className={LINE}>{COPY.docs_lead}</p>}
            <FileDrop accept={accept} maxBytes={maxBytes} prompt={prompt} busyLabel={busyLabel} busy={m.isPending}
              error={m.isError ? documentRefusalMessage(m.error) : null} onFile={m.mutate} />
          </>
        )}
      </div>
    );

  const actions = (
    <>
      <Link href={back} className={buttonClass("secondary", "md")}>Cancel</Link>
      <Button variant="primary" size="md" loading={use.isPending} disabled={!choice || blocked || use.isPending || (!!output.destinationId && !destinations.data)} onClick={() => use.mutate()}>
        Use this file
      </Button>
    </>
  );
  return (
    <PageShell>
      {header(`This flow makes ${aFileOf(output)} from each document. Pick what it should make instead. You see the new file before anything changes.`)}
      <div className="grid gap-[18px]">
        <Way title="A common file type" line="The same values, in the type your system opens.">
          <div role="group" aria-label="File type" className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
            {COMMON_TYPES.map((id) => (
              <Button key={id} variant={pressedType(id) ? "primary" : "secondary"} size="md" className={currentType(id) ? "h-auto w-full flex-col gap-0 py-1" : "w-full"} aria-pressed={pressedType(id)}
                onClick={() => setPick(id === output.format && !output.standard ? null : { by: "type", choice: typeChoice(output, id) })}>
                {FORMATS[id]}
                {currentType(id) && <span className="rounded-full border border-current px-1.5 text-[11px] font-semibold"><span className="sr-only">, </span>Current</span>}
              </Button>
            ))}
          </div>
        </Way>
        <Way title="Like a file I have" line="Upload an example of the file your system expects: CSV, Excel, JSON or XML. We copy its columns, their names and their order, and fill them from what we read.">
          {opener("sample", "Choose a sample file")}
          {drafted("sample", sample, SAMPLE_ACCEPT, SAMPLE_BYTES, "Drop a sample here, or choose a file.", "Reading the sample…")}
        </Way>
        {address.way === "docs" && f.docsOutputsOn !== true && <p className={LINE}>Building from documentation isn&apos;t on for this workspace yet.</p>}
        {f.docsOutputsOn === true && (
          <Way title="From your system’s documentation" line="Upload its import guide or specification: PDF, HTML, XSD, JSON or text. We build the file from it and show which part of the guide each column came from.">
            {opener("docs", "Choose the documentation")}
            {drafted("docs", docs, DOCS_ACCEPT, DOCS_BYTES, "Drop the documentation here, or choose a file.", "Reading the documentation…")}
          </Way>
        )}
        <Way title="A standard" line={standardLine}>
          {opener("standard", "See the standards")}
          {open === "standard" && (
            <div className="grid w-full gap-2">
              <StandardList flow={f} kind={doc.data?.read?.kindLabel ?? null} busyId={null} pickedId={choice?.standard ?? null}
                onUse={(s) => setPick({ by: "standard", choice: standardChoice(s.id, output, f) })} />
            </div>
          )}
        </Way>
        <Card as="section" pad={20} radius={12}>
          <div className="grid gap-2.5">
            <h2 className={H2}>What the file looks like</h2>
            <p className="m-0 text-[13.5px] text-ink-muted">
              {docId ? `Made from ${doc.data?.summary.fileName ?? "…"}. It changes as you pick above.` : "Add a document to this flow to see the file here."}
            </p>
            {preview.isError ? <StatusNotice tone="error">{documentRefusalMessage(preview.error)}</StatusNotice>
              : <FilePreview preview={preview.data} cacheKey={`change-file-${output.id}-${JSON.stringify(choice)}`} />}
          </div>
        </Card>
        {blocked && <StatusNotice tone="warning">Google Sheets takes only a CSV file. Choose CSV, or change where this file goes first.</StatusNotice>}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="grid min-w-0 flex-[1_1_320px] gap-1 text-[13.5px] leading-normal text-ink-muted">
            <p className="m-0">The new file replaces the {type}. Nothing changes until you press Use this file.</p>
            {typeof f.publishedVersion === "number" && f.hasChanges && <p className="m-0 text-[12.5px]">{WAITING_LINE}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!choice && <span className="text-[13px] text-ink-muted">Pick a file type, a sample or a standard above.</span>}
            <div className="hidden items-center gap-2 md:flex">{actions}</div>
          </div>
        </div>
        {use.isError && <StatusNotice tone="error">{documentRefusalMessage(use.error)}</StatusNotice>}
      </div>
      {/* Phones: the same two buttons in the sticky bar, like the other setup steps. */}
      <ActionBar>{actions}</ActionBar>
    </PageShell>
  );
}
