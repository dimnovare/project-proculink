"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileDrop } from "@/components/flows/FileDrop";
import { DraftReview } from "@/components/flows/DraftReview";
import { OutputEditor } from "@/components/flows/OutputEditor";
import { outputFromDocumentation, outputFromSample } from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { nextTabIndex } from "@/lib/tabKeys";

const ALL_TABS = [["own", "Build your own"], ["sample", "From a sample"], ["docs", "From documentation"]] as const;
const SAMPLE_BYTES = 2 * 1024 * 1024;
const DOCS_BYTES = 10 * 1024 * 1024;

/** The ways to make an output: by hand, or from a sample file the receiving system expects. */
export function OutputBuilder({ flow, previewDocumentId, onDone }: { flow: Flow; previewDocumentId?: string; onDone(): void }) {
  const TABS = ALL_TABS.filter(([t]) => t !== "docs" || flow.docsOutputsOn);
  const [tab, setTab] = useState<(typeof ALL_TABS)[number][0]>("own");
  const [created, setCreated] = useState<FlowOutput | null>(null);
  const sample = useMutation({ mutationFn: (file: File) => outputFromSample(flow.id, file) });
  const docs = useMutation({ mutationFn: (file: File) => outputFromDocumentation(flow.id, file) });

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
