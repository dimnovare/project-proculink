"use client";

// useProcessingStatus — is the pipeline running?
//
// Its only data source, GET /api/ops/health, was deleted with the order operations screens
// (2026-11-13). The backend alerts the operator when no worker is beating; no endpoint exposes
// that to the browser any more, so the answer is permanently "not known to be paused".
// Only the legacy order review screens still call this; they are deleted by a later task of
// the legacy-removal plan, and this hook goes with them.
//
// `paused` is FALSE while the answer is unknown: an unreachable API must never manufacture an
// outage banner.

export interface ProcessingStatus {
  /** The Worker is definitively down. Never true on a merely-unknown answer. */
  paused: boolean;
  /** Seconds since the last Worker heartbeat, when the API told us. */
  lastSeenSeconds: number | null;
}

const UNKNOWN: ProcessingStatus = { paused: false, lastSeenSeconds: null };

export function useProcessingStatus(): ProcessingStatus {
  return UNKNOWN;
}
