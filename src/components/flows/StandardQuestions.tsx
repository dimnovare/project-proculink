"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { saveFlowFields } from "@/lib/api/documents";
import type { Flow, FlowField } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { FIELD_MEANINGS } from "@/lib/fieldMeanings";

/** Asks for each meaning a standard needs that no field (for a line need: no column of the output's table) carries, and saves the answer onto the flow's fields.
 * A need with no field left to choose is offered as a new field (or column) of its own. */
export function StandardQuestions({ flow, needs, tableKey, name }: { flow: Flow; needs: string[]; tableKey: string | null; name: string }) {
  const qc = useQueryClient();
  const table = flow.fields.tables.find((t) => t.key === tableKey);
  const save = useMutation({
    // With a label: a new field carrying the meaning. Without: the chosen field takes it.
    mutationFn: ({ key, meaning, line, label }: { key: string; meaning: string; line: boolean; label?: string }) => {
      const set = (list: FlowField[]) => label
        ? [...list, { key, label, type: "text", meaning, required: false }]
        : list.map((f) => (f.key === key ? { ...f, meaning } : f));
      return saveFlowFields(flow.id, line
        ? { ...flow.fields, tables: flow.fields.tables.map((t) => (t === table ? { ...t, columns: set(t.columns) } : t)) }
        : { ...flow.fields, fields: set(flow.fields.fields) });
    },
    onSuccess: (saved) => { qc.setQueryData(["flow", flow.id], saved); qc.invalidateQueries({ queryKey: ["flows"] }); },
  });
  const asks = needs
    .map((need) => {
      const m = FIELD_MEANINGS[need as keyof typeof FIELD_MEANINGS];
      const line = m?.scope === "line";
      const list = (line ? table?.columns : flow.fields.fields) ?? [];
      const title = m?.label ?? need;
      return { need, title, label: title.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()), line, list, options: list.filter((f) => !f.meaning || !needs.includes(f.meaning)) };
    })
    .filter((q) => !q.list.some((f) => f.meaning === q.need));
  // A question with nothing to choose is never shown: with no listed fields the backend reads meanings from the document itself.
  const shown = asks.filter((q) => q.options.length);
  const unanswered = asks.filter((q) => !q.options.length && q.list.length);
  const noTable = !table && asks.some((q) => q.line);
  const added = save.isSuccess && !!save.variables?.label;
  if (!shown.length && !unanswered.length && !noTable && !added) return null;

  return (
    <div className="grid gap-2">
      <p className="text-[12.5px] font-medium text-ink-muted">To make this file, tell us:</p>
      {shown.map((q) => {
        const what = q.line ? "column" : "field";
        return (
          <Field key={q.need} label={`Which ${what} is the ${q.label}?`}>
            <select className={INPUT} value="" disabled={save.isPending}
              onChange={(e) => save.mutate({ key: e.target.value, meaning: q.need, line: q.line })}>
              <option value="">{`Choose a ${what}`}</option>
              {q.options.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
        );
      })}
      {unanswered.map((q) => (
        <StatusNotice key={q.need} tone="warning" action={
          <Button variant="secondary" size="sm" loading={save.isPending} onClick={() => save.mutate({ key: q.need, meaning: q.need, line: q.line, label: q.title })}>Add it as a field</Button>
        }>{`${q.title} isn't read from your documents yet.`}</StatusNotice>
      ))}
      {added && <p role="status" className="text-[12.5px] text-ink-muted">Open a document and type it, or point to it on the original.</p>}
      {noTable && <p className="text-[12.5px] text-ink-muted">{name} needs a table of lines.</p>}
      {save.isError && <StatusNotice tone="error">{documentRefusalMessage(save.error)}</StatusNotice>}
    </div>
  );
}
