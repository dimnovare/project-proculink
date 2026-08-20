"use client";

// ConfirmDialog — the send/confirm modal with focus trap and the
// failing-acceptance-rules acknowledgement. Moved as-is from SpineReview.tsx
// (batch 9 Phase A). Phase B: the confirmation checkbox is now policy-driven
// (confirmPolicy.ts) behind NEXT_PUBLIC_CONFIRM_ALWAYS — the default (flag
// unset) keeps today's always-on checkbox byte-identical; "false" makes it
// conditional (renders only when exceptions / failing rules / stale validation
// give the operator something real to acknowledge).

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import type { DeliveryConfig } from "@/lib/api/types";
import { shouldRequireConfirmCheckbox, confirmAlwaysFlag } from "./confirmPolicy";
import { confirmAckLabel } from "../workshop/acceptanceGateModel";

/**
 * What this dialog can honestly say about WHERE the order goes. Three-valued on
 * purpose — the repo's standing rule is that unknown never renders as either
 * decided answer (see PracticeDeliveryState for the precedent):
 *
 *   configured     → name the channel/destination plainly.
 *   not_configured → the API's own "nothing saved" (a 204 → null) — warn that
 *                    this send will fail, and link the supplier's delivery tab.
 *   unknown        → the check is still loading or FAILED. Claim neither way,
 *                    and never block: the server owns refusal, and a failed
 *                    config read must never lock a working send.
 */
export type DeliverySetupCheck =
  | { state: "configured"; config: DeliveryConfig }
  | { state: "not_configured"; supplierId: string | null }
  | { state: "unknown" };

/**
 * Derive the three-valued check from a delivery-config query. Reads the query's
 * STATUS, never `data === undefined` alone: pending, disabled (no assigned
 * supplier) and error all mean "we do not know", and only a settled success may
 * claim an answer in either direction.
 */
export function deliverySetupFrom(
  query: { status: "pending" | "error" | "success"; data?: DeliveryConfig | null },
  supplierId: string | null,
): DeliverySetupCheck {
  if (query.status !== "success") return { state: "unknown" };
  return query.data
    ? { state: "configured", config: query.data }
    : { state: "not_configured", supplierId };
}

/**
 * The one sentence for a configured delivery — plain channel wording matching
 * the delivery tab (DeliveryConfigEditor / SupplierDockList channel labels).
 * A protocol this build does not recognise says only that delivery is set up:
 * naming a channel there would be a guess.
 */
export function configuredDeliverySentence(config: DeliveryConfig, supplierName: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(config.configJson) as Record<string, unknown>;
  } catch {
    // Unparseable configJson: keep the channel, invent no destination.
  }
  const str = (key: string): string | null => {
    const v = parsed[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const emailTo = (): string | null => {
    const v = parsed["toAddresses"];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === "string" && !!x.trim());
      return items.length ? items.join(", ") : null;
    }
    return null;
  };
  switch (config.protocol) {
    case "email":
    case "smtp": {
      const to = emailTo();
      return to ? `Sends by email to ${to}.` : "Sends by email.";
    }
    case "http": {
      const url = str("url");
      return url ? `Delivers by HTTP to ${url}.` : "Delivers by HTTP.";
    }
    case "sftp": {
      const host = str("host");
      return host ? `Delivers by SFTP to ${host}.` : "Delivers by SFTP.";
    }
    case "ftps": {
      const host = str("host");
      return host ? `Delivers by FTPS to ${host}.` : "Delivers by FTPS.";
    }
    case "erp_erply":
      return "Delivers to Erply ERP.";
    case "erp_directo":
      return "Delivers to Directo ERP.";
  }
  return `Delivery is set up for ${supplierName}.`;
}

export function ConfirmDialog({ exceptionCount, onConfirm, onCancel, supplierName, outputFormat, grandTotal, lineCount, labels, failingRuleCount, validationStale = false, deliverySetup = { state: "unknown" } }: {
  exceptionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  supplierName: string;
  /**
   * The format of the artifact that will actually be DELIVERED, or null when the order holds no
   * deliverable artifact. Nullable on purpose: this dialog is the consent step for an irreversible
   * action, and it used to receive a hard-coded "XML" whenever the real answer was unknown.
   */
  outputFormat: string | null;
  grandTotal: string;
  lineCount: number;
  labels: PartyLabels;
  /** Number of acceptance-profile rules that FAILED the last validation; 0 if it passed or wasn't run. Requires an explicit ack before send. */
  failingRuleCount: number;
  /** True while the acceptance validation is stale / re-running after a commit. */
  validationStale?: boolean;
  /**
   * Where this send will actually go — or that nothing is set up so it will
   * fail, or that we could not check. Defaults to unknown: a caller that has no
   * answer must not imply one.
   */
  deliverySetup?: DeliverySetupCheck;
}) {
  const inbound = labels.counterpartyNoun === "Customer";
  const [checked, setChecked] = useState(false);
  // Second acknowledgement, required only when validation flagged failing rules.
  const [ackValidation, setAckValidation] = useState(false);
  // Conditional confirm checkbox (Phase B) — policy in confirmPolicy.ts; the
  // flag default keeps the checkbox always-on (current behaviour).
  const confirmAlways = confirmAlwaysFlag();
  const requireCheckbox = shouldRequireConfirmCheckbox(
    { exceptionCount, failingRuleCount, validationStale },
    confirmAlways,
  );
  const canConfirm = (!requireCheckbox || checked) && (failingRuleCount === 0 || ackValidation);
  // Empty string is treated as unknown too — the caller's fallback chain used to
  // produce one, and "the transformed  order" reads as a rendering bug.
  const formatLabel = outputFormat?.trim() ? outputFormat.trim().toUpperCase() : null;
  const checkRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "spine-confirm-title";

  // Move focus into the dialog on open (the checkbox when it renders, else the
  // primary confirm button), trap Tab inside it, close on Escape, and restore
  // focus to the previously-focused element (the Send button) on close.
  // All five behaviours come from the shared hook now; this file used to carry
  // its own copy. Enter-to-confirm stays local — it is this dialog's own
  // shortcut, not part of the shared contract.
  useDialogA11y({
    open: true,
    onClose: onCancel,
    panelRef: dialogRef,
    // `requireCheckbox` is the render-time predicate for whether checkRef's input
    // exists at all — reading `checkRef.current` here would be null on first
    // render and would silently always pick the button.
    initialFocusRef: requireCheckbox ? checkRef : confirmBtnRef,
  });

  // Keep the latest values for the keydown handler without re-registering the
  // listener on every render.
  const keyHandlerState = useRef({ canConfirm, onConfirm });
  keyHandlerState.current = { canConfirm, onConfirm };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      const { canConfirm, onConfirm } = keyHandlerState.current;
      if (e.key === "Enter" && canConfirm) onConfirm();
    }
    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(11,26,47,0.6)", backdropFilter: "blur(4px)", zIndex: 9990 }} onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 440, maxWidth: "calc(100vw - 32px)", background: "#FFFFFF", borderRadius: 12, boxShadow: "0 24px 64px rgba(11,26,47,0.22)", border: "1px solid #E5E8EE", zIndex: 9991, overflow: "hidden" }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          <div id={titleId} style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 700, color: "#0B1A2F", marginBottom: 6 }}>{inbound ? "Confirm this order?" : "Send order to supplier?"}</div>
          <p style={{ fontSize: 13, color: "#5E6779", lineHeight: 1.55, margin: 0 }}>
            This will {inbound ? "confirm" : "deliver"} the transformed{formatLabel ? ` ${formatLabel}` : ""} order {inbound ? "for" : "to"} <strong style={{ color: "#0B1A2F" }}>{supplierName}</strong>
          </p>
        </div>

        {/* Summary */}
        <div style={{ margin: "16px 24px", padding: "12px 14px", background: "#F6F7FA", borderRadius: 8, border: "1px solid #E5E8EE" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Grand total",    value: grandTotal },
              { label: "Lines",          value: `${lineCount} item${lineCount !== 1 ? "s" : ""}` },
              { label: "Issues to review", value: `${exceptionCount}`, color: exceptionCount > 0 ? "#8A5310" : "#1E6D29" },
              { label: "Format",         value: formatLabel ?? "Not known yet" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: color ?? "#0B1A2F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Where the order goes. The consent step for an irreversible action must
            say the destination — or that there is none, BEFORE the server refuses
            (the first mention of missing delivery used to be the post-failure
            problem panel). Three-valued; unknown claims nothing either way and
            nothing here gates the confirm button — the server owns refusal. */}
        {deliverySetup.state === "configured" && (
          <div style={{ margin: "0 24px 16px", fontSize: 12.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>
            {configuredDeliverySentence(deliverySetup.config, supplierName)}
          </div>
        )}
        {deliverySetup.state === "not_configured" && (
          <div style={{ margin: "0 24px 16px", padding: "10px 12px", background: "var(--amber-soft)", border: "1px solid var(--amber)", borderRadius: 6, fontSize: 12.5, color: "var(--amber-text)", lineHeight: 1.5 }}>
            No delivery is set up for <strong style={{ fontWeight: 700 }}>{supplierName}</strong> — this send will fail.{" "}
            <Link
              href={deliverySetup.supplierId ? `/library/suppliers/${deliverySetup.supplierId}?tab=delivery` : "/library/suppliers"}
              style={{ color: "var(--amber-text)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Set up delivery →
            </Link>
          </div>
        )}
        {deliverySetup.state === "unknown" && (
          <div style={{ margin: "0 24px 16px", padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5 }}>
            We couldn&apos;t check whether delivery is set up for {supplierName} — sending is still available.
          </div>
        )}

        {/* Confirmation checkbox — policy-driven (always by default; conditional
            when NEXT_PUBLIC_CONFIRM_ALWAYS=false and nothing needs acknowledging). */}
        {requireCheckbox && (
          <div style={{ margin: "0 24px 20px", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <input
              ref={checkRef}
              type="checkbox"
              id="confirm-check"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ marginTop: 2, width: 15, height: 15, accentColor: "#2E8E3A", cursor: "pointer", flexShrink: 0 }}
            />
            <label htmlFor="confirm-check" style={{ fontSize: 13, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
              {/* The sentence is NOT written here. This arm used to read
                  "Everything checks out." off exceptionCount alone, which stated
                  a verdict on a check that never runs AND contradicted the
                  failed-rules panel a few lines below. acceptanceGateModel owns
                  the ladder now, failingRuleCount included. */}
              {confirmAckLabel({
                exceptionCount,
                failingRuleCount,
                actionPhrase: inbound ? `Confirm for ${supplierName}` : `Send to ${supplierName}`,
              })}
            </label>
          </div>
        )}

        {/* Stale-validation note — CONDITIONAL MODE ONLY (flag=false), where it
            explains why the checkbox appears on an otherwise-clean order while
            the auto-revalidate settles. Default mode stays byte-identical. */}
        {!confirmAlways && validationStale && (
          <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#FFF8EA", border: "1px solid #F0D39A", borderRadius: 6, fontSize: 11.5, color: "#7A4D0A" }}>
            Acceptance validation is re-checking after your last change — results may update.
          </div>
        )}

        {/* Validation-failure acknowledgement — only when the last "Validate
            against profile" run found failing acceptance rules. Doesn't hard-block
            (the supplier may still accept), but requires an explicit ack. */}
        {failingRuleCount > 0 && (
          <div style={{ margin: "0 24px 20px", padding: "10px 12px", background: "#FFF7F7", border: "1px solid var(--danger-soft)", borderRadius: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--danger)", marginBottom: 6 }}>
              ⚠ {failingRuleCount} acceptance rule{failingRuleCount !== 1 ? "s" : ""} failed validation
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input
                type="checkbox"
                id="confirm-ack-validation"
                checked={ackValidation}
                onChange={(e) => setAckValidation(e.target.checked)}
                style={{ marginTop: 2, width: 15, height: 15, accentColor: "#B43838", cursor: "pointer", flexShrink: 0 }}
              />
              <label htmlFor="confirm-ack-validation" style={{ fontSize: 12.5, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
                Send anyway — I understand this order doesn&apos;t meet {supplierName}&apos;s acceptance rules and may be rejected.
              </label>
            </div>
          </div>
        )}

        {/* Retry note. It used to promise, unconditionally and with no prop and no
            gate: three automatic retries, 30-minute intervals, and an email. All
            three clauses were false, checked against the backend:
              • DeliveryReliabilityOptions.MaxAttempts = 3, documented as "first
                attempt + 2 backoff retries" — so TWO retries, not three.
              • BackoffMinutes = { 30, 60, 120 } doubles, and RetryJitterPercent
                = 20 pushes each step further up. Not 30-minute intervals.
              • IEmailSender has one production consumer, SupportContactService
                (the contact form). No delivery-failure email exists anywhere.
              • And a business rejection gets ZERO retries — DeliverOrderJob.cs
                returns early on SupplierResponseClassification
                .SuppressesAutomaticRetry, which is true exactly for a refusal the
                supplier read and sent back.
            Deliberately carries no numbers: the schedule is configuration
            (section Delivery:Reliability), so any figure printed here is a promise
            that drifts the moment an option changes. */}
        <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#ECFDF3", borderRadius: 6, fontSize: 11.5, color: "#1E6D29" }}>
          If delivery fails we retry automatically, waiting longer each time — but a refusal
          from the {labels.counterpartyNoun.toLowerCase()} is not retried. Either way the order
          comes back here with what happened.
        </div>

        {/* Actions */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E5E8EE", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500, background: "#FFFFFF", color: "#5E6779", border: "1px solid #E5E8EE", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            onClick={() => canConfirm && onConfirm()}
            disabled={!canConfirm}
            style={{ padding: "9px 24px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: canConfirm ? "#0B1A2F" : "#CBD0DA", color: "#FFFFFF", border: "none", cursor: canConfirm ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 8, transition: "background 150ms" }}
          >
            {labels.primaryCta} →
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1E6D29,#2E8E3A)", display: "inline-block" }} />
          </button>
        </div>
      </div>
    </>
  );
}
