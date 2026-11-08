"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { getFlow, uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary } from "@/lib/api/documents";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** The document engine reads these three only, narrower than the order upload's list. */
const ACCEPT = ".pdf,.csv,.xlsx";
/** Added when the workspace has scans on. */
const PHOTOS = ".png,.jpg,.jpeg";

const MAX_BYTES = 10 * 1024 * 1024;

export function FlowUpload({ flowId, onUploaded }: { flowId: string; onUploaded(d: DocumentSummary): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId) });
  const scansOn = !!flow.data?.scansOn;
  const accept = scansOn ? `${ACCEPT},${PHOTOS}` : ACCEPT;
  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(flowId, file),
    onSuccess: (d) => { setProblem(null); onUploaded(d); },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function pick(file: File | undefined) {
    if (!file || upload.isPending) return;
    if (!accept.split(",").some((ext) => file.name.toLowerCase().endsWith(ext)))
      return setProblem(documentRefusalMessage(new ApiHttpError("unsupported", 415, { error: "unsupported_format" })));
    if (file.size > MAX_BYTES) return setProblem(documentRefusalMessage(new ApiHttpError("too large", 413, { error: "file_too_large" })));
    upload.mutate(file);
  }

  return (
    <div className="grid gap-3">
      <div
        className={`grid justify-items-center gap-2 rounded-card border border-dashed p-6 text-center ${over ? "border-brand-blue" : "border-borderStrong"}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      >
        <p className="text-[13px] text-ink-muted">{scansOn ? "Drop a PDF, CSV, Excel file or photo (PNG, JPG) here" : "Drop a PDF, CSV or Excel file here"}</p>
        <Button type="button" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
          Choose a file
        </Button>
        <input ref={input} type="file" hidden accept={accept} aria-label="Choose a file"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
    </div>
  );
}
