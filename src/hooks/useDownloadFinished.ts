"use client";

// useDownloadFinished — "Download" on the review screens: hand the person the FINISHED
// supplier file (the server artifact, never the live-preview text). With no file yet it
// builds one through the same transform-and-wait step a send uses (transformFlow).
// Only call it where building cannot send: a manual, review-before-delivery or held order.

import { useCallback, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { deliverableArtifact } from "@/components/bridge/review/orderDisplay";
import { transformAndWait } from "@/components/bridge/review/transformFlow";
import { serverReason } from "@/lib/serverText";
import type { Order } from "@/types/procurement";

export function useDownloadFinished({ orderId, order, setFlow, refetchOrder }: {
  orderId: string;
  order: Order | null | undefined;
  setFlow: (message: string | null, severity?: "info" | "success" | "error") => void;
  refetchOrder: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);

  const download = useCallback(async () => {
    if (!order || busy) return;
    setBusy(true);
    try {
      let artifact = deliverableArtifact(order.artifacts);
      if (!artifact) {
        setFlow("Generating the output...", "info");
        const built = await transformAndWait(orderId);
        if (built.order.status === "transform_failed") {
          setFlow(serverReason(built.order.errorMessage, "We couldn't build the output file. Check the output template and try again."), "error");
          return;
        }
        artifact = deliverableArtifact(built.order.artifacts);
        await refetchOrder();
        if (!artifact) {
          setFlow("The file isn't ready yet. Try again in a moment.", "info");
          return;
        }
        setFlow(null);
      }
      const { url } = await apiClient.getDownloadUrl(orderId, artifact.id);
      window.location.assign(url);
    } catch {
      setFlow("We couldn't start the download. Try again in a moment.", "error");
    } finally {
      setBusy(false);
    }
  }, [order, orderId, busy, setFlow, refetchOrder]);

  return { download, busy };
}
