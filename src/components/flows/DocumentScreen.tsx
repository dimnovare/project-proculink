"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { Button } from "@/components/bridge/DSPrimitives";
import { SourceDocumentBody } from "@/components/bridge/document/SourceDocumentBody";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { fetchDocumentSource, getDocument, getDocumentHistory, retryDocumentRead } from "@/lib/api/documents";
import { formatDateTime } from "@/lib/format-date";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import type { DocumentDetail } from "@/lib/api/documents";
import { DocumentOutputsPanel } from "./DocumentOutputsPanel";
import { ReadValuesPanel } from "./ReadValuesPanel";
import { Checks, Failed, Quiet, ReadProblem } from "./states";

// The file's own extension decides the viewer. The server's content type is not trusted for this.
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** `document.value_edited` becomes "Value edited". The payload is never shown. */
const actionWords = (action: string) => {
  const words = action.replace(/^document\./, "").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const SOURCES = new Map([
  ["upload", "upload"], ["email", "email"], ["api", "the API"], ["imap", "mailbox"],
  ["sftp", "SFTP"], ["ftp", "FTP"], ["ftps", "FTPS"], ["s3", "S3"],
]);

function History({ documentId }: { documentId: string }) {
  const enabled = useTenantQueriesEnabled();
  const history = useQuery({ queryKey: ["document-history", documentId], queryFn: () => getDocumentHistory(documentId), enabled });
  return (
    <details className="text-[12.5px]">
      <summary className="cursor-pointer font-medium text-ink">History</summary>
      {history.isError ? <p className="m-0 mt-2 text-ink-muted">{documentRefusalMessage(history.error)}</p> : (
        <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-ink-muted">
          {!history.data ? <li>Loading…</li> : history.data.length === 0 ? <li>No changes yet.</li> : history.data.map((h, i) => (
            <li key={i}>{formatDateTime(h.at)} · {actionWords(h.action)}</li>
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
    queryKey: ["document", documentId], enabled,
    queryFn: async () => {
      const prev = qc.getQueryData<DocumentDetail>(["document", documentId]);
      const next = await getDocument(documentId);
      // A status change means the worker did something: the deliveries and history beside it are stale.
      if (prev && prev.summary.status !== next.summary.status)
        for (const k of ["deliveries", "document-history"]) qc.invalidateQueries({ queryKey: [k, documentId] });
      return next;
    },
    refetchInterval: (q) => {
      const d = q.state.data?.summary;
      return d && documentStatus(d.status, d.statusReason).tone === "working" ? 2000 : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => retryDocumentRead(documentId),
    onSuccess: () => Promise.all(["document", "document-history"].map((k) => qc.invalidateQueries({ queryKey: [k, documentId] }))),
  });

  const summary = doc.data?.summary;
  const status = summary && documentStatus(summary.status, summary.statusReason);
  const nothingRead = !doc.data || doc.data.read.fields.length + doc.data.read.tables.length === 0;

  return (
    <PageShell variant="wide">
      <PageHeader
        titleHidden title="Flow document"
        actions={<Link href={`/flows/${summary?.flowId ?? flowId}`} className="text-[13px] text-brand-blue">Back to flow</Link>}
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
            <p className="m-0 mt-1 text-[12.5px] text-ink-muted">
              Arrived by {SOURCES.get(summary.source) ?? summary.source}{summary.sourceRef ? ` from ${summary.sourceRef}` : ""}
            </p>
            <div className="mt-3">
              <ReadProblem summary={summary} nothingRead={nothingRead} retry={retry} />
            </div>
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
              {nothingRead ? (
                <div className="grid gap-3">
                  <Quiet>
                    {summary.status === "sending" ? "Sending…" : status.tone === "working" ? "Reading the document…" : "Nothing was read from this document."}
                  </Quiet>
                  {summary.statusReason !== "duplicate_file" && <Checks checks={doc.data.checks} />}
                </div>
              ) : (
                <ReadValuesPanel detail={doc.data} editable={status.editable} />
              )}
              <div className="mt-4"><History documentId={documentId} /></div>
            </Card>
            <div className="min-w-0"><DocumentOutputsPanel flowId={summary.flowId} document={doc.data} /></div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
