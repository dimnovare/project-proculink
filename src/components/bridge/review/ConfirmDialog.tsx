"use client";

// ConfirmDialog — the send/confirm modal with focus trap and the
// failing-acceptance-rules acknowledgement. Moved as-is from SpineReview.tsx
// (batch 9 Phase A). Phase B: the confirmation checkbox is now policy-driven
// (confirmPolicy.ts) behind NEXT_PUBLIC_CONFIRM_ALWAYS — the default (flag
// unset) keeps today's always-on checkbox byte-identical; "false" makes it
// conditional (renders only when exceptions / failing rules / stale validation
// give the operator something real to acknowledge).

import { useState, useRef, useEffect } from "react";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { shouldRequireConfirmCheckbox, confirmAlwaysFlag } from "./confirmPolicy";

export function ConfirmDialog({ exceptionCount, onConfirm, onCancel, supplierName, outputFormat, grandTotal, lineCount, labels, failingRuleCount, validationStale = false }: {
  exceptionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  supplierName: string;
  outputFormat: string;
  grandTotal: string;
  lineCount: number;
  labels: PartyLabels;
  /** Number of acceptance-profile rules that FAILED the last validation; 0 if it passed or wasn't run. Requires an explicit ack before send. */
  failingRuleCount: number;
  /** True while the acceptance validation is stale / re-running after a commit. */
  validationStale?: boolean;
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
  const checkRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "spine-confirm-title";

  // Move focus into the dialog on open (the checkbox when it renders, else the
  // primary confirm button) and restore it to the previously-focused element
  // (the Send button) when the dialog closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (checkRef.current) checkRef.current.focus();
    else confirmBtnRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Keep the latest values for the keydown handler without re-registering the
  // listener on every render. canConfirm/onConfirm/onCancel can change between
  // renders (checkbox toggles), so read them through a ref inside a stable
  // listener registered once.
  const keyHandlerState = useRef({ canConfirm, onConfirm, onCancel });
  keyHandlerState.current = { canConfirm, onConfirm, onCancel };

  // Focus trap scoped to the DIALOG element (not document): Tab/Shift-Tab cycle
  // within the dialog's focusable elements, Escape closes, Enter confirms.
  // Registered once on mount; cleanup removes the listener (WCAG-compliant modal).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleKeyDown(e: KeyboardEvent) {
      const { canConfirm, onConfirm, onCancel } = keyHandlerState.current;
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key === "Enter" && canConfirm) { onConfirm(); return; }
      // Focus trap — keep Tab within the dialog's focusable elements.
      if (e.key === "Tab") {
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
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
            This will {inbound ? "confirm" : "deliver"} the transformed {outputFormat.toUpperCase()} order {inbound ? "for" : "to"} <strong style={{ color: "#0B1A2F" }}>{supplierName}</strong>
          </p>
        </div>

        {/* Summary */}
        <div style={{ margin: "16px 24px", padding: "12px 14px", background: "#F6F7FA", borderRadius: 8, border: "1px solid #E5E8EE" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Grand total",    value: grandTotal },
              { label: "Lines",          value: `${lineCount} item${lineCount !== 1 ? "s" : ""}` },
              { label: "Issues to review", value: `${exceptionCount}`, color: exceptionCount > 0 ? "#B36D14" : "#1E6D29" },
              { label: "Format",         value: outputFormat.toUpperCase() },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: color ?? "#0B1A2F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

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
              {exceptionCount === 0
                ? <>Everything checks out. {inbound ? `Confirm for ${supplierName}` : `Send to ${supplierName}`}.</>
                : <>I&apos;ve reviewed the {exceptionCount} issue{exceptionCount !== 1 ? "s" : ""}. {inbound ? `Confirm for ${supplierName}` : `Send to ${supplierName}`}.</>}
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

        {/* Retry note */}
        <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#ECFDF3", borderRadius: 6, fontSize: 11.5, color: "#1E6D29" }}>
          On delivery failure: 3 automatic retries · 30-min intervals · we&apos;ll email you
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
