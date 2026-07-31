"use client";

// useProcessingStatus — is the pipeline running?
//
// There is one Hangfire Worker. When it is down nothing parses, transforms or
// delivers — and until now exactly ONE screen in the whole frontend knew that
// (/operations/health, the only place `workerHealthy` was read). Everywhere else
// either said nothing or guessed: MagicMappingPreview hedges "processing MAY be
// paused" off a 90-second timer while the definite answer sits behind the same
// query key.
//
// Same key as the health page → one cache entry, one 45s poll, no extra network.
//
// `paused` is FALSE while the answer is unknown (loading, errored, disabled). An
// unreachable API must never manufacture an outage banner: silence beats a false
// alarm in both directions.

import { useQuery } from "@tanstack/react-query";
import { getOpsHealth, type OpsHealth } from "@/lib/api-client";
import { useQueriesEnabled } from "./useQueriesEnabled";

export interface ProcessingStatus {
  /** The Worker is definitively down. Never true on a merely-unknown answer. */
  paused: boolean;
  /** Seconds since the last Worker heartbeat, when the API told us. */
  lastSeenSeconds: number | null;
}

export function useProcessingStatus(): ProcessingStatus {
  const enabled = useQueriesEnabled();
  // queryFn is wrapped in a closure ON PURPOSE: passing `getOpsHealth` directly
  // would dereference the export at hook-call time, which breaks any test that
  // mocks @/lib/api-client without this member.
  const q = useQuery<OpsHealth>({
    queryKey: ["ops-health"],
    queryFn: () => getOpsHealth(),
    enabled,
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 1,
  });

  return {
    paused: q.data ? q.data.workerHealthy === false : false,
    lastSeenSeconds: q.data?.secondsSinceWorkerHeartbeat ?? null,
  };
}
