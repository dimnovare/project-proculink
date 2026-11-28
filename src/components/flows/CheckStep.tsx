"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { useLgViewport } from "@/components/bridge/document/useSourceDocument";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { capture } from "@/lib/analytics";
import { ApiHttpError } from "@/lib/api/core";
import { createOutput, getDocument, listDocumentPage, listOutputs, retryDocumentRead, saveFlowFields, updateFlow, type Flow } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { firstRunAddress, foundSummary, PROVISIONAL_FLOW_NAME, suggestFlowName, tableSummary } from "@/lib/firstRun";
import { fieldListFromRead } from "@/lib/flowFieldModel";
import { excelSeparator, shownLabels } from "@/lib/flowOutputModel";
import { editKey, reviewMarks } from "@/lib/reviewMarks";
import { Field, INPUT } from "./DestinationForm";
import { Original, Pane, PaneTabs, UNDER_HEADER } from "./DocumentScreen";
import { needsWords, SAVE_WORDS, VALUE_GRID, ValueInput } from "./ReadValuesPanel";
import { Failed, Gone, ReadProblem, Loading } from "./states";

export const notFound = (e: unknown) => e instanceof ApiHttpError && e.status === 404;

/** Where the document of this run is: its row on the flow's first page (for `isSample`), else unknown. */
export function useRunDocument(flowId: string, docId: string | null) {
  const page = useQuery({
    queryKey: ["documents", "first-run", flowId], enabled: useTenantQueriesEnabled() && !!flowId,
    queryFn: () => listDocumentPage({ flowId, page: 1, pageSize: 20 }),
  });
  const id = docId ?? page.data?.items[0]?.id ?? null;
  const row = page.data?.items.find((r) => r.id === id);
  return { row, isSample: row ? row.isSample : null, docId: id, isLoading: page.isLoading, error: page.error };
}

const PANES = [{ id: "original", title: "Original" }, { id: "read", title: "What we read" }] as const;
const WAY_ON = "inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand-blue sm:min-h-0";

/** Step 2 of first run: what we read beside the original (R11, R12); Next saves the name, the fields and a CSV output (R14). */
export function CheckStep({ flow, docId, first }: { flow: Flow; docId: string | null; first: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const isLg = useLgViewport();
  const enabled = useTenantQueriesEnabled();
  const id = docId ?? "";
  const edits = useDocumentEdits(id);
  const [tab, setTab] = useState<string>("read");
  const [unticked, setDropped] = useState<ReadonlySet<string> | null>(null);
  const doc = useQuery({
    queryKey: ["document", id], queryFn: () => getDocument(id), enabled: enabled && !!docId,
    refetchInterval: (q) => (["received", "reading"].includes(q.state.data?.summary.status ?? "") ? 2000 : false),
  });
  const retry = useMutation({ mutationFn: () => retryDocumentRead(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["document", id] }) });
  const read = doc.data?.read;
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? (flow.name === PROVISIONAL_FLOW_NAME ? suggestFlowName(read?.kindLabel) ?? flow.name : flow.name);
  const status = doc.data && documentStatus(doc.data.summary.status, doc.data.summary.statusReason);
  const editable = !!status?.editable;
  // Back on a confirmed flow, what was unticked stays unticked: the keys of the read that the saved fields lack.
  const dropped = useMemo(() => {
    if (unticked) return unticked;
    const saved = new Set([...flow.fields.fields, ...flow.fields.tables].map((f) => f.key));
    return new Set(flow.fieldsConfirmed && read ? [...read.fields, ...read.tables].map((f) => f.key).filter((k) => !saved.has(k)) : []);
  }, [unticked, flow, read]);
  const marks = useMemo(() => (doc.data?.read ? reviewMarks(doc.data, editable) : null), [doc.data, editable]);

  // R14, in order and each only when needed; a second press while one runs does nothing.
  const pressed = useRef(false);
  const next = useMutation({
    mutationFn: async () => {
      await edits.flush();
      const named = shownName.trim();
      if (named && named !== flow.name) qc.setQueryData(["flow", flow.id], await updateFlow(flow.id, { name: named }));
      const all = fieldListFromRead(read!);
      const kept = { fields: all.fields.filter((f) => !dropped.has(f.key)), tables: all.tables.filter((t) => !dropped.has(t.key)) };
      qc.setQueryData(["flow", flow.id], await saveFlowFields(flow.id, kept));
      if ((await listOutputs(flow.id)).length === 0) await createOutput(flow.id, { name: "CSV file", format: "csv", csvSeparator: excelSeparator() });
    },
    onSuccess: () => {
      for (const queryKey of [["flows"], ["outputs", flow.id]]) void qc.invalidateQueries({ queryKey });
      capture("wizard_step_completed", { step: 2, step_name: "check", first });
      router.push(firstRunAddress({ step: "send", flow: flow.id, doc: id }));
    },
    onError: () => { pressed.current = false; },
  });
  const press = () => { if (!pressed.current) { pressed.current = true; next.mutate(); } };

  const another = <Link href={firstRunAddress({ flow: flow.id })} className={WAY_ON}>Use another file</Link>;
  if (!doc.data) {
    if (notFound(doc.error)) return <Gone text={COPY.document_not_found} />;
    return doc.isError ? <Failed error={doc.error} retry={() => doc.refetch()} /> : <Loading>Loading…</Loading>;
  }
  const { summary } = doc.data;
  if (summary.status === "received" || summary.status === "reading")
    return <Loading>{`Reading ${summary.fileName}… This usually takes under a minute.`}</Loading>;
  const nothingRead = !read || read.fields.length + read.tables.length === 0;
  if (summary.status === "read_failed" || (summary.statusReason === "duplicate_file" && nothingRead))
    return <div className="grid justify-items-start gap-3"><ReadProblem summary={summary} retry={retry} scansOn={flow.scansOn} uploadHref={firstRunAddress({ step: "add", flow: flow.id })} />{another}</div>;
  if (nothingRead || !marks)
    return <div className="grid justify-items-start gap-3"><p className="m-0 text-[14px] text-ink">We couldn&apos;t find any values on this document.</p>{another}</div>;

  const labels = shownLabels(read.fields);
  const keep = (key: string, label: string) => (
    <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center sm:min-h-0 sm:min-w-0">
      <input
        type="checkbox" aria-label={`Keep ${label}`} className="h-5 w-5" checked={!dropped.has(key)}
        onChange={() => setDropped(() => { const n = new Set(dropped); if (!n.delete(key)) n.add(key); return n; })}
      />
    </label>
  );
  return (
    <div className="grid gap-4">
      <PaneTabs panes={PANES} active={tab} onSelect={setTab} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* The original stays in view while a long list of values scrolls past it, as on the review screen. */}
        <Pane id="original" title="Original" dot="blue" hidden={tab !== "original"} sticky={UNDER_HEADER}>
          {(isLg || tab === "original") && <Original documentId={id} fileName={summary.fileName} marks={marks.places} />}
        </Pane>
        <Pane
          id="read" title="What we read" dot="navy" hidden={tab !== "read"}
          aside={editable && <span aria-live="polite" className="text-[12.5px] text-ink-muted">{SAVE_WORDS[edits.state]}</span>}
        >
          <div className="grid gap-4">
            <p className="m-0 text-[14px] font-semibold text-ink">{foundSummary(read)}</p>
            <div className="grid gap-1">
              <Field label="Flow name">
                <input className={INPUT} maxLength={120} value={shownName} onChange={(e) => setName(e.target.value)} />
              </Field>
              <p className="m-0 text-[12.5px] text-ink-muted">We named it from what we read. Change it if you like.</p>
            </div>
            <p className="m-0 text-[13px] text-ink">
              We&apos;ll read these from every document in this flow. Untick any you don&apos;t need, and click a value to correct it.
            </p>
            {marks.count > 0 && <p className="m-0 text-[13px] text-ink">{needsWords(marks.count)}</p>}
            {edits.refusal && <StatusNotice tone="error">{edits.refusal}</StatusNotice>}
            <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" disabled={!editable}>
              <legend className="sr-only">What we read</legend>
              {/* Side by side as on the review screen, so a long read is not one tall column (A-27). */}
              <div className={VALUE_GRID}>
              {read.fields.map((f) => (
                <div key={f.key} data-testid={`check-value-${f.key}`} className="flex items-start gap-3">
                  {keep(f.key, labels.get(f.key)!)}
                  <div className="min-w-0 flex-1">
                    <Field label={labels.get(f.key)!} look={marks.looks.get(editKey({ field: f.key }))?.text}>
                      <ValueInput target={{ field: f.key }} value={f.value} edits={edits} kind={f} />
                    </Field>
                  </div>
                </div>
              ))}
              </div>
              {read.tables.map((t) => (
                <div key={t.key} data-testid={`check-table-${t.key}`} className="flex items-start gap-3">
                  {keep(t.key, t.label)}
                  <div className="grid gap-0.5">
                    <span className="text-[13px] font-semibold text-ink">{t.label}</span>
                    <span className="text-[12.5px] text-ink-muted">{tableSummary(t)}</span>
                  </div>
                </div>
              ))}
            </fieldset>
          </div>
        </Pane>
      </div>
      <div className="sticky bottom-0 grid gap-2 border-t border-border bg-bg py-3">
        {next.isError && !edits.refusal && <StatusNotice tone="error">{documentRefusalMessage(next.error)}</StatusNotice>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[13px] text-ink-muted">You&apos;ll get a spreadsheet file (CSV) with these columns. You can change this later.</p>
          <div className="flex flex-wrap items-center gap-4">
            {another}
            <Button variant="primary" disabled={next.isPending} loading={next.isPending} onClick={press}>Looks right, next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
