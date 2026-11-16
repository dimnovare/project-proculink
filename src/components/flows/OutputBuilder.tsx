"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
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
import { STANDARD_OUTPUTS, kindGroup, standardFamilies } from "@/lib/standardOutputs";
import { and } from "@/lib/flowSentences";
import { flowAddress } from "@/lib/flowSteps";
import { FlowLink, useOnFlowPage } from "./flowDraft";
import { barPending } from "./PublishBar";

type Way = "quick" | "sample" | "docs" | "standards";
const OFFERED = STANDARDS.filter((s) => (STANDARD_OUTPUTS as readonly string[]).includes(s.id));
const SAMPLE_BYTES = 2 * 1024 * 1024;
const DOCS_BYTES = 10 * 1024 * 1024;
const LINK = "inline-flex min-h-11 items-center text-[14px] font-semibold text-brand-blue-deep underline";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** A closed line that opens a list in place; opening moves focus to the list's first button. */
function Fold({ label, line, children }: { label: string; line: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) body.current?.querySelector("button")?.focus(); }, [open]);
  return (
    <div className="grid gap-2 border-t border-border pt-1">
      <div className="flex flex-wrap items-center gap-x-3">
        <button type="button" className={`${LINK} gap-1`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight size={16} aria-hidden className={open ? "rotate-90" : undefined} />{label}
        </button>
        <span className="text-[13px] text-ink-muted">{line}</span>
      </div>
      {open && <div ref={body} className="grid gap-2">{children}</div>}
    </div>
  );
}

type Props = {
  flow: Flow; previewDocumentId?: string; onDone(): void; onCreated(output: FlowOutput): void;
  /** R9: the kind read from this flow's latest document, e.g. "Invoice"; null when not known. */
  kind: string | null;
  /** The flow has no file yet: the panel says "Make a file", as the button that opened it does. */
  first?: boolean;
  /** The names of the flow's files, so the prefilled name is not one of them. */
  names?: readonly string[];
};

const NAME_MAX = 120;
const TICK = "Tick at least one value.";
/** "{flow name} {type}", then " 2", " 3"… while taken; the flow's name is cut so the whole name fits the box. */
function prefilledName(flowName: string, type: string, taken: readonly string[] = []) {
  for (let n = 1; ; n++) {
    const tail = ` ${type}${n > 1 ? ` ${n}` : ""}`;
    const name = `${flowName.slice(0, NAME_MAX - tail.length).trimEnd()}${tail}`;
    if (!taken.includes(name)) return name;
  }
}

/** What the person chose in the ready panel; kept while they look at another way. `name` is null until they type one. */
type Pick = { name: string | null; format: string; off: Set<string> };

/** A CSV of every value we read, ticked; one press makes it (R7). */
function QuickFile({ flow, title, onDone, made, names, pick, setPick }: Props & {
  title: string; made(saved: FlowOutput): void; pick: Pick; setPick(p: Pick): void;
}) {
  const onFlowPage = useOnFlowPage();
  const { format, off } = pick;
  const type = FORMATS[format as keyof typeof FORMATS] ?? format;
  const name = pick.name ?? prefilledName(flow.name, type, names);
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
    onSuccess: made,
    onError: () => { sent.current = false; },
  });
  // One request per press, even when a second press lands before the button has turned busy.
  const sent = useRef(false);
  const press = () => {
    if (sent.current) return;
    const why = !name.trim() ? "Give this file a name." : !values.some((v) => ticked(v.id)) ? TICK : null;
    setProblem(why);
    if (!why) { sent.current = true; create.mutate(); }
  };
  const flip = (id: string) => {
    const n = new Set(off);
    if (!n.delete(id)) n.add(id);
    setPick({ ...pick, off: n });
    if (problem === TICK) setProblem(null);
  };
  const line = `${/^[AEIOX]/.test(type) ? "An" : "A"} ${type} file with every value we read. Untick what you don't need.`;

  return (
    <Card edge="green">
      <div className="grid gap-3">
        <div className="grid gap-0.5">
          <h2 className="m-0 text-[16px] font-semibold text-ink">{title}</h2>
          <p className="m-0 text-[14px] text-ink-muted">{line}</p>
        </div>
        <Field label="Name">
          <input className={INPUT} maxLength={NAME_MAX} value={name} onChange={(e) => setPick({ ...pick, name: e.target.value })} />
        </Field>
        <Field label="File type">
          <select className={INPUT} value={format} onChange={(e) => setPick({ ...pick, format: e.target.value })}>
            {Object.entries(FORMATS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <section className="grid gap-1">
          <h3 className="m-0 text-[14px] font-semibold text-ink">In the file ({values.filter((v) => ticked(v.id)).length})</h3>
          {values.length === 0 ? (
            <p className="m-0 text-[14px] text-ink-muted">
              We list the values here once this flow has read a document.{" "}
              <FlowLink href={flowAddress(flow.id, "documents")} className={LINK}>Go to Documents</FlowLink>
            </p>
          ) : (
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
          {flow.fields.tables.length > 1 && (
            <p className="m-0 text-[14px] text-ink-muted">
              Rows come from the table {table.label}. You can choose another table after the file is made.
            </p>
          )}
        </section>
        {(problem || create.isError) && <StatusNotice tone="error">{problem ?? documentRefusalMessage(create.error)}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={onFlowPage && barPending(flow) ? "secondary" : "primary"} loading={create.isPending}
            disabled={create.isSuccess || values.length === 0} onClick={press}
          >
            Create
          </Button>
          <Button variant="ghost" disabled={create.isPending} onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

/** The ways to make a file: a ready CSV first; a sample, documentation or a standard format one link away. */
export function OutputBuilder(props: Props) {
  const { flow, previewDocumentId, onCreated, first } = props;
  const [way, setWay] = useState<Way>("quick");
  const [pick, setPick] = useState<Pick>(() => ({ name: null, format: "csv", off: new Set() }));
  const title = first ? "Make a file" : "Make another file";
  const sample = useMutation({ mutationFn: (file: File) => outputFromSample(flow.id, file) });
  const docs = useMutation({ mutationFn: (file: File) => outputFromDocumentation(flow.id, file) });
  const qc = useQueryClient();
  // Every way ends here: the saved file goes into the list before the list is asked for again, then it opens.
  const made = (saved: FlowOutput) => {
    qc.setQueryData<FlowOutput[]>(["outputs", flow.id], (l) => l && [...l.filter((o) => o.id !== saved.id), saved]);
    qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
    qc.invalidateQueries({ queryKey: ["flow", flow.id] });
    onCreated(saved);
  };
  const standard = useMutation({
    mutationFn: (s: StandardSupport) =>
      createOutput(flow.id, { name: s.name, format: "", standard: s.id, tableKey: flow.fields.tables[0]?.key ?? null, destinationId: null }),
    onSuccess: made,
    onError: () => { using.current = false; },
  });
  // One request per press, as Create: a second press can land before the button has turned busy.
  const using = useRef(false);
  const use = (s: StandardSupport) => { if (using.current) return; using.current = true; standard.mutate(s); };
  // Switching ways: the opened panel's heading takes focus; going back returns it to the link that opened the panel.
  const heading = useRef<HTMLHeadingElement>(null);
  const links = useRef<Partial<Record<Way, HTMLButtonElement | null>>>({});
  const from = useRef<{ way: Way; moved: boolean }>({ way: "quick", moved: false });
  const go = (w: Way) => { from.current = { way: w === "quick" ? from.current.way : w, moved: true }; setWay(w); };
  useEffect(() => {
    if (!from.current.moved) return;
    from.current.moved = false;
    (way === "quick" ? links.current[from.current.way] : heading.current)?.focus();
  }, [way]);
  const opener = (w: Way, label: string) => (
    <button type="button" className={LINK} ref={(el) => { links.current[w] = el; }} onClick={() => go(w)}>{label}</button>
  );
  const panelTitle = (text: string) => <h2 ref={heading} tabIndex={-1} className="m-0 text-[16px] font-semibold text-ink">{text}</h2>;

  // A standard format (R9, R10): one row per family, the group that fits this flow's documents first, the rest folded.
  const fams = standardFamilies(flow.peppolOn);
  const group = kindGroup(props.kind);
  const fit = group && fams[group].length ? group : null;
  const other = fit ? fams[fit === "invoices" ? "orders" : "invoices"] : [];
  const twins = fams.invoices.flatMap((f) => (f.creditNote ? [f.creditNote] : []));
  const row = (id: string, line: string | null, name?: string, invoice = false) => {
    const s = OFFERED.find((x) => x.id === id)!;
    name ??= s.name;
    return (
      <div key={id} className="flex items-center justify-between gap-3">
        <div className="grid">
          <span className="text-[14px] font-semibold text-ink">{name}{invoice && <span className="text-[13px] font-normal text-ink-muted"> invoice</span>}</span>
          {line && <span className="text-[13px] text-ink-muted">{line}</span>}
        </div>
        <Button size="sm" variant="secondary" aria-label={`Use ${name}`} disabled={standard.isPending}
          loading={standard.isPending && standard.variables?.id === id} onClick={() => use(s)}>Use</Button>
      </div>
    );
  };
  // The credit-note versions belong to the invoice families: in an orders flow they sit with them, inside "Other standards".
  const credit = twins.length > 0 && (
    <Fold label={`Credit note versions (${twins.length})`} line={`The same ${WORDS[twins.length] ?? twins.length}, for credit notes.`}>
      {OFFERED.filter((s) => twins.includes(s.id)).map((s) => row(s.id, s.version))}
    </Fold>
  );
  const famRows = (list: typeof fams.invoices) => list.map((f) => row(f.id, f.description ?? f.version, f.name, fams.invoices.includes(f)));

  if (way === "quick")
    return (
      <div className="grid gap-3">
        <QuickFile {...props} title={title} made={made} pick={pick} setPick={setPick} />
        <div className="flex flex-wrap items-center gap-x-4 px-1">
          <span className="text-[14px] text-ink-muted">Need a set layout?</span>
          {opener("sample", "Match a sample file")}
          {flow.docsOutputsOn && opener("docs", "From documentation")}
          {opener("standards", "A standard format")}
        </div>
      </div>
    );

  return (
    <div className="grid gap-3">
      <div><button type="button" className={LINK} aria-label={`Back to ${title}`} onClick={() => go("quick")}>{title}</button></div>
      {way === "standards" ? (
        <div className="grid gap-3">
          <div className="grid gap-0.5">
            {panelTitle("A standard format")}
            <p className="m-0 text-[14px] text-ink-muted">We fill it in from what we read. Choose the one your receiver asked for.</p>
          </div>
          {standard.isError && <StatusNotice tone="error">{documentRefusalMessage(standard.error)}</StatusNotice>}
          {fit ? (
            <section className="grid gap-2">
              <h3 className="m-0 text-[14px] font-semibold text-ink">
                {fit === "invoices" ? "For invoices and credit notes" : "For orders"}, like the documents in this flow
              </h3>
              {famRows(fams[fit])}
            </section>
          ) : famRows([...fams.invoices, ...fams.orders])}
          {fit !== "orders" && credit}
          {other.length > 0 && (
            <Fold label={`Other standards (${other.length})`} line={`For ${fit === "invoices" ? "orders" : "invoices"}: ${and(other.map((f) => f.name))}.`}>
              {famRows(other)}
              {fit === "orders" && credit}
            </Fold>
          )}
        </div>
      ) : way === "docs" ? (
        docs.data ? (
          <>
            {panelTitle("From documentation")}
            <DraftReview flow={flow} draft={docs.data} requireTest previewDocumentId={previewDocumentId} onCreated={made} onRestart={docs.reset} />
          </>
        ) : (
          <div className="grid gap-3">
            {panelTitle("From documentation")}
            <p className="m-0 text-[14px] text-ink-muted">{COPY.docs_lead}</p>
            <FileDrop
              accept=".pdf,.html,.htm,.json,.yaml,.yml,.xsd,.xml,.txt,.csv" maxBytes={DOCS_BYTES} prompt="Drop the documentation here, or choose a file."
              busyLabel="Reading the documentation…" busy={docs.isPending} error={docs.isError ? documentRefusalMessage(docs.error) : null}
              onFile={docs.mutate}
            />
          </div>
        )
      ) : sample.data ? (
        <>
          {panelTitle("Match a sample file")}
          <DraftReview flow={flow} draft={sample.data} previewDocumentId={previewDocumentId} onCreated={made} onRestart={sample.reset} />
        </>
      ) : (
        <div className="grid gap-3">
          {panelTitle("Match a sample file")}
          <p className="m-0 text-[14px] text-ink-muted">Upload an example of the file the receiving system expects: CSV, Excel, JSON or XML.</p>
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
