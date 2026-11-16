"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { FileDrop } from "@/components/flows/FileDrop";
import { DraftReview } from "@/components/flows/DraftReview";
import { FORMATS } from "@/components/flows/OutputEditor";
import { createOutput, outputFromDocumentation, outputFromSample } from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { defaultWidth, fromSimple } from "@/lib/flowOutputModel";
import { STANDARDS, type StandardSupport } from "@/lib/standards/catalog";
import { FLAGGED, STANDARD_OUTPUTS, WRITTEN_VERSION } from "@/lib/standardOutputs";
import { useOnFlowPage } from "./flowDraft";
import { barPending } from "./PublishBar";

type Way = "quick" | "sample" | "docs" | "standards";
const OFFERED = STANDARDS.filter((s) => (STANDARD_OUTPUTS as readonly string[]).includes(s.id));
const SAMPLE_BYTES = 2 * 1024 * 1024;
const DOCS_BYTES = 10 * 1024 * 1024;
const LINK = "inline-flex min-h-11 items-center text-[14px] font-semibold text-brand-blue-deep underline";

type Props = {
  flow: Flow; previewDocumentId?: string; onDone(): void; onCreated(output: FlowOutput): void;
  /** R9: the kind read from this flow's latest document, e.g. "Invoice"; null when not known. */
  kind: string | null;
  /** The flow has no file yet: the panel says "Make a file", as the button that opened it does. */
  first?: boolean;
};

/** A CSV of every value we read, ticked; one press makes it (R7). */
function QuickFile({ flow, title, onDone, onCreated, refresh }: Props & { title: string; refresh(): void }) {
  const onFlowPage = useOnFlowPage();
  const [name, setName] = useState(`${flow.name} CSV`);
  const [format, setFormat] = useState("csv");
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const table = flow.fields.tables[0];
  const values = [
    ...flow.fields.fields.map((f) => ({ id: f.key, key: f.key, label: f.label })),
    ...(table?.columns ?? []).map((c) => ({ id: `${table.key}/${c.key}`, key: c.key, label: c.label })),
  ];
  const ticked = (id: string) => !off.has(id);
  const create = useMutation({
    mutationFn: () => {
      const row = (v: { key: string; label: string }) => ({ name: v.label, source: { field: v.key }, width: defaultWidth(v.label) });
      const fields = flow.fields.fields.filter((f) => ticked(f.key)).map(row);
      const columns = (table?.columns ?? []).filter((c) => ticked(`${table.key}/${c.key}`)).map(row);
      const tableKey = columns.length ? table.key : null;
      return createOutput(flow.id, {
        name: name.trim(), format, tableKey, destinationId: null,
        template: fromSimple({ fields, table: tableKey ? { key: tableKey, columns } : null }, format),
      });
    },
    onSuccess: (saved) => { refresh(); onCreated(saved); },
  });
  const press = () => {
    const why = !name.trim() ? "Give this file a name." : !values.some((v) => ticked(v.id)) ? "Tick at least one value." : null;
    setProblem(why);
    if (!why) create.mutate();
  };
  const flip = (id: string) => setOff((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  return (
    <Card edge="green">
      <div className="grid gap-3">
        <div className="grid gap-0.5">
          <h2 className="m-0 text-[16px] font-semibold text-ink">{title}</h2>
          <p className="m-0 text-[14px] text-ink-muted">A CSV file with every value we read. Untick what you don&apos;t need.</p>
        </div>
        <Field label="Name"><input className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="File type">
          <select className={INPUT} value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(FORMATS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <section className="grid gap-1">
          <h3 className="m-0 text-[14px] font-semibold text-ink">In the file ({values.filter((v) => ticked(v.id)).length})</h3>
          {values.length === 0 ? <p className="m-0 text-[14px] text-ink-muted">No values yet</p> : (
            <ul className="m-0 grid list-none gap-0 p-0 sm:grid-cols-2">
              {values.map((v) => (
                <li key={v.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-ink">
                    <input type="checkbox" className="h-4 w-4" aria-label={`Put ${v.label} in the file`} checked={ticked(v.id)} onChange={() => flip(v.id)} />
                    {v.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        {(problem || create.isError) && <StatusNotice tone="error">{problem ?? documentRefusalMessage(create.error)}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button variant={onFlowPage && barPending(flow) ? "secondary" : "primary"} loading={create.isPending} disabled={create.isSuccess} onClick={press}>
            Create
          </Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

/** The ways to make a file: a ready CSV first; a sample, documentation or a standard format one link away. */
export function OutputBuilder(props: Props) {
  const { flow, previewDocumentId, onCreated, first } = props;
  const [way, setWay] = useState<Way>("quick");
  const title = first ? "Make a file" : "Make another file";
  const sample = useMutation({ mutationFn: (file: File) => outputFromSample(flow.id, file) });
  const docs = useMutation({ mutationFn: (file: File) => outputFromDocumentation(flow.id, file) });
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); };
  const standard = useMutation({
    mutationFn: (s: StandardSupport) =>
      createOutput(flow.id, { name: s.name, format: "", standard: s.id, tableKey: flow.fields.tables[0]?.key ?? null, destinationId: null }),
    onSuccess: (saved) => { refresh(); onCreated(saved); },
  });

  if (way === "quick")
    return (
      <div className="grid gap-3">
        <QuickFile {...props} title={title} refresh={refresh} />
        <div className="flex flex-wrap items-center gap-x-4 px-1">
          <span className="text-[14px] text-ink-muted">Need a set layout?</span>
          <button type="button" className={LINK} onClick={() => setWay("sample")}>Match a sample file</button>
          {flow.docsOutputsOn && <button type="button" className={LINK} onClick={() => setWay("docs")}>From documentation</button>}
          <button type="button" className={LINK} onClick={() => setWay("standards")}>A standard format</button>
        </div>
      </div>
    );

  return (
    <div className="grid gap-3">
      <div><button type="button" className={LINK} onClick={() => setWay("quick")}>{title}</button></div>
      {way === "standards" ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-ink-muted">Pick a standard file. We fill it in from what each of your fields means.</p>
          {standard.isError && <StatusNotice tone="error">{documentRefusalMessage(standard.error)}</StatusNotice>}
          {OFFERED.filter((s) => !FLAGGED.has(s.id) || flow.peppolOn).map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-ink">{s.name} <span className="text-ink-muted">{WRITTEN_VERSION[s.id] ?? s.version}</span></span>
              <Button size="sm" variant="secondary" aria-label={`Use ${s.name}`} disabled={standard.isPending}
                loading={standard.isPending && standard.variables?.id === s.id} onClick={() => standard.mutate(s)}>Use</Button>
            </div>
          ))}
        </div>
      ) : way === "docs" ? (
        docs.data ? (
          <DraftReview flow={flow} draft={docs.data} requireTest previewDocumentId={previewDocumentId} onCreated={onCreated} onRestart={docs.reset} />
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
        <DraftReview flow={flow} draft={sample.data} previewDocumentId={previewDocumentId} onCreated={onCreated} onRestart={sample.reset} />
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
  );
}
