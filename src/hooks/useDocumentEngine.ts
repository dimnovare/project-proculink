"use client";

import { useQuery } from "@tanstack/react-query";
import { listFlows } from "@/lib/api/documents";
import { refusalToken } from "@/lib/documentRefusals";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";

/** "off" only on the server's explicit refusal; loading or any other failure is "unknown". */
export function useDocumentEngine(): "on" | "off" | "unknown" {
  const { isSuccess, error } = useQuery({
    queryKey: ["flows"],
    queryFn: listFlows,
    enabled: useTenantQueriesEnabled(),
    retry: false,
    staleTime: 300_000,
  });
  if (isSuccess) return "on";
  return refusalToken(error) === "document_engine_not_enabled" ? "off" : "unknown";
}
