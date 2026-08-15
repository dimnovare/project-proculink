"use client";

// useBillingReadOnly — may this workspace still POST?
//
// The server answer is `billing/status.canProcessOrders`. When it is false every
// ingest and recovery path refuses: upload, transform, deliver, add supplier
// (CLAUDE.md §11.5). Screens that offer one of those actions have to know, and
// until now each one re-derived it — `UploadWorkbench.tsx:615` did, and
// `OrderProblemPanel` had a `readOnly` prop that NO call site ever passed, so a
// lapsed workspace was shown a live recovery button that could only 4xx.
//
// ── WHY THIS IS A HOOK AND NOT A PROP ─────────────────────────────────────────
// Read-only is a workspace fact, not a per-call-site fact. Handing it down as a
// prop makes every new call site an opportunity to forget it, which is exactly
// the defect this replaces. Same shape as useProcessingStatus: the component
// asks the question itself.
//
// ── THE UNKNOWN ANSWER ────────────────────────────────────────────────────────
// `readOnly` is FALSE while the answer is unknown (loading, errored, queries
// disabled). Deliberate, and the same call UploadWorkbench already makes: a
// billing endpoint we could not reach must never manufacture a "your account is
// paused" claim about someone's money. The cost of the other direction is a
// live button whose POST is refused — and that refusal is rendered, verbatim,
// by the panel's own error block.
//
// Same query key as every other billing reader → one cache entry, no extra
// network.

import { useQuery } from "@tanstack/react-query";
import { getBillingStatus } from "@/lib/api-client";
import type { BillingStatus } from "@/types/procurement";
import { useQueriesEnabled } from "./useQueriesEnabled";

export interface BillingReadOnly {
  /** The server says this workspace cannot process orders. Never true on unknown. */
  readOnly: boolean;
  /**
   * `billing/status.accountStatus` — the CAUSE, so the reason beside a disabled
   * control can name it (past_due / cancelled / read_only / trial_expired / …).
   * Null while unknown, in which case `readOnly` is false anyway.
   */
  accountStatus: string | null;
  /**
   * `billing/status.isOrderLimitReached`. Hard only on Pilot — paid plans meter the
   * overage instead of blocking (CLAUDE.md §11.5) — so nothing disables a control on
   * it today. It is returned because the panel's context carries the field, and a
   * context field fed by a `false` default is the same dead-code shape as the prop
   * this hook replaced.
   */
  atOrderLimit: boolean;
}

export function useBillingReadOnly(): BillingReadOnly {
  const enabled = useQueriesEnabled();
  // Wrapped in a closure ON PURPOSE — passing `getBillingStatus` directly
  // dereferences the export at hook-call time, which breaks any test that mocks
  // @/lib/api-client without this member.
  const q = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => getBillingStatus(),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    // `=== false`, not `!`: a response from an API too old to carry the field is
    // unknown, not blocked.
    readOnly: q.data ? q.data.canProcessOrders === false : false,
    accountStatus: q.data?.accountStatus ?? null,
    atOrderLimit: q.data?.isOrderLimitReached === true,
  };
}
