"use client";

import { useId } from "react";
import { Pill } from "@/components/bridge/DSPrimitives";
import type { Flow } from "@/lib/api/documents";

/** How a flow delivers, in one sentence (R1). */
export function deliveryLine(flow: Pick<Flow, "automation">): string {
  return flow.automation === "auto"
    ? "Automatic delivery: each document is sent as soon as it is read."
    : "Review before delivery: you check each document before it is sent.";
}

/** The flows as radio rows under "Which flow is this for?". `compact` drops the delivery line (the phone sheet and the photo step). */
export function FlowChoice({ flows, value, lastUsedId, onChange, compact = false }: {
  flows: readonly Flow[]; value: string; lastUsedId: string | null; onChange(id: string): void; compact?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-3 p-0 text-[16px] font-semibold text-ink">Which flow is this for?</legend>
      {flows.map((flow) => {
        const chosen = flow.id === value;
        return (
          <label key={flow.id} className={`flex cursor-pointer items-start gap-3 rounded-[10px] ${chosen ? "border-2 border-brand-blue bg-brand-blue-soft p-[13px]" : "border border-border-strong bg-surface p-3.5"}`}>
            <input type="radio" name={name} checked={chosen} onChange={() => onChange(flow.id)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-brand-blue" />
            <span className="grid min-w-0 gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 text-[14.5px] font-semibold text-ink">{flow.name}</span>
                {flow.id === lastUsedId && <Pill tone="blue">Last used</Pill>}
              </span>
              {!compact && <span className="text-[13.5px] text-ink-muted">{deliveryLine(flow)}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
