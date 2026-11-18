"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { deleteFlow } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** Under the name form, for a flow never put in use. Replace, not push: Back must not land on the deleted flow. */
export function DeleteFlow({ flow }: { flow: Flow }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteFlow(flow.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["flow", flow.id] });
      qc.invalidateQueries({ queryKey: ["flows"] });
      router.replace("/flows");
    },
  });
  if (!asking) return <span><Button type="button" variant="ghost" onClick={() => setAsking(true)}>Delete this flow</Button></span>;
  return (
    <div className="grid max-w-[480px] gap-2">
      <StatusNotice
        tone="warning"
        action={
          <span className="flex gap-2">
            <Button type="button" variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete flow</Button>
            <Button type="button" variant="ghost" onClick={() => { setAsking(false); del.reset(); }}>Keep it</Button>
          </span>
        }
      >
        {flow.documentCount > 0 ? "Delete this flow? Its documents go too. This can't be undone." : "Delete this flow? This can't be undone."}
      </StatusNotice>
      {del.isError && <p role="alert" className="m-0 text-[12.5px] text-danger">{documentRefusalMessage(del.error)}</p>}
    </div>
  );
}
