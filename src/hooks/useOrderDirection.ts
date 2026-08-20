"use client";

// useOrderDirection — single source of truth for per-org party labelling.
//
// ProcuLink's built-in model is OUTBOUND (the org is the BUYER sending POs out
// to suppliers). Inbound orgs are the SUPPLIER receiving customer POs. The data
// model is direction-agnostic (orders store buyer=issuer, supplier=recipient);
// this hook only swaps DISPLAY text. Entity/route/type names stay "supplier".
//
// Colour semantics are UNCHANGED across directions: buyer = blue, supplier =
// green. Only the words change.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrgSettings } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { OrderDirection } from "@/types/procurement";

/** The canonical label set every component reads, so strings stay identical. */
export interface PartyLabels {
  counterpartyNoun: string;
  counterpartyPlural: string;
  railHeader: string;
  primaryCta: string;
  primaryCtaProgress: string;
  doneLabel: string;
  deliveredLabel: string;
  unknownBuyer: string;
}

/**
 * Pure helper: map an order direction onto the canonical label set. Co-located
 * with the hook so non-hook callers (and tests) can read identical strings.
 */
export function partyLabels(direction: OrderDirection): PartyLabels {
  if (direction === "inbound") {
    return {
      counterpartyNoun: "Customer",
      counterpartyPlural: "Customers",
      railHeader: "Customer → You",
      primaryCta: "Confirm order",
      primaryCtaProgress: "Confirming…",
      doneLabel: "Order confirmed",
      deliveredLabel: "Order confirmed",
      unknownBuyer: "Unknown customer",
    };
  }
  return {
    counterpartyNoun: "Supplier",
    counterpartyPlural: "Suppliers",
    railHeader: "Buyer → Supplier",
    primaryCta: "Send to supplier",
    primaryCtaProgress: "Sending…",
    doneLabel: "Sent to supplier",
    deliveredLabel: "Delivered to supplier",
    unknownBuyer: "Unknown buyer",
  };
}

export interface UseOrderDirectionResult {
  direction: OrderDirection;
  labels: PartyLabels;
  /**
   * True once the org's setting has actually been READ. False while the query is
   * loading AND after a failed read — in both cases `direction` is the
   * "outbound" fallback, not a settled server answer. The fallback wording is
   * fine for labels (every existing org is outbound), but a consumer that makes
   * a CLAIM from the direction (a checked control, a settled sentence) must
   * check this flag rather than presenting the fallback as fact.
   */
  isDirectionKnown: boolean;
}

/**
 * Reads the org's order direction once and exposes the resolved labels. Defaults
 * to "outbound" until the query resolves (every existing org is outbound). The
 * query is gated via `useQueriesEnabled()` (mock || qa-bypass || signed-in) to
 * avoid the known clerkReady-starvation bug, including in live QA-bypass e2e.
 */
export function useOrderDirection(): UseOrderDirectionResult {
  const queryEnabled = useQueriesEnabled();

  const { data } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    staleTime: 300_000,
    enabled: queryEnabled,
  });

  const direction: OrderDirection = data?.direction ?? "outbound";
  const labels = useMemo(() => partyLabels(direction), [direction]);

  return { direction, labels, isDirectionKnown: data !== undefined };
}
