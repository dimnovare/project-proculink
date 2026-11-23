"use client";

import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { updateFlow } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { CHECK_MODES, checkModeLine, type CheckMode } from "@/lib/deliveryMode";
import { Pill } from "@/components/bridge/DSPrimitives";
import { Field, INPUT } from "./DestinationForm";
import { barPending, useFlowSaved } from "./PublishBar";

export function streakText(n: number) {
  if (n === 0) return "The last document sent needed a correction.";
  if (n === 1) return "The last document was sent without a correction.";
  return `The last ${n > 200 ? "200+" : n} documents were sent without a correction.`;
}

/** The You check step. The mode is not part of a draft: a change is saved at once, and a refusal puts the radios back. */
export function FlowCheck({ flow }: { flow: Flow }) {
  const id = useId();
  const saved = useFlowSaved(flow.id);
  const save = useMutation({ mutationFn: (automation: CheckMode) => updateFlow(flow.id, { automation }), onSuccess: saved });
  const value = save.isPending ? save.variables : flow.automation;
  const streak = flow.noCorrectionStreak;

  return (
    <div className="grid gap-4">
      <Card>
        <div className="grid gap-3">
          <div className="grid gap-0.5">
            <h2 id={`${id}-mode`} className="m-0 text-[16px] font-semibold text-ink">Which documents wait for you</h2>
            <p className="m-0 text-[13px] text-ink-muted">We mark a value that is missing, in the wrong shape or hard to read. Choose what happens then.</p>
          </div>
          <div role="radiogroup" aria-labelledby={`${id}-mode`} className="grid gap-2 min-[720px]:grid-cols-3">
            {CHECK_MODES.map((m) => (
              <label
                key={m.id}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${value === m.id ? "border-navy bg-surface-2" : "border-border"}`}
              >
                <input
                  type="radio" name={`${id}-automation`} className="mt-1" checked={value === m.id} disabled={save.isPending}
                  aria-labelledby={`${id}-${m.id}`} aria-describedby={`${id}-${m.id}-line`}
                  onChange={() => { if (!save.isPending && m.id !== flow.automation) save.mutate(m.id); }}
                />
                <span className="grid gap-0.5">
                  <span id={`${id}-${m.id}`} className="text-[14px] font-semibold text-ink">{m.title}</span>
                  {m.id === "marked" && <Pill tone="blue" className="justify-self-start">New flows start here</Pill>}
                  <span id={`${id}-${m.id}-line`} className="text-[13px] text-ink-muted">{checkModeLine(m.id, !!flow.downloadOnly)}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="m-0 flex flex-wrap gap-x-2 text-[13px] text-ink-muted">
            {/* B-01: the mode never joins the waiting changes, so with a bar below it says so. */}
            {flow.publishedVersion !== null && barPending(flow) ?"Saved as soon as you pick. This is not part of the changes waiting below." : "This choice applies to new documents straight away."}
            <span role="status" className="font-semibold text-ink">{save.isPending ? "Saving…" : save.isSuccess ? "Saved" : ""}</span>
          </p>
          {save.isError && <p role="alert" className="m-0 text-[12.5px] text-danger">{documentRefusalMessage(save.error)}</p>}
        </div>
      </Card>

      <Card title="What always waits for a person" sub="Whatever you choose, these never go through by themselves.">
        <ul className="m-0 grid gap-1 pl-5 text-[13px] text-ink">
          <li>A document number we have already received, so nothing goes out twice.</li>
          <li>The first document from a new email address.</li>
          <li>A document we couldn&apos;t read.</li>
        </ul>
      </Card>

      {typeof streak === "number" && (
        <Card as="aside" dense>
          <p className="m-0 text-[13.5px] text-ink">{streakText(streak)}</p>
          {streak >= 5 && flow.automation === "review" && <p className="m-0 mt-1 text-[13px] text-ink-muted">A good sign this flow can check only what we marked.</p>}
        </Card>
      )}

      <Card title="What a marked value looks like">
        <div className="grid gap-3">
          <div className="grid max-w-[480px] gap-3">
            <Field label="Date" look="Check this one. It is written as 21.11.26, and we are 72% sure of the year.">
              <input className={INPUT} readOnly value="2026-11-21" />
            </Field>
            <Field label="Supplier" look="Not found on the page. Type it, or point to it on the original.">
              <input className={INPUT} readOnly value="" />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}
