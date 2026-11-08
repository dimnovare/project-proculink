"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { MapperWorkbench, type MapperToolbarState } from "@/components/bridge/mapper/MapperWorkbench";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { fetchDocumentSource, getDocument, getFlow, listDocuments, listOutputs } from "@/lib/api/documents";
import type { FlowOutput } from "@/lib/api/documents";
import type { IncomingView } from "@/lib/sourceDocument";
import { Original } from "../DocumentScreen";
import { Failed, Quiet } from "../states";
import { flowMapperAdapter } from "./flowMapperAdapter";

export function AdvancedView({ flowId, outputId, documentId }: { flowId: string; outputId: string; documentId?: string | null }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const [incomingView, setIncomingView] = useState<IncomingView>("fields");
  // The toolbar is hidden, so its save status is re-hosted beside "Back to flow".
  const [bar, setBar] = useState<MapperToolbarState | null>(null);
  const flow = useQuery({ queryKey: ["flow", flowId], queryFn: () => getFlow(flowId), enabled });
  const outputs = useQuery({ queryKey: ["outputs", flowId], queryFn: () => listOutputs(flowId), enabled });
  const newest = useQuery({
    queryKey: ["documents", { flowId, take: 1 }], queryFn: () => listDocuments({ flowId, take: 1 }), enabled: enabled && !documentId,
  });
  const id = documentId || newest.data?.[0]?.id || null;
  const doc = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id!), enabled: enabled && !!id });
  const source = useQuery({ queryKey: ["document-source", id], queryFn: () => fetchDocumentSource(id!), enabled: enabled && !!id });

  const output = outputs.data?.find((o) => o.id === outputId);
  const read = doc.data?.read ?? null;
  const adapter = useMemo(
    () =>
      flow.data && output && !newest.isLoading && !(id && doc.isLoading)
        ? flowMapperAdapter({
            flow: flow.data, output, documentId: id, read,
            onSaved: (saved: FlowOutput) =>
              qc.setQueryData<FlowOutput[]>(["outputs", flowId], (list) => list?.map((o) => (o.id === saved.id ? saved : o))),
          })
        : null,
    [flow.data, output, id, read, qc, flowId, newest.isLoading, doc.isLoading],
  );

  const failed = [flow, outputs, newest, doc].find((q) => q.isError) ?? null;
  const missing = outputs.data && !output;
  return (
    <PageShell variant="wide">
      <PageHeader
        titleHidden title={output?.name ?? "Advanced view"} sub="Advanced view"
        actions={
          <span className="inline-flex items-center gap-3 text-[12px]">
            {bar?.saving ? <span className="text-ink-faint">Saving…</span>
              : bar?.error ? <span role="alert" className="text-danger">{bar.error}</span>
              : bar?.justSaved ? <span role="status" className="text-brand-green-deep">✓ Saved</span>
              : null}
            <Link href={`/flows/${flowId}`} className="text-[13px] text-brand-blue">Back to flow</Link>
          </span>
        }
      />
      <div className="lg:hidden">
        <StatusNotice tone="working">The Advanced view needs a wider screen. On this device, use the document page.</StatusNotice>
      </div>
      <div className="hidden lg:block">
        {failed ? <Failed error={failed.error} retry={() => failed.refetch()} />
          : missing ? <Quiet>This output no longer exists.</Quiet>
          : !adapter || !output ? <Quiet>Loading…</Quiet>
          : (
            <div data-testid="advanced-workbench">
              <MapperWorkbench
                variant="flow" adapter={adapter} supplierName={output.name} hideToolbar hideOrientation onToolbarState={setBar}
                emptyHint="Upload a document to this flow to see a preview."
                layout={{ incomingView, onIncomingView: setIncomingView }}
                receivedDocument={{
                  slot: id && doc.data ? <Original documentId={id} fileName={doc.data.summary.fileName} /> : null,
                  available: !!source.data && source.data.size > 0,
                  formatLabel: doc.data?.summary.fileName.split(".").pop()?.toUpperCase() ?? null,
                }}
              />
            </div>
          )}
      </div>
    </PageShell>
  );
}
