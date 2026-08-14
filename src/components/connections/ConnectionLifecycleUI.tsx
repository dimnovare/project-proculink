"use client";

// Shared lifecycle UI for the connection version-history surfaces — STRUCT-1.
//
// The confirm dialog (publish / rollback / discard) and the inline notice banner
// were previously inlined in ConnectionDetail. STRUCT-1 relocates the
// version-history VIEW onto the supplier page (SupplierHistoryTab), so these two
// pieces are extracted here and consumed by BOTH surfaces — keeping the copy and
// behavior identical.

import { useRef } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { isPlanGate, PlanGateNotice } from "@/components/bridge/PlanGateNotice";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { ConfirmState, Notice } from "@/components/connections/useConnectionRevisions";

/**
 * Three tones, because a check run has an outcome that is neither good news nor bad.
 *
 * `warn` carries the run that found no fault and tested nothing — no orders existed to
 * run this version against, which is the DEFAULT state at onboarding. Green would say
 * "carry on" over evidence that does not exist; red would say "you broke something" when
 * nothing is broken. Both were available before this; neither was true.
 */
export const NOTICE_TONE_STYLE: Record<NonNullable<Notice>["kind"], React.CSSProperties> = {
  ok: { border: "1px solid var(--brand-green-soft)", borderLeft: "3px solid var(--brand-green)", background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" },
  warn: { border: "1px solid var(--amber-soft)", borderLeft: "3px solid var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)" },
  err: { border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" },
};

/** Inline ok/warn/err status banner driven by the hook's `notice` state. */
export function ConnectionNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  // The lifecycle mutations (create draft / publish / rollback) are refused on plan grounds
  // when the bundle selects a gated protocol or output format. onMutationError puts the
  // server's raw body here, so recognise it and show the upsell rather than the token.
  if (notice.kind === "err" && isPlanGate(notice.text)) {
    return <PlanGateNotice className="mb-4" error={notice.text} capability="This connection setup" />;
  }
  return (
    <div
      role="status"
      className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
      data-testid="connection-notice"
      data-tone={notice.kind}
      style={NOTICE_TONE_STYLE[notice.kind]}
    >
      {notice.text}
    </div>
  );
}

// ── Confirm dialog (publish / rollback / discard) ────────────────────────────

export function ConnectionConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: NonNullable<ConfirmState>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Mounted only while open, so `open` is constant true — the hook keys off
  // mount/unmount. Publish / rollback / discard are irreversible-ish actions, so
  // Escape maps to CANCEL (never to confirm).
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y({ open: true, onClose: onCancel, panelRef });

  const isPublish = state.kind === "publish";
  const isRollback = state.kind === "rollback";
  const title = isPublish
    ? `Make v${state.versionNo} live?`
    : isRollback
      ? `Restore v${state.versionNo}?`
      : "Delete this draft?";
  const body = isPublish
    ? "Orders from now on use this setup. Orders you've already sent keep their original format — they won't change mid-delivery. This is reversible: you can go back to a previous version anytime."
    : isRollback
      ? "Go back to this older version for new orders — it becomes live again, exactly as it was. You can switch forward to a newer version later, so nothing is lost."
      : "Removes this test copy and its unsaved changes. Your live version stays unchanged. You can start a new test copy anytime.";
  const confirmLabel = isPublish ? "Make live" : isRollback ? "Restore" : "Discard";

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-[80] flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-confirm-title"
    >
      <div
        className="w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[440px] sm:rounded-[10px]"
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 id="connection-confirm-title" className="text-[17px] font-semibold leading-tight" style={{ color: "var(--ink)" }}>
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-[1.55] m-0" style={{ color: "var(--ink-muted)" }}>
            {body}
          </p>
        </div>
        <div
          className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}
        >
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={isPublish || isRollback ? "primary" : "danger"}
            size="md"
            onClick={onConfirm}
            disabled={busy}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
