"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { deleteFlow } from "@/lib/api/documents";
import type { Flow } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** Under the name form, for a flow never put in use. Replace, not push: Back must not land on the deleted flow. */
export function DeleteFlow({ flow }: { flow: Flow }) {
  const qc = useQueryClient();
  const router = useRouter();
  // null: never opened. Opening focuses Keep it (the safe one); Keep it gives focus back to Delete this flow.
  const [asking, setAsking] = useState<boolean | null>(null);
  const del = useMutation({
    mutationFn: () => deleteFlow(flow.id),
    onSuccess: () => {
      router.replace("/flows");
      // The page still observes ["flow", id] until /flows commits: mark it stale, never refetch it into a 404.
      qc.invalidateQueries({ queryKey: ["flow", flow.id], refetchType: "none" });
      qc.setQueryData<Flow[]>(["flows"], (l) => l?.filter((f) => f.id !== flow.id));
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["documents"] });   // its documents went with it
      qc.invalidateQueries({ queryKey: ["activity"] });    // and their History rows
    },
  });
  // The confirm names what goes, so it waits for a fresh count: a document may have arrived since the page loaded.
  const counting = useIsFetching({ queryKey: ["flow", flow.id] }) > 0;
  const open = () => { setAsking(true); qc.invalidateQueries({ queryKey: ["flow", flow.id] }); };
  if (!asking) return <span><Button autoFocus={asking === false} type="button" variant="ghost" onClick={open}>Delete this flow</Button></span>;
  return (
    <div className="grid max-w-[480px] gap-2">
      <StatusNotice
        tone="warning"
        action={
          <span className="flex gap-2">
            <Button type="button" variant="danger" loading={del.isPending} disabled={counting} onClick={() => del.mutate()}>Delete flow</Button>
            <Button autoFocus type="button" variant="ghost" disabled={del.isPending} onClick={() => { setAsking(false); del.reset(); }}>Keep it</Button>
          </span>
        }
      >
        {flow.documentCount > 0 ? "Delete this flow? Its documents go too. This can't be undone." : "Delete this flow? This can't be undone."}
      </StatusNotice>
      {del.isError && <p role="alert" className="m-0 text-[12.5px] text-danger">{documentRefusalMessage(del.error)}</p>}
    </div>
  );
}
