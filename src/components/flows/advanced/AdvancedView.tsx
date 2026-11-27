"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import { flowAddress } from "@/lib/flowSteps";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MapperWorkbench, type MapperToolbarState } from "@/components/bridge/mapper/MapperWorkbench";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { fetchDocumentSource, getDocument, getFlow, listDocuments, listOutputs } from "@/lib/api/documents";
import type { FlowOutput } from "@/lib/api/documents";
import type { IncomingView } from "@/lib/sourceDocument";
import { Original } from "../DocumentScreen";
import { Failed, Quiet, Loading } from "../states";
import { flowMapperAdapter } from "./flowMapperAdapter";

// Below 1440 px the three panes do not fit side by side, so the live preview starts as a rail
// that opens on click (V-02). Server and jsdom read "wide", so tests see all three panes.
const NARROW = "(max-width: 1439px)";
function useNarrow() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(NARROW); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

export function AdvancedView({ flowId, outputId, documentId }: { flowId: string; outputId: string; documentId?: string | null }) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const [incomingView, setIncomingView] = useState<IncomingView>("fields");
  // The toolbar is hidden, so its save status is re-hosted in the page header's actions.
  const [bar, setBar] = useState<MapperToolbarState | null>(null);
  const narrow = useNarrow();
  const [previewOpen, setPreviewOpen] = useState<boolean | null>(null);
  const preview = (previewOpen ?? !narrow) ? "1fr" : "rail";
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
            onSaved: (saved: FlowOutput) => {
              qc.setQueryData<FlowOutput[]>(["outputs", flowId], (list) => list?.map((o) => (o.id === saved.id ? saved : o)));
              qc.invalidateQueries({ queryKey: ["flow", flowId] });
            },
          })
        : null,
    [flow.data, output, id, read, qc, flowId, newest.isLoading, doc.isLoading],
  );

  const failed = [flow, outputs, newest, doc].find((q) => q.isError) ?? null;
  const missing = outputs.data && !output;
  return (
    <PageShell variant="wide">
      <PageHeader
        title={output?.name ?? "Advanced view"}
        sub="Advanced view. Map this file field by field."
        back={{ href: `/flows/${flowId}`, label: flow.data?.name ?? "Flow" }}
        actions={
          <span className="inline-flex items-center gap-3 text-[12px]">
            {bar?.saving ? <span className="text-ink-faint">Saving…</span>
              : bar?.error ? <span role="alert" className="text-danger">{bar.error}</span>
              : bar?.justSaved ? <span role="status" className="text-brand-green-deep">✓ Saved</span>
              : null}
          </span>
        }
      />
      <div className="lg:hidden flex justify-center py-10">
        <Card className="w-full max-w-[420px] text-center">
          <p className="text-[15px] font-semibold text-ink">The Advanced view needs a wider screen.</p>
          <p className="mt-2 text-[13px] text-ink-muted">You can change this file on the flow&apos;s We send step.</p>
          <Link href={flowAddress(flowId, "send", { output: outputId })} className={`${buttonClass("secondary", "md")} mt-5`}>Back to We send</Link>
        </Card>
      </div>
      <div className="hidden lg:block">
        {failed ? <Failed error={failed.error} retry={() => failed.refetch()} />
          : missing ? <Quiet>This file no longer exists.</Quiet>
          : output?.standard ? <Quiet>This file follows a standard, so there is nothing to map.</Quiet>
          : !adapter || !output ? <Loading>Loading…</Loading>
          : (
            <div data-testid="advanced-workbench">
              <MapperWorkbench
                variant="flow" adapter={adapter} supplierName={output.name} hideToolbar hideOrientation onToolbarState={setBar}
                emptyHint="Upload a document to this flow to see a preview."
                layout={{
                  incomingView, onIncomingView: setIncomingView, preview,
                  onExpandPreview: () => setPreviewOpen(true), onCollapsePreview: () => setPreviewOpen(false),
                }}
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
