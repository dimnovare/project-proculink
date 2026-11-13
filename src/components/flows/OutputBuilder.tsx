"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { FileDrop } from "@/components/flows/FileDrop";
import { DraftReview } from "@/components/flows/DraftReview";
import { OutputEditor } from "@/components/flows/OutputEditor";
import { createOutput, outputFromDocumentation, outputFromSample } from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { nextTabIndex } from "@/lib/tabKeys";
import { STANDARDS, type StandardSupport } from "@/lib/standards/catalog";
import { STANDARD_OUTPUTS, WRITTEN_VERSION } from "@/lib/standardOutputs";

const ALL_TABS = [["own", "Build your own"], ["sample", "From a sample"], ["docs", "From documentation"], ["standards", "Standards"]] as const;
const OFFERED = STANDARDS.filter((s) => (STANDARD_OUTPUTS as readonly string[]).includes(s.id));
const SAMPLE_BYTES = 2 * 1024 * 1024;
const DOCS_BYTES = 10 * 1024 * 1024;

/** The ways to make an output: by hand, from a sample or documentation of the file the receiving system expects, or as a standard file. */
export function OutputBuilder({ flow, previewDocumentId, onDone }: { flow: Flow; previewDocumentId?: string; onDone(): void }) {
  const TABS = ALL_TABS.filter(([t]) => t !== "docs" || flow.docsOutputsOn);
  const [tab, setTab] = useState<(typeof ALL_TABS)[number][0]>("own");
  const [created, setCreated] = useState<FlowOutput | null>(null);
  const sample = useMutation({ mutationFn: (file: File) => outputFromSample(flow.id, file) });
  const docs = useMutation({ mutationFn: (file: File) => outputFromDocumentation(flow.id, file) });
  const qc = useQueryClient();
  const standard = useMutation({
    mutationFn: (s: StandardSupport) =>
      createOutput(flow.id, { name: s.name, format: "", standard: s.id, tableKey: flow.fields.tables[0]?.key ?? null, destinationId: null }),
    onSuccess: (saved) => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); setCreated(saved); },
  });

  if (created)
    return <OutputEditor flow={flow} output={created} previewDocumentId={previewDocumentId} onSaved={onDone} onCancel={onDone} />;

  const onTabKey = (e: React.KeyboardEvent) => {
    const to = nextTabIndex(e.key, TABS.findIndex(([t]) => `output-tab-${t}` === e.currentTarget.id), TABS.length);
    if (to === undefined) return;
    e.preventDefault();
    setTab(TABS[to][0]);
    document.getElementById(`output-tab-${TABS[to][0]}`)?.focus();
  };

  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Ways to make an output" className="flex gap-1 border-b border-border">
        {TABS.map(([t, label]) => (
          <button
            key={t} type="button" role="tab" id={`output-tab-${t}`} aria-controls="output-panel" aria-selected={t === tab}
            tabIndex={t === tab ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] ${t === tab ? "border-b-2 border-brand-blue font-semibold" : "text-ink-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="output-panel" aria-labelledby={`output-tab-${tab}`}>
        {tab === "own" ? (
          <OutputEditor flow={flow} previewDocumentId={previewDocumentId} onSaved={onDone} onCancel={onDone} />
        ) : tab === "standards" ? (
          <div className="grid gap-3">
            <p className="text-[13px] text-ink-muted">Pick a standard file. We fill it in from what each of your fields means.</p>
            {standard.isError && <StatusNotice tone="error">{documentRefusalMessage(standard.error)}</StatusNotice>}
            {OFFERED.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-ink">{s.name} <span className="text-ink-muted">{WRITTEN_VERSION[s.id] ?? s.version}</span></span>
                <Button size="sm" variant="secondary" aria-label={`Use ${s.name}`} disabled={standard.isPending}
                  loading={standard.isPending && standard.variables?.id === s.id} onClick={() => standard.mutate(s)}>Use</Button>
              </div>
            ))}
          </div>
        ) : tab === "docs" ? (
          docs.data ? (
            <DraftReview flow={flow} draft={docs.data} requireTest previewDocumentId={previewDocumentId} onCreated={setCreated} onRestart={docs.reset} />
          ) : (
            <div className="grid gap-3">
              <p className="text-[13px] text-ink-muted">{COPY.docs_lead}</p>
              <FileDrop
                accept=".pdf,.html,.htm,.json,.yaml,.yml,.xsd,.xml,.txt,.csv" maxBytes={DOCS_BYTES} prompt="Drop the documentation here, or choose a file."
                busyLabel="Reading the documentation…" busy={docs.isPending} error={docs.isError ? documentRefusalMessage(docs.error) : null}
                onFile={docs.mutate}
              />
            </div>
          )
        ) : sample.data ? (
          <DraftReview flow={flow} draft={sample.data} previewDocumentId={previewDocumentId} onCreated={setCreated} onRestart={sample.reset} />
        ) : (
          <div className="grid gap-3">
            <p className="text-[13px] text-ink-muted">Upload an example of the file the receiving system expects: CSV, Excel, JSON or XML.</p>
            <FileDrop
              accept=".csv,.xlsx,.json,.xml" maxBytes={SAMPLE_BYTES} prompt="Drop a sample here, or choose a file."
              busyLabel="Reading the sample…" busy={sample.isPending} error={sample.isError ? documentRefusalMessage(sample.error) : null}
              onFile={sample.mutate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
