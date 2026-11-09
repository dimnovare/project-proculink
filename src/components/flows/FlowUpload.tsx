"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDrop } from "@/components/flows/FileDrop";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFlow, uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** What the document engine reads, narrower than the order upload's list. */
const ACCEPT = ".pdf,.csv,.xlsx";
/** Photos and scans, added when the workspace has scans on. */
const PHOTOS = ".png,.jpg,.jpeg";
/** Word, text, XML, JSON and EDI files, added when the workspace has formats on. */
const FORMATS = ".docx,.txt,.xml,.cxml,.json,.edi,.x12";

const MAX_BYTES = 10 * 1024 * 1024;

const dropText = (scansOn: boolean, formatsOn: boolean) =>
  formatsOn
    ? scansOn
      ? "Drop a file or photo here: PDF, Word, Excel, CSV, text, XML, JSON, EDI, PNG or JPG"
      : "Drop a PDF, Word, Excel, CSV, text, XML, JSON or EDI file here"
    : scansOn
      ? "Drop a PDF, CSV, Excel file or photo (PNG, JPG) here"
      : "Drop a PDF, CSV or Excel file here";

export function FlowUpload({ flowId, onUploaded }: { flowId: string; onUploaded(d: DocumentSummary): void }) {
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled: useTenantQueriesEnabled() });
  const scansOn = !!flow.data?.scansOn;
  const formatsOn = !!flow.data?.formatsOn;
  const accept = [ACCEPT, scansOn && PHOTOS, formatsOn && FORMATS].filter(Boolean).join(",");
  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(flowId, file),
    onSuccess: onUploaded,
  });
  return (
    <FileDrop accept={accept} maxBytes={MAX_BYTES} prompt={dropText(scansOn, formatsOn)} busy={upload.isPending} error={upload.isError ? documentRefusalMessage(upload.error) : null} onFile={upload.mutate} />
  );
}
