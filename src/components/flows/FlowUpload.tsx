"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDrop } from "@/components/flows/FileDrop";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFlow, uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { acceptFor, MAX_UPLOAD_BYTES } from "@/lib/fileKinds";

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
  const accept = acceptFor(flow.data);
  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(flowId, file),
    onSuccess: onUploaded,
  });
  return (
    <FileDrop accept={accept} maxBytes={MAX_UPLOAD_BYTES} prompt={dropText(scansOn, formatsOn)} busy={upload.isPending} error={upload.isError ? documentRefusalMessage(upload.error) : null} onFile={upload.mutate} />
  );
}
