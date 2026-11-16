"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { publishFlow, restoreFlowVersion } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { FLOW_STEPS, flowAddress, type FlowStep } from "@/lib/flowSteps";
import { DraftPartFailed, draftReason, useFlowDraft } from "./flowDraft";

/** Stores a publish or restore result and refreshes everything it can change. */
export const useFlowSaved = (flowId: string) => {
  const qc = useQueryClient();
  return (f: Flow) => {
    qc.setQueryData(["flow", flowId], f);
    for (const queryKey of [["flows"], ["outputs", flowId], ["flow-versions", flowId]]) qc.invalidateQueries({ queryKey });
  };
};

type Note = { text: string; done: boolean; step?: FlowStep; reason?: string };
const stepTitle = (step: FlowStep) => FLOW_STEPS.find((s) => s.id === step)!.title;

/** The bar is drawn: fields confirmed, a known version, and either never saved or changed since. */
export const barPending = (flow: Flow) =>
  flow.publishedVersion !== undefined && flow.fieldsConfirmed && (flow.publishedVersion === null || !!flow.hasChanges);

/** The one bar that makes a flow's draft real: it saves every waiting change first, and a part that could not be
 *  saved stops the publish. Drawn only when the server says there is something to publish, or while it reports a result. */
export function PublishBar({ flow, onDiscarding }: { flow: Flow; onDiscarding?(on: boolean): void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const draft = useFlowDraft();
  const saved = useFlowSaved(flow.id);
  const busy = useRef(false);
  const [running, setRunning] = useState<"publish" | "discard" | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const live = flow.publishedVersion;
  // An older backend sends no version info at all: there is nothing to publish to.
  if (live === undefined) return null;
  const pending = barPending(flow);
  const flowKey = ["flow", flow.id];

  // One request per press, however often it is pressed; the result is said beside the buttons.
  const run = async (kind: "publish" | "discard", work: () => Promise<string>, ask?: () => Promise<boolean>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (ask && !(await ask())) return;
      setRunning(kind);
      // While a discard runs the step's editors take no typing: a keystroke would bring the discarded edits back.
      if (kind === "discard") onDiscarding?.(true);
      setNote(null);
      setNote({ text: await work(), done: true });
    } catch (e) {
      if (e instanceof DraftPartFailed) {
        setNote({ text: `A change on ${stepTitle(e.step)} couldn't be saved, so ${live === null ? "the setup wasn't saved" : "nothing was put in use"}.`, done: false, step: e.step, reason: draftReason(e) });
      } else {
        setNote({ text: documentRefusalMessage(e), done: false });
        qc.invalidateQueries({ queryKey: flowKey });   // e.g. nothing to publish, or someone else published first
        if (kind === "discard") draft.bump();   // the unsaved edits were dropped: show what the server holds, not them
      }
    } finally {
      busy.current = false;
      setRunning(null);
      onDiscarding?.(false);
    }
  };

  const publish = () => run("publish", async () => {
    await draft.flushAll();
    await qc.cancelQueries({ queryKey: flowKey });   // a refetch started by a draft save must not land after the answer
    const f = await publishFlow(flow.id);
    saved(f);   // no bump: publishing leaves the draft as it is, and what was typed meanwhile stays in the editor
    // Said from the version before the press: the first save keeps later changes waiting; after that they are in use.
    return live === null ? "Setup saved. Later changes wait until you use them." : "Your changes are in use.";
  });

  const discard = (version: number) => run("discard", async () => {
    await draft.discardAll();
    await qc.cancelQueries({ queryKey: flowKey });
    saved(await restoreFlowVersion(flow.id, version));
    const text = "Your changes are undone.";
    // Anything typed after the press is saved on top, never dropped; a part that could not save it keeps it and says why.
    try { await draft.flushAll(); } catch { return text; }
    await Promise.all([flowKey, ["outputs", flow.id]].map((queryKey) => qc.invalidateQueries({ queryKey })));
    draft.bump();
    return text;
  }, () => confirm({
    title: "Undo your changes?", description: "The flow goes back to the setup in use. This can't be undone.", confirmLabel: "Undo my changes", danger: true,
  }));

  const shown = note && !(note.done && pending) ? note : null;
  if (!pending && !shown) return null;
  return (
    // Card draws position: relative inline, so the sticky wrapper is its own element. On a phone it stops 24px up,
    // clear of the tab bar's round Add button (it rises 20px, its ring 4px more); the same margin under it keeps the
    // end of the step from sliding under it.
    // Named for what it says: a setup never saved, changes waiting, or (after a press) its result.
    <section role="region" aria-label={live === null ? "Save this setup" : pending ? "Changes not in use yet" : "Your changes"} className="sticky bottom-0 z-sticky max-md:bottom-6 max-md:mb-6">
      <Card dense className="flex flex-wrap items-center gap-3">
        <div aria-live="polite" className="grid min-w-0 flex-1 gap-1 text-[13px]">
          {pending && (
            <p className="m-0 text-ink">
              {live === null ? "Changes to this flow are in use straight away until you save this setup." : (
                <><span className="block">Your changes aren't in use yet.</span><span className="block">New documents still follow the last saved setup.</span></>
              )}
            </p>
          )}
          {shown && (
            <p className={`m-0 ${shown.done ? "text-ink" : "text-danger"}`}>
              {shown.text}
              {shown.reason && <> <span>{shown.reason}</span></>}
              {shown.step && (
                <>
                  {" "}
                  <Link href={flowAddress(flow.id, shown.step)} replace className="inline-flex items-center font-semibold text-ink underline">
                    {`Go to ${stepTitle(shown.step)}`}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        {pending && (
          <div className="flex w-full gap-2 min-[720px]:w-auto">
            {live !== null && (
              <Button variant="secondary" className="flex-1 min-[720px]:flex-none" loading={running === "discard"} disabled={running !== null} onClick={() => discard(live)}>
                Undo my changes
              </Button>
            )}
            <Button variant="primary" className="flex-1 min-[720px]:flex-none" loading={running === "publish"} disabled={running !== null} onClick={publish}>
              {live === null ? "Save this setup" : "Use these changes"}
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
