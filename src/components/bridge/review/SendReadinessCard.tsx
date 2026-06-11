"use client";

// SendReadinessCard — the single pre-send verification surface for the Triage
// sub-view (batch 9 Phase C; stolen from the Breathing Bridge concept in the
// 2026-06-11 spine-redesign spec). Docked at the end of the Fix Queue rail,
// directly under the operator's path to the Send CTA. Four rows, ALL derived
// from server truth / real configuration — never local optimism (gates G1/G6):
//   1. Lines resolved X/Y                — from the refetched order.
//   2. Acceptance X-of-Y rules passing   — last validation run, auto-fresh via
//      the debounced revalidate; shows an explicit stale indicator meanwhile.
//   3. Conformance in the supplier's CONFIGURED format — reuses the SAME query
//      key as the Conformance tab (shared cache); honest fallbacks when no
//      named profile exists or lines are still unresolved (422).
//   4. Delivers via {real protocol}      — from the delivery-config query;
//      "not configured" / "—" when absent or unknown.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getConformanceReport, ApiHttpError, type ConformanceFormat } from "@/lib/api-client";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import type { AcceptanceValidationApi } from "./hooks/useAcceptanceValidation";
import { acceptanceSummary } from "./stageModel";
import { deliveryChannelLabel } from "./orderDisplay";

const GREEN = "#1E6D29";
const AMBER = "#C97A14";
const RED   = "#C53A3A";
const MUTED = "#56627A";

function Row({ label, value, tone = "muted", testId }: {
  label: string;
  value: ReactNode;
  tone?: "good" | "warn" | "bad" | "muted";
  testId?: string;
}) {
  const color = tone === "good" ? GREEN : tone === "warn" ? AMBER : tone === "bad" ? RED : MUTED;
  return (
    <div data-testid={testId} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "6px 12px", borderTop: "1px solid #F5F6F9" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color, textAlign: "right", minWidth: 0 }}>{value}</span>
    </div>
  );
}

export function SendReadinessCard({ orderId, order, validation, deliveryProtocol, conformanceFormat, configuredFormatLabel, labels }: {
  orderId: string;
  order: Order;
  validation: AcceptanceValidationApi;
  /** undefined = unknown (loading/error) · null = no config saved · string = protocol id. */
  deliveryProtocol: string | null | undefined;
  /** Named conformance profile id for the supplier's configured output format;
   *  undefined when no named profile exists for it (row says so honestly). */
  conformanceFormat: ConformanceFormat | undefined;
  /** Display label of the configured output format (e.g. "CSV"), for the honest no-profile copy. */
  configuredFormatLabel: string;
  labels: PartyLabels;
}) {
  const queryEnabled = useQueriesEnabled();

  const total = order.lines.length;
  const resolved = order.lines.filter(l => !l.needsReview).length;
  const allResolved = resolved === total;

  // Conformance — SAME query key as ConformancePanel so the tab and this row
  // share one cache entry. Only runs when a named profile exists for the
  // configured format AND every line is resolved (the backend 422s otherwise —
  // we render that state without firing the request).
  const conformanceEnabled = queryEnabled && conformanceFormat !== undefined && allResolved;
  const conformance = useQuery({
    queryKey: ["conformance", orderId, conformanceFormat],
    queryFn: () => getConformanceReport(orderId, conformanceFormat!),
    enabled: conformanceEnabled,
    retry: 1,
    staleTime: 30_000,
  });

  const acceptance = acceptanceSummary(validation.validationResult);

  // ── Row derivations (server truth only) ─────────────────────────────────────
  const linesTone = allResolved ? "good" : "bad";

  let acceptanceValue: ReactNode;
  let acceptanceTone: "good" | "warn" | "bad" | "muted" = "muted";
  if (validation.isStale || validation.isValidating) {
    acceptanceValue = "Re-checking…";
    acceptanceTone = "warn";
  } else if (acceptance) {
    acceptanceValue = `${acceptance.passed} of ${acceptance.total} rules passing`;
    acceptanceTone = acceptance.failed === 0 ? "good" : "bad";
    if (acceptance.total === 0) { acceptanceValue = "Passed — no rules configured"; acceptanceTone = "good"; }
  } else {
    acceptanceValue = "Not validated yet";
  }

  let conformanceValue: ReactNode;
  let conformanceTone: "good" | "warn" | "bad" | "muted" = "muted";
  if (conformanceFormat === undefined) {
    conformanceValue = `No named profile for ${configuredFormatLabel}`;
  } else if (!allResolved) {
    conformanceValue = "After lines are resolved";
  } else if (conformance.isLoading || conformance.isFetching) {
    conformanceValue = "Checking…";
  } else if (conformance.isError) {
    const status = conformance.error instanceof ApiHttpError ? conformance.error.status : null;
    conformanceValue = status === 422 ? "After lines are resolved" : status === 400 ? `No named profile for ${configuredFormatLabel}` : "Unavailable";
  } else if (conformance.data) {
    conformanceValue = conformance.data.overallPass
      ? `Pass · ${conformance.data.profileName}${conformance.data.warningCount > 0 ? ` (${conformance.data.warningCount} warning${conformance.data.warningCount !== 1 ? "s" : ""})` : ""}`
      : `${conformance.data.errorCount} error${conformance.data.errorCount !== 1 ? "s" : ""} · ${conformance.data.profileName}`;
    conformanceTone = conformance.data.overallPass ? "good" : "bad";
  } else {
    conformanceValue = "—";
  }

  const deliveryValue =
    deliveryProtocol ? <>Delivers via <strong style={{ color: "#0B1A2F" }}>{deliveryChannelLabel(deliveryProtocol)}</strong></>
    : deliveryProtocol === null ? "Not configured"
    : "—";
  const deliveryTone = deliveryProtocol ? "good" : deliveryProtocol === null ? "warn" : "muted";

  return (
    <div data-testid="send-readiness" style={{ marginTop: 12, borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#56627A" }}>
          Send readiness
        </span>
        {/* Auto-fresh marker — visible while the debounced revalidate runs. */}
        {validation.isStale && (
          <span aria-live="polite" style={{ fontSize: 10, color: AMBER }}>updating…</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-faint)" }}>{labels.primaryCta}</span>
      </div>
      <Row testId="readiness-lines" label="Lines resolved" value={`${resolved} / ${total}`} tone={linesTone} />
      <Row testId="readiness-acceptance" label="Acceptance" value={acceptanceValue} tone={acceptanceTone} />
      <Row testId="readiness-conformance" label="Conformance" value={conformanceValue} tone={conformanceTone} />
      <Row testId="readiness-delivery" label="Delivery" value={deliveryValue} tone={deliveryTone} />
    </div>
  );
}
