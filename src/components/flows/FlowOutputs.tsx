"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteOutput, getDocument, listDestinations, listOutputs } from "@/lib/api/documents";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { defaultWidth } from "@/lib/flowOutputModel";
import { flowAddress } from "@/lib/flowSteps";
import { makeFileLabel } from "./fileChoice";
import { draftReason, FlowLink, useFlowDraft } from "./flowDraft";
import { OutputBuilder } from "./OutputBuilder";
import { OutputEditor, outputTypeLabel } from "./OutputEditor";
import { barPending } from "./PublishBar";
import { Failed, Quiet, Loading } from "./states";

/** "{type} to {destination}" / "{type}, you download it"; just the type while the destination is not known. */
function outputLine(o: FlowOutput, destinations: { id: string; name: string }[] | undefined) {
  const type = outputTypeLabel(o);
  if (!o.destinationId) return `${type}, you download it`;
  const d = destinations?.find((x) => x.id === o.destinationId);
  return d ? `${type} to ${d.name}` : type;
}

const COMPARED = ["name", "format", "tableKey", "destinationId", "sendWhen", "layout", "template"] as const;
/** R3: settings of `draft` that differ from the live file of the same id; "new" when the live setup has no such file;
 *  null when the live list is not in hand. */
export function changesNotInUse(draft: FlowOutput, live: readonly FlowOutput[] | undefined): number | "new" | null {
  if (!live) return null;
  const was = live.find((o) => o.id === draft.id);
  if (!was) return "new";
  return COMPARED.filter((k) => settingOf(k, draft[k]) !== settingOf(k, was[k])).length;
}
/** What a save adds by itself is not a change: an empty layout, a column's default width, an empty list of steps. */
const plain = (_: string, v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const { width, fieldManipulators, ...rest } = v as Record<string, unknown>;
  return {
    ...rest,
    ...(width !== undefined && width !== defaultWidth(String(rest.outputPath ?? "")) ? { width } : {}),
    ...(Array.isArray(fieldManipulators) && fieldManipulators.length ? { fieldManipulators } : {}),
  };
};
/** A layout value left empty (or null, or absent) is no value: typing a letter and deleting it is not a change. */
const settingOf = (k: string, v: unknown) => {
  const l = k === "layout" && v ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x != null)) : v;
  return JSON.stringify(k === "layout" && !Object.values(l ?? {}).some(Boolean) ? null : l ?? null, plain);
};
export const changesLine = (n: number | "new" | null) =>
  n === "new" ? "Not in use yet" : !n ? null : n === 1 ? "1 change not in use yet" : `${n} changes not in use yet`;

/** The We send step: the flow's outputs, and the chosen one edited in place as part of the draft. */
export function FlowOutputs({ flow, outputId, previewDocumentId }: { flow: Flow; outputId: string | null; previewDocumentId: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const enabled = useTenantQueriesEnabled();
  const router = useRouter();
  const { flushAll, leave } = useFlowDraft();
  const [adding, setAdding] = useState(false);
  // The file just made is shown at once, while the address still says what it said when it was made.
  const [made, setMade] = useState<{ id: string; from: string | null } | null>(null);
  // Its heading takes focus once, when that heading is drawn, however late the list answers.
  const [focusFor, setFocusFor] = useState<string | null>(null);
  const deleting = useRef(false);
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  // The live setup's files, only while there is one with changes: the count is drawn from both lists in hand, never guessed.
  const live = useQuery({
    queryKey: ["outputs", flow.id, "published"], queryFn: () => listOutputs(flow.id, { published: true }),
    enabled: enabled && typeof flow.publishedVersion === "number" && !!flow.hasChanges,
  });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  // The same entry the step's latest-read query fills: no second request.
  const source = useQuery({ queryKey: ["document", previewDocumentId], queryFn: () => getDocument(previewDocumentId!), enabled: enabled && !!previewDocumentId });
  const remove = useMutation({
    mutationFn: async (o: FlowOutput) => { await flushAll(); await deleteOutput(flow.id, o.id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["outputs", flow.id] }); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); },
    onSettled: () => { deleting.current = false; },
  });

  // Only until the address moves: once it names the new file, or the person goes anywhere else, the address decides.
  if (made && outputId !== made.from) setMade(null);
  if (focusFor && !made && outputId !== focusFor) setFocusFor(null);
  if (outputs.isError && !outputs.data) return <Failed error={outputs.error} retry={() => outputs.refetch()} />;
  if (!outputs.data) return <Loading>Loading files…</Loading>;
  const wanted = made && made.from === outputId ? made.id : outputId;
  const chosen = outputs.data.find((o) => o.id === wanted) ?? outputs.data[0];
  // Both lists answered and neither is being fetched again: a count from an older answer is never drawn.
  const counting = typeof flow.publishedVersion === "number" && !!flow.hasChanges
    && outputs.isSuccess && !outputs.isFetching && live.isSuccess && !live.isFetching;
  const preview = previewDocumentId ?? undefined;
  const point = outputs.data.length === 0 && !barPending(flow);

  const ask = async (o: FlowOutput) => {
    if (deleting.current) return;
    deleting.current = true;
    if (await confirm({ title: "Delete file", description: `Delete "${o.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true })) remove.mutate(o);
    else deleting.current = false;
  };
  const open = (o: FlowOutput) => {
    setAdding(false);
    // No scroll: a navigation that scrolls also moves focus to the page, off the new file's heading.
    leave(() => router.replace(flowAddress(flow.id, "send", { output: o.id }), { scroll: false }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
      <Card flush>
        <div className="grid gap-0.5 px-4 pt-3">
          <h2 className="m-0 text-[16px] font-semibold text-ink">Files we make</h2>
          {outputs.data.length > 0 && (
            <p className="m-0 text-[13px] text-ink-muted">{outputs.data.length === 1 ? "For each document, we make this file." : "For each document, we make these files."}</p>
          )}
        </div>
        {outputs.data.length === 0 && !adding ? (
          <div className="px-4 pt-3"><Quiet>No file yet.</Quiet></div>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {outputs.data.map((o) => {
              const changes = counting ? changesLine(changesNotInUse(o, live.data)) : null;
              return (
              <li key={o.id} className="border-t border-border-faint">
                <FlowLink
                  href={flowAddress(flow.id, "send", { output: o.id })} current={!adding && o.id === chosen?.id}
                  className={`grid min-h-11 gap-px px-4 py-2.5 text-ink no-underline ${!adding && o.id === chosen?.id ? "bg-surface-2" : "hover:bg-surface-2"}`}
                >
                  <span className="text-[14px] font-semibold">{o.name}</span>
                  <span className="text-[13px] text-ink-muted">{outputLine(o, destinations.data)}</span>
                  {changes && <span className="text-[13px] font-semibold text-ink">{changes}</span>}
                </FlowLink>
              </li>
              );
            })}
            {adding && (
              <li aria-current="true" className="grid min-h-11 gap-px border-t border-border-faint bg-surface-2 px-4 py-2.5">
                <span className="text-[14px] font-semibold text-ink">A new file</span>
                <span className="text-[13px] text-ink-muted">Not made yet</span>
              </li>
            )}
          </ul>
        )}
        {/* Not drawn while the panel is open: its Cancel closes it. With no file and no bar, making one is the screen's point. */}
        {!adding && (
          <div className="grid gap-2 p-3">
            <Button
              variant={point ? "primary" : "secondary"} className={point ? "w-full" : "w-full border-dashed border-brand-blue text-brand-blue"} aria-expanded={false}
              onClick={() => leave(() => setAdding(true))}
            >
              {makeFileLabel(outputs.data.length)}
            </Button>
            {outputs.data.length === 1 && (
              <p className="m-0 text-[13px] text-ink-muted">Each document then gives two files. To change this file instead, press Change next to File type.</p>
            )}
          </div>
        )}
      </Card>

      {adding ? (
        <OutputBuilder
          flow={flow} previewDocumentId={preview} kind={source.data?.read?.kindLabel ?? null} first={outputs.data.length === 0}
          names={outputs.data.map((o) => o.name)} onDone={() => setAdding(false)}
          onCreated={(o) => { setMade({ id: o.id, from: outputId }); setFocusFor(o.id); open(o); }}
        />
      ) : chosen ? (
        <Card as="section" aria-label={`Edit the file ${chosen.name}`}>
          <div className="grid gap-4">
            <OutputEditor
              key={chosen.id} mode="draft" flow={flow} output={chosen} previewDocumentId={preview} previewFile={source.data?.summary.fileName}
              headingRef={chosen.id === focusFor ? (h: HTMLHeadingElement | null) => { if (h) { h.focus(); setFocusFor(null); } } : undefined}
              onSaved={() => {}} onCancel={() => {}}
              actions={<>
                {!chosen.standard && (
                  <FlowLink href={`/flows/${flow.id}/outputs/${chosen.id}/advanced`} push className={buttonClass("secondary", "sm")}>Open in Advanced</FlowLink>
                )}
                <Button variant="secondary" size="sm" className="text-danger-text" loading={remove.isPending} onClick={() => ask(chosen)}>Delete this file</Button>
              </>}
            />
            {remove.isError && <StatusNotice tone="error">{draftReason(remove.error)}</StatusNotice>}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
