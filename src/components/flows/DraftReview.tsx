"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { FORMATS } from "@/components/flows/OutputEditor";
import { createOutput } from "@/lib/api/documents";
import type { Flow, FlowOutput, OutputDraft } from "@/lib/api/documents";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { bindLeaf, defaultWidth, leafPaths, setLeafWidth } from "@/lib/flowOutputModel";

/** The person checks what each value of a proposed output is fed from, then presses Create: the visible accept step. */
export function DraftReview({ flow, draft, onCreated, onRestart }: {
  flow: Flow; draft: OutputDraft; onCreated(saved: FlowOutput): void; onRestart(): void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(draft.name);
  const [template, setTemplate] = useState(draft.template);
  const [problem, setProblem] = useState<string | null>(null);
  const fixed = draft.format === "fixed";
  const leaves = leafPaths(template);
  const columns = flow.fields.tables.find((t) => t.key === draft.tableKey)?.columns ?? [];

  const create = useMutation({
    mutationFn: () => {
      const sent = fixed ? leaves.reduce((t, l) => setLeafWidth(t, l.path, l.node.rule?.width ?? defaultWidth(l.node.name)), template) : template;
      return createOutput(flow.id, { name: name.trim(), format: draft.format, tableKey: draft.tableKey, template: sent });
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
              {fixed && (
                <input type="number" min={1} max={1000} aria-label={`Width of ${node.name}`} className={`${INPUT} w-24`}
                  value={node.rule?.width ?? defaultWidth(node.name)}
                  onChange={(e) => setTemplate(setLeafWidth(template, path, Number(e.target.value) || undefined))} />
              )}
            </div>
          );
        })}
        {draft.notes.filter((n) => Object.hasOwn(COPY, n)).map((n) => <p key={n} className="text-[12px] text-ink-muted">{COPY[n]}</p>)}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={create.isPending}>Create</Button>
          <Button type="button" variant="ghost" onClick={onRestart}>Choose a different file</Button>
        </div>
      </form>
    </Card>
  );
}
