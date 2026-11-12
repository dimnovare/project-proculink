"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { DestinationForm, Field, INPUT } from "@/components/flows/DestinationForm";
import { FORMATS } from "@/components/flows/OutputEditor";
import { createOutput, listDestinations, testOutput } from "@/lib/api/documents";
import type { DraftCite, Flow, FlowOutput, OutputDraft } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { bindLeaf, defaultWidth, leafPaths, setLeafWidth } from "@/lib/flowOutputModel";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";

const NEW_DESTINATION = "\u0000new";
/** A value or the format, with the place in the documentation it came from. `show` says a missing cite is worth saying so. */
const Cite = ({ cite, show }: { cite?: DraftCite | null; show: boolean }) =>
  cite || show ? (
    <p className="w-full text-[12px] text-ink-muted">
      {cite ? `From the documentation, ${cite.where}: “${cite.quote}”` : COPY.no_cite}
    </p>
  ) : null;

/** The person checks what each value of a proposed output is fed from, then presses Create: the visible accept step. */
export function DraftReview({ flow, draft, requireTest, previewDocumentId, onCreated, onRestart }: {
  flow: Flow; draft: OutputDraft; requireTest?: boolean; previewDocumentId?: string;
  onCreated(saved: FlowOutput): void; onRestart(): void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(draft.name);
  const [template, setTemplate] = useState(draft.template);
  const [problem, setProblem] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [adding, setAdding] = useState<"new" | "proposed" | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; ok: boolean; message: string | null } | null>(null);
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled: useTenantQueriesEnabled() });
  const fixed = draft.format === "fixed";
  const leaves = leafPaths(template);
  const columns = flow.fields.tables.find((t) => t.key === draft.tableKey)?.columns ?? [];

  // The one template both the test and Create send, so a test passes for exactly what gets saved.
  const sent = fixed ? leaves.reduce((t, l) => setLeafWidth(t, l.path, l.node.rule?.width ?? defaultWidth(l.node.name)), template) : template;
  // A passing test counts only for the exact draft it was sent for: any edit changes the key.
  const gated = !!requireTest && !!destinationId;
  const testKey = JSON.stringify({ template: sent, tableKey: draft.tableKey, destinationId, format: draft.format });
  const test = useMutation({
    mutationFn: (_key: string) =>
      testOutput(previewDocumentId!, { format: draft.format, tableKey: draft.tableKey, destinationId: destinationId!, template: sent }),
    onMutate: () => setOutcome(null),
    onSuccess: (r, key) => setOutcome({ key, ok: r.success, message: r.message }),
    onError: (e, key) => setOutcome({ key, ok: false, message: documentRefusalMessage(e) }),
  });
  const current = outcome?.key === testKey ? outcome : null;
  const tested = !!current?.ok;
  const noteKeys = new Set(draft.notes);
  if (draft.truncated) noteKeys.add("truncated");

  const create = useMutation({
    mutationFn: () => {
      return createOutput(flow.id, { name: name.trim(), format: draft.format, tableKey: draft.tableKey, destinationId, template: sent });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["outputs", flow.id] });
      onCreated(saved);
    },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setProblem("Give this output a name.");
    setProblem(null);
    create.mutate();
  }

  return (
    <Card edge="green" title="Check the values">
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Name">
          <input className={INPUT} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-[13px] text-ink-muted">{Object.hasOwn(FORMATS, draft.format) ? FORMATS[draft.format as keyof typeof FORMATS] : draft.format}</p>
        <Cite cite={draft.formatCite} show={!!requireTest} />
        {leaves.map(({ path, node, inTable }) => {
          const draftLeaf = draft.leaves.find((l) => l.path === path);
          const options = inTable ? columns : flow.fields.fields;
          return (
            <div key={path} className="flex flex-wrap items-center gap-2">
              <span className="min-w-32 flex-1 text-[13px]">{path}</span>
              <select aria-label={`Value for ${path}`} className={`${INPUT} min-w-32 flex-1`} value={node.rule?.canonicalField ?? ""}
                onChange={(e) => setTemplate(bindLeaf(template, path, e.target.value || null))}>
                <option value="">Not set</option>
                {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {draftLeaf?.by === "ai" && draftLeaf.confidence != null && (
                <span className="rounded bg-ai-soft px-1.5 text-[11px] text-ai">AI · {Math.round(draftLeaf.confidence * 100)}%</span>
              )}
              {draftLeaf?.by === "meaning" && (
                <span className="rounded bg-surface2 px-1.5 text-[11px] text-ink-muted">
                  Meaning{draftLeaf.confidence != null ? ` · ${Math.round(draftLeaf.confidence * 100)}%` : ""}
                </span>
              )}
              {draftLeaf?.required && <span className="rounded bg-surface2 px-1.5 text-[11px] text-ink-muted">{COPY.required_tag}</span>}
              {fixed && (
                <input type="number" min={1} max={1000} aria-label={`Width of ${node.name}`} className={`${INPUT} w-24`}
                  value={node.rule?.width ?? defaultWidth(node.name)}
                  onChange={(e) => setTemplate(setLeafWidth(template, path, Number(e.target.value) || undefined))} />
              )}
              <Cite cite={draftLeaf?.cite} show={draftLeaf?.by === "docs"} />
            </div>
          );
        })}
        {[...noteKeys].filter((n) => Object.hasOwn(COPY, n)).map((n) => <p key={n} className="text-[12px] text-ink-muted">{COPY[n]}</p>)}
        <Field label="Send to">
          <select className={INPUT} value={adding === "new" ? NEW_DESTINATION : (destinationId ?? "")}
            onChange={(e) => {
              setAdding(e.target.value === NEW_DESTINATION ? "new" : null);
              if (e.target.value !== NEW_DESTINATION) setDestinationId(e.target.value || null);
            }}>
            <option value="">Download only</option>
            {destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value={NEW_DESTINATION}>New destination…</option>
          </select>
        </Field>
        {draft.destination && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
            <span>{COPY.proposed_destination.replace("{url}", draft.destination.url).replace("{method}", draft.destination.method)}</span>
            <Button type="button" variant="secondary" onClick={() => setAdding("proposed")}>Add this destination</Button>
            <Cite cite={draft.destination.cite} show={!!requireTest} />
          </div>
        )}
        {adding && (
          <DestinationForm
            preset={adding === "proposed" ? draft.destination ?? undefined : undefined}
            onCancel={() => setAdding(null)}
            onSaved={(d) => {
              qc.setQueryData<(typeof d)[]>(["destinations"], (old) => [...(old ?? []).filter((x) => x.id !== d.id), d]);
              setDestinationId(d.id); setAdding(null); qc.invalidateQueries({ queryKey: ["destinations"] });
            }}
          />
        )}
        {gated && (
          <div className="grid gap-2 text-[12px] text-ink-muted">
            <p>{COPY.test_gate.replace("{destination}", destinations.data?.find((d) => d.id === destinationId)?.name ?? "")}</p>
            {previewDocumentId ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" loading={test.isPending} onClick={() => { setProblem(null); test.mutate(testKey); }}>
                  Send a test
                </Button>
                {tested && <span>{COPY.test_passed}</span>}
                {current && !current.ok && current.message && <span>{current.message}</span>}
              </div>
            ) : <p>{COPY.no_test_document}</p>}
          </div>
        )}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!!adding || draft.leaves.length === 0 || (gated && (!previewDocumentId || !tested || test.isPending))}>Create</Button>
          <Button type="button" variant="ghost" onClick={onRestart}>Choose a different file</Button>
        </div>
      </form>
    </Card>
  );
}
