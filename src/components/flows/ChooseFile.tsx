"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
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
import { DOCS_ACCEPT, DOCS_BYTES, SAMPLE_ACCEPT, SAMPLE_BYTES, StandardList } from "./OutputBuilder";
import { FORMATS, outputTypeLabel } from "./OutputEditor";
import { COMMON_TYPES, aFileOf, makeFileLabel, replaceOutput, standardChoice, typeChoice } from "./fileChoice";
import { Failed, Quiet } from "./states";

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
  if (!f || !outputs.data) return <PageShell>{header()}<Quiet>Loading…</Quiet></PageShell>;
  if (!output) return <PageShell>{header()}<Quiet>{address.output ? "This file no longer exists." : "No file yet."}</Quiet></PageShell>;

  const type = outputTypeLabel(output);
  const goesTo = destinations.data?.find((d) => d.id === output.destinationId);
  const blocked = goesTo?.protocol === "google_sheets" && !!choice && (!!choice.standard || choice.format !== "csv");
  const pressedType = (id: string) => (pick ? pick.by === "type" && choice!.format === id : !output.standard && output.format === id);
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

  return (
    <PageShell>
      {header(`This flow makes ${aFileOf(output)} from each document. Pick what it should make instead. You see the new file before anything changes.`)}
      <div className="grid gap-[18px]">
        <Way title="A common file type" line="The same values, in the type your system opens.">
          <div role="group" aria-label="File type" className="flex w-full flex-wrap gap-2">
            {COMMON_TYPES.map((id) => (
              <Button key={id} variant={pressedType(id) ? "primary" : "secondary"} size="md" className="min-w-[84px]" aria-pressed={pressedType(id)}
                onClick={() => setPick(id === output.format && !output.standard ? null : { by: "type", choice: typeChoice(output, id) })}>
                {FORMATS[id]}
              </Button>
            ))}
          </div>
        </Way>
        <Way title="Like a file I have" line="Upload an example of the file your system expects: CSV, Excel, JSON or XML. We copy its columns, their names and their order, and fill them from what we read.">
          {opener("sample", "Choose a sample file")}
          {drafted("sample", sample, SAMPLE_ACCEPT, SAMPLE_BYTES, "Drop a sample here, or choose a file.", "Reading the sample…")}
        </Way>
        {f.docsOutputsOn === true && (
          <Way title="From your system’s documentation" line="Upload its import guide or specification: PDF, HTML, XSD, JSON or text. We build the file from it and show which part of the guide each column came from.">
            {opener("docs", "Choose the documentation")}
            {drafted("docs", docs, DOCS_ACCEPT, DOCS_BYTES, "Drop the documentation here, or choose a file.", "Reading the documentation…")}
          </Way>
        )}
        <Way title="A standard" line="UBL, cXML, EDIFACT ORDERS or ANSI X12 850. We fill the standard in from what each value means.">
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
        {typeof f.publishedVersion === "number" && f.hasChanges && (
          <p className={LINE}>{WAITING_LINE}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <p className="m-0 min-w-0 flex-[1_1_320px] text-[13.5px] leading-normal text-ink-muted">
            The new file replaces the {type}. To keep the {type} as well, go back and use “{makeFileLabel(outputs.data.length)}”.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={back} className={buttonClass("secondary", "md")}>Cancel</Link>
            <Button variant="primary" size="md" loading={use.isPending} disabled={!choice || blocked || use.isPending || (!!output.destinationId && !destinations.data)} onClick={() => use.mutate()}>
              Use this file
            </Button>
          </div>
        </div>
        {use.isError && <StatusNotice tone="error">{documentRefusalMessage(use.error)}</StatusNotice>}
      </div>
    </PageShell>
  );
}
