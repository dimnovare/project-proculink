"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { downloadDeliveryFile, getDocument, listDeliveries, listOutputs, previewOutput, type Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { firstRunAddress } from "@/lib/firstRun";
import { changeFileAddress, flowAddress, type FileWay } from "@/lib/flowSteps";
import { filesOf } from "@/lib/flowWords";
import { saveBlob, savePreview } from "@/lib/saveBlob";
import { WAITING_LINE } from "./ChooseFile";
import { FilePreview } from "./FilePreview";
import { FORMATS } from "./OutputEditor";
import { COMMON_TYPES, replaceOutput, typeChoice } from "./fileChoice";
import { Failed, Loading } from "./states";

const KINDS: Record<string, string> = { csv: "A CSV spreadsheet file", xlsx: "An Excel workbook", xml: "An XML file", json: "A JSON file", pdf: "A PDF" };
const H2 = "m-0 text-[17px] font-semibold text-ink";
const LINE = "m-0 text-[14px] leading-normal text-ink-muted";
const LINK = "font-semibold text-brand-blue underline";

/** D6: the end of the first run. The file, one tap to another type, and what happens next. */
export function FirstFile({ flow, docId }: { flow: Flow; docId: string }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const output = outputs.data?.[0];
  const doc = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId), enabled });
  const preview = useQuery({
    queryKey: ["output-preview", docId, output?.id, output?.format, output?.standard], queryFn: () => previewOutput(docId, output!.id, {}),
    enabled: enabled && !!output, refetchOnWindowFocus: false,
  });
  // A standard's preview carries placeholder control numbers: its card is the file that was really made.
  const standard = !!output?.standard;
  const deliveries = useQuery({ queryKey: ["deliveries", docId], queryFn: () => listDeliveries(docId), enabled: enabled && standard });
  const made = filesOf(deliveries.data)[0];
  const fileName = standard ? made?.fileName : preview.data?.fileName;
  const values = flow.fields.fields.length + flow.fields.tables.reduce((n, t) => n + t.columns.length, 0);

  const download = useMutation({
    mutationFn: async () => (standard ? saveBlob(await downloadDeliveryFile(docId, made!.deliveryId), made!.fileName) : savePreview(preview.data!)),
  });
  const change = useMutation({
    mutationFn: (format: string) => replaceOutput(flow.id, output!, typeChoice(output!, format)),
    // Settled, not success: a publish refused after the update saved must still refetch the flow (its waiting line).
    onSettled: () => {
      for (const queryKey of [["outputs", flow.id], ["flow", flow.id], ["flows"], ["output-preview", docId]]) void qc.invalidateQueries({ queryKey });
    },
  });
  const waiting = change.data?.inUse === false || (typeof flow.publishedVersion === "number" && flow.hasChanges);
  const failed = [outputs, standard ? deliveries : preview].find((q) => q.isError) ?? (standard && deliveries.isSuccess && !made ? deliveries : undefined);
  const here = firstRunAddress({ step: "ready", flow: flow.id, doc: docId });
  const way = (w: FileWay) => changeFileAddress(flow.id, { output: output?.id, document: docId, way: w, from: here });
  const columns = flowAddress(flow.id, "send", { output: output?.id });

  return (
    <div className="grid gap-5">
      <PageHeader title="Your first file is ready" sub={doc.data && `We read ${doc.data.summary.fileName} and made this file from it.`} />
      <Card as="section" aria-labelledby="first-file-name" pad={20} radius={12}>
        {fileName ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="grid min-w-0 flex-[1_1_260px] gap-1">
              <span id="first-file-name" className="break-all font-mono text-[15px] font-medium text-ink">{fileName}</span>
              <span className={LINE}>{`${KINDS[fileName.split(".").pop()!.toLowerCase()] ?? "A file"}, with the ${values} ${values === 1 ? "value" : "values"} we read`}</span>
            </div>
            <Button variant="primary" size="lg" loading={download.isPending} onClick={() => download.mutate()}>Download</Button>
            {download.isError && <p role="alert" className="m-0 basis-full text-[13px] text-danger-text">{documentRefusalMessage(download.error)}</p>}
          </div>
        ) : failed ? <Failed error={failed.error} retry={() => failed.refetch()} /> : <Loading>Loading…</Loading>}
      </Card>
      {output && (
        <Card as="section" aria-labelledby="first-file-change" pad={20} radius={12}>
          <div className="grid gap-3">
            <h2 id="first-file-change" className={H2}>Need a different file?</h2>
            <div role="group" aria-label="File type" className="flex flex-wrap gap-2">
              {COMMON_TYPES.filter((t) => t !== "txt").map((id) => {
                const on = !output.standard && output.format === id;
                return (
                  <Button key={id} variant={on ? "primary" : "secondary"} size="md" className="min-w-[84px]" aria-pressed={on}
                    disabled={change.isPending} onClick={() => { if (!on) change.mutate(id); }}>
                    {FORMATS[id]}
                  </Button>
                );
              })}
            </div>
            {change.isError && <p role="alert" className="m-0 text-[13px] text-danger-text">{documentRefusalMessage(change.error)}</p>}
            <p className={LINE}>{waiting ? WAITING_LINE : "One tap changes it. Every later document is made the same way, until you change it again."}</p>
            <div className="grid gap-1 border-t border-border pt-3">
              <h3 className="m-0 text-[15px] font-semibold text-ink">Does your system need its own format?</h3>
              <p className={LINE}>Show us a file it accepts, or its import guide, and we make that format for you.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={way("sample")} className={buttonClass("secondary", "md")}>Show us a sample file</Link>
                {flow.docsOutputsOn === true && <Link href={way("docs")} className={buttonClass("secondary", "md")}>Give us its documentation</Link>}
                <Link href={way("standard")} className={buttonClass("secondary", "md")}>Pick a standard</Link>
              </div>
            </div>
          </div>
        </Card>
      )}
      <Card as="section" aria-labelledby="first-file-looks" pad={20} radius={12}>
        <div className="grid gap-3">
          <h2 id="first-file-looks" className={H2}>What the file looks like</h2>
          <FilePreview preview={preview.data} cacheKey={`first-file-${docId}-${output?.format}-${output?.standard}`} />
          <p className={LINE}><Link href={columns} className={LINK}>Change the columns</Link></p>
        </div>
      </Card>
      <Card as="section" aria-labelledby="first-file-next" pad={20} radius={12}>
        <div className="grid gap-3">
          <h2 id="first-file-next" className={H2}>What happens next</h2>
          <ul className="m-0 grid list-disc gap-1.5 pl-5 text-[14px] leading-normal text-ink">
            <li>Add more documents by upload, or email them to your workspace address.</li>
            <li>We read each one the same way and make the same kind of file.</li>
            <li>Files wait in Documents until you download them. We can also send them somewhere for you. <Link href={columns} className={LINK}>Choose where they go</Link></li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/upload" className={buttonClass("secondary", "md")}>Add more documents</Link>
            <Link href={`/flows/${flow.id}`} className={buttonClass("secondary", "md")}>See how this flow is set up</Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
