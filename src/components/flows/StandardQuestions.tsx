"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { saveFlowFields } from "@/lib/api/documents";
import type { Flow, FlowField } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { FIELD_MEANINGS } from "@/lib/fieldMeanings";

/** Asks for each meaning a standard needs that no field (for a line need: no column of the output's table) carries, and saves the answer onto the flow's fields. */
export function StandardQuestions({ flow, needs, tableKey, name }: { flow: Flow; needs: string[]; tableKey: string | null; name: string }) {
  const qc = useQueryClient();
  const table = flow.fields.tables.find((t) => t.key === tableKey);
  const save = useMutation({
    mutationFn: ({ key, meaning, line }: { key: string; meaning: string; line: boolean }) => {
      const set = (list: FlowField[]) => list.map((f) => (f.key === key ? { ...f, meaning } : f));
      return saveFlowFields(flow.id, line
        ? { ...flow.fields, tables: flow.fields.tables.map((t) => (t === table ? { ...t, columns: set(t.columns) } : t)) }
        : { ...flow.fields, fields: set(flow.fields.fields) });
    },
    onSuccess: (saved) => qc.setQueryData(["flow", flow.id], saved),
  });
  const asks = needs
    .map((need) => {
      const m = FIELD_MEANINGS[need as keyof typeof FIELD_MEANINGS];
      return { need, label: (m?.label ?? need).toLowerCase(), line: m?.scope === "line" };
    })
    .filter((q) => !(q.line ? table?.columns : flow.fields.fields)?.some((f) => f.meaning === q.need));
  if (!asks.length) return null;

  return (
    <div className="grid gap-2">
      <p className="text-[12px] font-medium text-ink-muted">To make this file, tell us:</p>
      {asks.map((q) => {
        if (q.line && !table) return null;
        const what = q.line ? "column" : "field";
        return (
          <Field key={q.need} label={`Which ${what} is the ${q.label}?`}>
            <select className={INPUT} value="" disabled={save.isPending}
              onChange={(e) => save.mutate({ key: e.target.value, meaning: q.need, line: q.line })}>
              <option value="">{`Choose a ${what}`}</option>
              {(q.line ? table!.columns : flow.fields.fields).filter((f) => !f.meaning || !needs.includes(f.meaning)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
        );
      })}
      {!table && asks.some((q) => q.line) && <p className="text-[12px] text-ink-muted">{name} needs a table of lines.</p>}
      {save.isError && <StatusNotice tone="error">{documentRefusalMessage(save.error)}</StatusNotice>}
    </div>
  );
}
