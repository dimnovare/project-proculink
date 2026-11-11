"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { publishFlow, restoreFlowVersion } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** Stores a publish or restore result and refreshes everything it can change. */
export const useFlowSaved = (flowId: string) => {
  const qc = useQueryClient();
  return (f: Flow) => {
    qc.setQueryData(["flow", flowId], f);
    for (const queryKey of [["flows"], ["outputs", flowId], ["flow-versions", flowId]]) qc.invalidateQueries({ queryKey });
  };
};

export function FlowChangesBar({ flow }: { flow: Flow }) {
  const confirm = useConfirm();
  const saved = useFlowSaved(flow.id);
  const [justPublished, setJustPublished] = useState(false);
  const live = flow.publishedVersion ?? null;
  // An older backend sends no version info at all: there is nothing to publish to.
  const unversioned = flow.publishedVersion === undefined;
  const publish = useMutation({ mutationFn: () => publishFlow(flow.id), onSuccess: (f) => { setJustPublished(true); saved(f); } });
  const discard = useMutation({ mutationFn: () => restoreFlowVersion(flow.id, live!), onSuccess: (f) => { setJustPublished(false); saved(f); } });
  const ask = async () => {
    if (await confirm({ title: "Discard your changes?", description: `The flow goes back to version ${live}. This can't be undone.`, confirmLabel: "Discard", danger: true })) discard.mutate();
  };
  const error = publish.error ?? discard.error;
  const pending = live === null || !!flow.hasChanges;
  let message: string | null = null;
  if (live === null) message = "Changes to this flow apply straight away until you publish it.";
  else if (flow.hasChanges) message = `You have changes that aren't live yet. New work still uses version ${live}.`;
  else if (justPublished) message = `Version ${live} is live.`;
  if (unversioned || (!message && !error)) return null;
  return (
    <div className="grid gap-2">
      {message && (
        <StatusNotice
          tone={pending ? "warning" : "success"}
          action={pending ? (
            <span className="flex gap-2">
              <Button variant="primary" size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>{live === null ? "Publish" : "Publish changes"}</Button>
              {live !== null && <Button variant="secondary" size="sm" loading={discard.isPending} onClick={ask}>Discard changes</Button>}
            </span>
          ) : undefined}
        >
          {message}
        </StatusNotice>
      )}
      {error && <StatusNotice tone="error">{documentRefusalMessage(error)}</StatusNotice>}
    </div>
  );
}
