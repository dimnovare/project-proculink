"use client";

// The two reversible admin WRITES that were curl-only, as confirmed dialogs.
//
//   POST /api/admin/organisations/{id}/account-status   un-freeze a Pilot workspace
//   POST /api/admin/organisations/{id}/retention        set/clear the blob-retention window
//
// ── WHY BOTH ARE DIALOGS AND NOT ROW BUTTONS ─────────────────────────────────
//
// Neither is destructive in the sense the erasure endpoints are, but both change
// what happens to a customer without the customer being present. Un-freezing
// re-opens every ingest path for a workspace with no subscription behind it.
// Setting a retention window hands the next sweep permission to delete stored
// files. A one-click row control for either is a fat-finger away from a support
// conversation nobody wants, so each names its consequence and asks.
//
// ── ELIGIBILITY IS COMPUTED, NOT ATTEMPTED ───────────────────────────────────
//
// See `canUnfreeze` below. AdminController.SetOrganisationAccountStatus permits
// EXACTLY ONE transition and 400s on four separate branches. The row only offers
// the control when all four are already satisfied by data the customers table
// holds — offering a button that usually 400s teaches the operator to distrust
// the whole screen.
//
// ── A 200 IS NOT A SUCCESS HERE ──────────────────────────────────────────────
//
// The account-status response reports the EFFECTIVE status after the canonical
// trial-window arbiter re-runs, which re-freezes an org whose Pilot window has
// already elapsed. `revertedByTrialWindow` is the server telling us the write
// did not achieve its purpose, and it is rendered as a failure, not as green.

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import {
  setOrgAccountStatus,
  setOrgRetention,
  type AdminOrganisation,
  type OrgAccountStatusResult,
  type OrgRetentionResult,
} from "@/lib/api-client";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

/**
 * The four conditions AdminController.SetOrganisationAccountStatus checks before
 * it will move an org to `trialing`, read off the row the table already has.
 * Keep this in step with the controller — an eligible-looking row that 400s is
 * worse than no button at all.
 */
export function canUnfreeze(org: AdminOrganisation): boolean {
  return (
    org.accountStatus.toLowerCase() === "read_only" &&
    org.plan.toLowerCase() === "pilot" &&
    !org.stripeSubscriptionId
  );
}

// ── Shared dialog chrome ─────────────────────────────────────────────────────

function Dialog({
  testId,
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  testId: string;
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y({ open: true, onClose, panelRef });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6"
      style={{ background: "color-mix(in srgb, var(--navy) 55%, transparent)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="w-full max-w-[540px] rounded-[14px]"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal, var(--shadow-card))",
        }}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              className="text-[17px] font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)", margin: 0 }}
            >
              {title}
            </h2>
            <div className="mt-0.5 text-[12px]" style={{ color: "var(--ink-faint)" }}>
              {sub}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-[6px] bg-transparent"
            style={{
              color: "var(--ink-faint)",
              border: 0,
              cursor: "pointer",
              height: 28,
              width: 28,
              flexShrink: 0,
            }}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="px-5 py-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {children}
        </div>

        <div
          className="flex flex-wrap items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

/** A consequence paragraph. Deliberately not a tone banner — nothing has gone wrong yet. */
function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[13px]"
      style={{ color: "var(--ink)", margin: 0, lineHeight: 1.55 }}
    >
      {children}
    </p>
  );
}

// ── Un-freeze ────────────────────────────────────────────────────────────────

export function UnfreezeOrgModal({
  org,
  onClose,
  onSaved,
}: {
  org: AdminOrganisation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrgAccountStatusResult | null>(null);

  const reverted = result?.revertedByTrialWindow === true;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await setOrgAccountStatus(org.id, "trialing");
      setResult(res);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The account status is unchanged — the server refused and gave no reason.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      testId="admin-unfreeze-modal"
      title="Unfreeze workspace"
      sub={`${org.name} · ${org.plan} · ${org.accountStatus.replace(/_/g, " ")}`}
      onClose={onClose}
      footer={
        result ? (
          <Button variant="blue" size="md" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="blue"
              size="md"
              onClick={submit}
              disabled={!acknowledged || submitting}
              loading={submitting}
            >
              Unfreeze workspace
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          {/* The EFFECTIVE status, not the requested one. When the trial-window
              arbiter re-froze the org this is a failure with a 200 status code,
              and must not be painted green. */}
          <StatusNotice tone={reverted ? "error" : "success"}>
            {reverted
              ? (result.note ??
                "The workspace was un-frozen and the trial-window check returned it to a frozen state straight away.")
              : `${result.name} is un-frozen and accepting orders again.`}
          </StatusNotice>
          <dl className="text-[13px]" style={{ color: "var(--ink)", margin: 0 }}>
            <ResultRow label="Was" value={result.previousAccountStatus} />
            <ResultRow label="Requested" value={result.requestedAccountStatus} />
            <ResultRow label="Effective status" value={result.accountStatus} />
            <ResultRow
              label="Trial ends"
              value={
                result.effectiveTrialEndsAt
                  ? new Date(result.effectiveTrialEndsAt).toLocaleDateString("en-IE", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "—"
              }
            />
          </dl>
          {reverted && (
            <p className="text-[12.5px]" style={{ color: "var(--ink-muted)", margin: 0 }}>
              Give the workspace more time or more order headroom with Adjust limits, then
              unfreeze again. In that order it sticks.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Consequence>
            This moves {org.name} from read-only back to a running Pilot trial. Full processing
            resumes immediately and there is <strong>no subscription</strong> behind it: uploads,
            emailed orders, IMAP, SFTP, S3 and the REST API all start accepting orders again the
            moment this lands. The only remaining backstops are the Pilot trial window and its
            20-order allowance.
          </Consequence>
          <Consequence>
            Do this because you have agreed with the customer that their evaluation continues —
            not to clear an alert. It is reversible only through Stripe or by the trial window
            expiring again.
          </Consequence>
          <label
            className="flex items-start gap-2 text-[12.5px]"
            style={{ color: "var(--ink-muted)" }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I have agreed with this customer that their trial continues, and I am re-opening
              order processing for them.
            </span>
          </label>
          {error && <StatusNotice tone="error">{error}</StatusNotice>}
        </div>
      )}
    </Dialog>
  );
}

// ── Retention ────────────────────────────────────────────────────────────────

export function RetentionModal({
  org,
  onClose,
}: {
  org: AdminOrganisation;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"set" | "clear">("set");
  const [days, setDays] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrgRetentionResult | null>(null);

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1;
  const canSubmit = mode === "clear" ? true : daysValid && acknowledged;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await setOrgRetention(
        org.id,
        mode === "clear" ? { clear: true } : { retentionDays: parsedDays },
      );
      setResult(res);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The retention window is unchanged — the server refused and gave no reason.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      testId="admin-retention-modal"
      title="Data retention"
      sub={`${org.name} · ${org.slug}`}
      onClose={onClose}
      footer={
        result ? (
          <Button variant="blue" size="md" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={mode === "clear" ? "secondary" : "blue"}
              size="md"
              onClick={submit}
              disabled={!canSubmit || submitting}
              loading={submitting}
            >
              {mode === "clear" ? "Turn retention off" : "Set retention window"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <StatusNotice tone="success">
          {result.retentionEnabled
            ? `${result.name} now keeps stored order files for ${result.retentionDays} days. The next sweep will delete anything older.`
            : `${result.name} has retention turned off. Nothing will be deleted for this workspace.`}
        </StatusNotice>
      ) : (
        <div className="flex flex-col gap-3">
          <Consequence>
            A retention window opts this workspace into the daily sweep that{" "}
            <strong>permanently deletes</strong> the stored source files and generated output of
            completed orders older than the window. The order records, their hashes, the field
            provenance and the audit trail <strong>stay</strong> — it is the files that go, and
            they cannot be recovered.
          </Consequence>
          <Consequence>
            Lowering an existing window is the dangerous direction: the very next sweep deletes
            everything that has just fallen outside it.
          </Consequence>
          <p className="text-[12px]" style={{ color: "var(--ink-muted)", margin: 0 }}>
            The customers list does not carry the current window, so this sets a value rather
            than editing a known one — the response below reports what was stored. Deletion also
            needs the worker&apos;s global dry-run latch to be off; while it is on, this setting
            is recorded and nothing is removed.
          </p>

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="mb-1 text-[12px] font-semibold" style={{ color: "var(--ink-muted)" }}>
              Retention for this workspace
            </legend>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
              <input
                type="radio"
                name="retention-mode"
                checked={mode === "set"}
                onChange={() => setMode("set")}
              />
              Keep files for a fixed number of days
            </label>
            <label
              className="mt-1.5 flex items-center gap-2 text-[13px]"
              style={{ color: "var(--ink)" }}
            >
              <input
                type="radio"
                name="retention-mode"
                checked={mode === "clear"}
                onChange={() => setMode("clear")}
              />
              Turn retention off (nothing is ever deleted)
            </label>
          </fieldset>

          {mode === "set" && (
            <>
              <div>
                <label
                  className="mb-1 block text-[12px] font-semibold"
                  htmlFor="retention-days"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Retention days
                </label>
                <input
                  id="retention-days"
                  type="number"
                  min={1}
                  step={1}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  aria-label="Retention days"
                  placeholder="e.g. 90"
                  className="w-full rounded-[8px] px-3 py-2 text-[13px]"
                  style={{
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                    minHeight: "var(--tap-min)",
                  }}
                />
              </div>
              <label
                className="flex items-start gap-2 text-[12.5px]"
                style={{ color: "var(--ink-muted)" }}
              >
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I understand the next retention sweep will permanently delete this
                  workspace&apos;s stored order files older than this window, and that they
                  cannot be recovered.
                </span>
              </label>
            </>
          )}

          {error && <StatusNotice tone="error">{error}</StatusNotice>}
        </div>
      )}
    </Dialog>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1">
      <dt style={{ color: "var(--ink-muted)", minWidth: 132 }}>{label}</dt>
      <dd className="font-mono" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
