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
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
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

/** How the buyers screen explains what a "buyer" is, in the org's own direction. */
export interface BuyerDescription {
  /** Full sentence — the buyers empty state. */
  long: string;
  /** Short qualifier — the "New buyer" panel subtitle. */
  short: string;
}

/**
 * Describe a buyer in the org's own direction.
 *
 * The noun itself is direction-invariant: a buyer is always the organization the
 * order is issued BY. Who that organization is relative to the workspace is not.
 * An OUTBOUND org issues the orders itself and its buyers are read off the
 * documents it uploads; an INBOUND org's buyers are the customers sending orders
 * in. The buyers screen shipped only the inbound sentence — "an organization that
 * sends you purchase orders" — which told the primary, outbound audience the exact
 * opposite of what its own setup answer said.
 *
 * `null` means the direction has not been READ yet (loading, or a failed
 * settings fetch — see `isDirectionKnown`). A definition is a claim, so the
 * qualifying clause is withheld rather than guessed; the invariant half is still
 * true and still shown.
 */
export function buyerDescription(direction: OrderDirection | null): BuyerDescription {
  if (direction === "inbound") {
    return {
      long: "A buyer is an organization that sends you purchase orders, in whatever format they use.",
      short: "A buyer that sends you purchase orders",
    };
  }
  if (direction === "outbound") {
    return {
      long: "A buyer is the organization an order is issued by — detected automatically from your uploaded documents.",
      short: "The organization an order is issued by",
    };
  }
  return {
    long: "A buyer is the organization a purchase order is issued by.",
    short: "The organization a purchase order is issued by",
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
 * query is gated via `useTenantQueriesEnabled()`, which keeps the mock and live
 * QA-bypass paths enabled (avoiding the known clerkReady-starvation bug) and
 * additionally waits out organisation activation: the direction flag lives on
 * `GET /api/settings/organisation`, which is answered per organisation and 500s
 * with `Organisation not resolved` if it is asked before the claim exists.
 */
export function useOrderDirection(): UseOrderDirectionResult {
  const queryEnabled = useTenantQueriesEnabled();

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
