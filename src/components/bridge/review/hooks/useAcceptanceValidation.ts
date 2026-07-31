"use client";

// useAcceptanceValidation — owns the supplier acceptance-profile validation
// state. Extracted from SpineReview.tsx (batch 9 Phase A); same validate call
// and failingRuleCount derivation, PLUS:
//   • a trailing-debounced (800ms) AUTO-REVALIDATE that re-runs validation
//     after every successful commitMappings/bulk-accept (driven by the
//     commitVersion counter from useResolveActions). Only fires once a
//     validation has been run at least once — never surprises an order that
//     was never validated (and whose supplier may have no profile).
//   • an isStale flag, true from the moment a commit lands until the
//     revalidation settles — the UI must never show a confidently-green
//     "passed" against stale data (gate G6).

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { validateOrder } from "@/lib/api-client";
import type { OrderValidationResult } from "@/types/procurement";

const REVALIDATE_DEBOUNCE_MS = 800;

export function useAcceptanceValidation(orderId: string, opts?: {
  /** Bumps after every successful server commit — schedules the auto-revalidate. */
  commitVersion?: number;
  /**
   * WP-18 — the live count of acceptance rows that did NOT pass, from
   * GET /api/orders/{id}/validation, which OrderWorkshop now owns at every
   * breakpoint. `validate()` (the POST) has no caller anywhere in src/, so
   * `validationResult` was permanently null and `failingRuleCount` permanently
   * 0 — the send-confirmation dialog's acknowledgement never once appeared.
   * This seeds the count from the server's own gate-aligned answer, so the
   * dialog is truthful without firing a POST on page load. An explicit
   * validate() still wins.
   */
  serverFailingCount?: number;
  /** True while that server answer is being refetched — feeds the same isStale guard. */
  serverRevalidating?: boolean;
}) {
  const qc = useQueryClient();
  const [validationResult, setValidationResult] = useState<OrderValidationResult | null>(null);
  const [isStale, setIsStale] = useState(false);

  const validateMutation = useMutation({
    mutationFn: () => validateOrder(orderId),
    onSuccess: (result) => {
      setValidationResult(result);
      void qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onSettled: () => setIsStale(false),
  });

  // Refs so the debounce effect depends ONLY on commitVersion (a result arriving
  // or the mutate identity changing must not re-trigger the timer).
  const hasResultRef = useRef(false);
  hasResultRef.current = validationResult !== null;
  const mutateRef = useRef(validateMutation.mutate);
  mutateRef.current = validateMutation.mutate;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitVersion = opts?.commitVersion ?? 0;
  useEffect(() => {
    if (commitVersion === 0) return;          // nothing committed yet
    if (!hasResultRef.current) return;        // never validated — nothing to refresh
    setIsStale(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { mutateRef.current(); }, REVALIDATE_DEBOUNCE_MS);
    // Trailing debounce: a newer commit within the window restarts the timer.
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [commitVersion]);

  const validate = useCallback(() => validateMutation.mutate(), [validateMutation]);

  // Count failing acceptance-profile rules from the last validation run. A
  // failed validation doesn't hard-block send (the supplier may still accept),
  // but the user must explicitly acknowledge it in the confirm dialog.
  //
  // An explicit validate() result wins (it is the freshest, most specific answer);
  // otherwise fall back to the live server-side blocking count so the dialog
  // reflects what the gate will actually do.
  const failingRuleCount = validationResult
    ? (validationResult.passed ? 0 : validationResult.results.filter(r => !r.passed).length)
    : (opts?.serverFailingCount ?? 0);

  return {
    validationResult,
    failingRuleCount,
    validate,
    isValidating: validateMutation.isPending,
    isValidateError: validateMutation.isError,
    validateError: validateMutation.error,
    // Stale while EITHER the debounced revalidate is pending or the live server
    // answer is being refetched — the UI must never show a confidently-green
    // "passed" against data a commit has already invalidated (gate G6).
    isStale: isStale || (opts?.serverRevalidating ?? false),
  };
}

export type AcceptanceValidationApi = ReturnType<typeof useAcceptanceValidation>;
