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
  const failingRuleCount = validationResult && !validationResult.passed
    ? validationResult.results.filter(r => !r.passed).length
    : 0;

  return {
    validationResult,
    failingRuleCount,
    validate,
    isValidating: validateMutation.isPending,
    isValidateError: validateMutation.isError,
    validateError: validateMutation.error,
    isStale,
  };
}

export type AcceptanceValidationApi = ReturnType<typeof useAcceptanceValidation>;
