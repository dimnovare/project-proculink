"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { Button } from "@/components/bridge/DSPrimitives";
import { SourceDocumentBody } from "@/components/bridge/document/SourceDocumentBody";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { fetchDocumentSource, getDocument, getDocumentHistory, retryDocumentRead } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";
import { ReadValuesPanel } from "./ReadValuesPanel";

// The file's own extension decides the viewer. The server's content type is not trusted for this.
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const WORKING = ["received", "reading", "sending"];

const Quiet = ({ children }: { children: string }) => (
  <p role="status" className="m-0 text-[13px] text-ink-muted">{children}</p>
);
const Failed = ({ error, retry }: { error: unknown; retry(): void }) => (
  <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={retry}>Retry</Button>}>
    {documentRefusalMessage(error)}
  </StatusNotice>
);

/** `document.value_edited` becomes "Value edited". The payload is never shown. */
const actionWords = (action: string) => {
  const words = action.replace(/^document\./, "").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function History({ documentId }: { documentId: string }) {
  const enabled = useTenantQueriesEnabled();
  const history = useQuery({ queryKey: ["document-history", documentId], queryFn: () => getDocumentHistory(documentId), enabled });
  return (
    <details className="text-[12.5px]">
      <summary className="cursor-pointer font-medium text-ink">History</summary>
      {history.isError ? <p className="m-0 mt-2 text-ink-muted">{documentRefusalMessage(history.error)}</p> : (
        <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-ink-muted">
          {!history.data ? <li>Loading…</li> : history.data.length === 0 ? <li>No changes yet.</li> : history.data.map((h, i) => (
            <li key={i}>{new Date(h.at).toLocaleString()} · {actionWords(h.action)}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Original({ documentId, fileName }: { documentId: string; fileName: string }) {
  const isLg = useLgViewport();
  const enabled = useTenantQueriesEnabled();
  const source = useQuery({ queryKey: ["document-source", documentId], queryFn: () => fetchDocumentSource(documentId), enabled });
  const ext = /\.([^.]*)$/.exec(fileName)?.[1].toLowerCase() ?? "";
  const type = Object.hasOwn(TYPES, ext) ? TYPES[ext] : "application/octet-stream";
  if (source.isPending) return <p className="px-4 pb-4 text-[12.5px] text-ink-muted">Opening the document…</p>;
  if (source.isError || source.data.size === 0)
    return <p className="px-4 pb-4 text-[12.5px] text-ink-muted">The original isn&apos;t available right now.</p>;
  return <SourceDocumentBody cacheKey={documentId} document={{ blob: source.data, contentType: type, filename: fileName }} bounded={isLg} />;
}

export function DocumentScreen({ flowId, documentId }: { flowId: string; documentId: string }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const [showOriginal, setShowOriginal] = useState(true);
  const doc = useQuery({
    queryKey: ["document", documentId], queryFn: () => getDocument(documentId), enabled,
    refetchInterval: (q) => (WORKING.includes(q.state.data?.summary.status ?? "") ? 2000 : false),
  });
  const retry = useMutation({
    mutationFn: () => retryDocumentRead(documentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document", documentId] }),
  });

  const summary = doc.data?.summary;
  const status = summary && documentStatus(summary.status, summary.statusReason);

  return (
    <PageShell variant="wide">
      <PageHeader
        titleHidden title="Flow document"
        actions={<Link href={`/flows/${flowId}`} className="text-[13px] text-brand-blue">Back to flow</Link>}
      />
      {!doc.data || !summary || !status ? (
        doc.isError ? <Failed error={doc.error} retry={() => doc.refetch()} /> : <Quiet>Loading document…</Quiet>
      ) : (
        <div className="grid gap-4">
          {doc.isError && <Failed error={doc.error} retry={() => doc.refetch()} />}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] font-medium text-ink">{summary.fileName}</span>
              <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                <StatusJourney stage={status.stage} compact />
                {status.label}
              </span>
              <Button variant="ghost" size="sm" aria-expanded={showOriginal} onClick={() => setShowOriginal((s) => !s)}>
                {showOriginal ? "Hide original" : "Show original"}
              </Button>
            </div>
            {summary.status === "read_failed" && (
              <div className="mt-3 grid gap-2">
                <StatusNotice
                  tone="error"
                  action={<Button variant="secondary" size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>Try again</Button>}
                >
                  {summary.statusReason ? `We couldn't read this document: ${summary.statusReason.replaceAll("_", " ")}.` : "We couldn't read this document."}
                </StatusNotice>
                {retry.isError && <StatusNotice tone="error">{documentRefusalMessage(retry.error)}</StatusNotice>}
              </div>
            )}
          </Card>
          <div
            className={`grid items-start gap-4 ${
              showOriginal ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]"
            }`}
          >
            <div hidden={!showOriginal} className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
              <Card edge="blue" flush as="section" aria-labelledby="doc-original" className="flex h-full flex-col">
                <h2 id="doc-original" className="px-4 pb-2 pt-3.5 text-[13px] font-semibold text-ink">Original document</h2>
                <Original documentId={documentId} fileName={summary.fileName} />
              </Card>
            </div>
            <Card as="section" aria-labelledby="doc-read" className="min-w-0">
              <h2 id="doc-read" className="mb-3 text-[13px] font-semibold text-ink">What we read</h2>
              {doc.data.read.fields.length + doc.data.read.tables.length === 0 ? (
                <Quiet>
                  {summary.status === "sending" ? "Sending…" : WORKING.includes(summary.status) ? "Reading the document…" : "Nothing was read from this document."}
                </Quiet>
              ) : (
                <ReadValuesPanel detail={doc.data} editable={status.editable} />
              )}
              <div className="mt-4"><History documentId={documentId} /></div>
            </Card>
            <div className="min-w-0"><DocumentOutputsPanel flowId={flowId} document={doc.data} /></div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
