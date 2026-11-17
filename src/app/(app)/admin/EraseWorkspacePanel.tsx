"use client";

// Erase a whole workspace — POST /api/admin/organisations/{id}/erase.
//
// IRREVERSIBLE, so it is an inline panel under the row rather than a modal: the row
// and its slug stay in view, and the button only arms once the exact slug is typed
// back. The server re-checks the slug (400) and refuses a paid workspace whose agreement
// is not confirmed ended, or one Stripe or billing still ties up (409); an operator can
// act on those refusals, so each is named.

import { useState } from "react";
import { ApiHttpError, eraseOrganisation, type AdminOrganisation, type OrgEraseReceipt } from "@/lib/api-client";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

// A 409 is a refusal the server made before touching anything. Anything else may have landed
// mid-erase, so it never claims nothing happened.
function refusalMessage(err: unknown): string {
  const code = err instanceof ApiHttpError && err.status === 409 ? (err.body as { error?: string } | null)?.error : undefined;
  if (code === "billing_evidence") return "This workspace has been billed for overage — its billing records can't be erased.";
  if (code === "paid_subscription")
    return "This workspace has paid. Erase it only after the agreement has ended — tick the box above to confirm it has.";
  if (code === "subscription_running")
    return "Stripe still shows a running subscription for this workspace — cancel it in Stripe first.";
  if (code === "subscription_unknown")
    return "Stripe could not confirm the subscription has ended, so nothing was erased. Try again, or check the customer in Stripe.";
  if (code === "unbilled_overage")
    return "This workspace has overage that is not billed yet — erase it once the final invoice is out.";
  if (code) return `The server refused the erase (${code}).`;
  return "The erase did not confirm. Run it again — if it already ran, the earlier receipt comes back.";
}

export function EraseWorkspacePanel({ org, onClose }: { org: AdminOrganisation; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [agreementEnded, setAgreementEnded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OrgEraseReceipt | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      setReceipt(await eraseOrganisation(org.id, typed, agreementEnded));
    } catch (err) {
      setError(refusalMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const panel = { display: "flex", flexDirection: "column", gap: 10, padding: 12, textAlign: "left", whiteSpace: "normal" } as const;

  if (receipt) {
    const tables = Object.entries(receipt.rowsDeleted).filter(([, n]) => n > 0);
    const rows = tables.reduce((sum, [, n]) => sum + n, 0);
    const removed = receipt.signInAccountsRemoved ?? 0;
    const failed = [...receipt.failedBlobKeys, ...(receipt.failedSignInAccounts ?? [])];
    const signInFailed = receipt.failedSignInAccounts?.length ?? 0;
    const leftBehind = receipt.failedBlobKeys.length > 0 || receipt.signIn === "failed" || receipt.signIn === "skipped_no_key";
    const list = { fontSize: 11.5, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" } as const;
    return (
      <div data-testid="admin-erase-panel" style={panel}>
        <StatusNotice
          tone={leftBehind ? "warning" : "success"}
          action={<Button variant="secondary" size="sm" onClick={onClose}>Done</Button>}
        >
          Erased {org.name}: {rows} rows across {tables.length} tables, {receipt.blobsDeleted} stored files.
          {receipt.failedBlobKeys.length > 0 && ` ${receipt.failedBlobKeys.length} stored files could not be deleted — they are listed in the receipt.`}
          {receipt.signIn === "done" && ` Removed ${removed} sign-in ${removed === 1 ? "account" : "accounts"}.`}
          {receipt.signIn === "failed" &&
            (signInFailed > 0
              ? ` ${signInFailed} sign-in steps failed — they are listed in the receipt.`
              : " Sign-in accounts could not be removed. Check the workspace in Clerk and remove them by hand.")}
          {receipt.signIn === "skipped_no_key" &&
            " Sign-in accounts were not removed: no sign-in key is set on the server. Remove them by hand in Clerk."}
        </StatusNotice>
        <div style={list}>{tables.map(([table, n]) => `${table} ${n}`).join(" · ")}</div>
        {failed.length > 0 && <div style={list}>{failed.join(" · ")}</div>}
      </div>
    );
  }

  return (
    <div data-testid="admin-erase-panel" style={panel}>
      <div style={{ fontSize: 13, color: "var(--ink)" }}>
        Permanently erases <strong>{org.name}</strong> — every order, supplier, mapping, setting and stored
        file. This cannot be undone.
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--ink-muted)" }}>
        <span>
          Type <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{org.slug}</code> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="rounded-[8px] px-3 py-2 text-[13px]"
          style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", maxWidth: 360 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-muted)" }}>
        <input type="checkbox" checked={agreementEnded} onChange={(e) => setAgreementEnded(e.target.checked)} />
        The customer&apos;s agreement has ended (needed for a workspace that has paid)
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="danger" size="sm" disabled={typed !== org.slug || submitting} onClick={submit}>
          {submitting ? "Erasing…" : "Erase permanently"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error && <StatusNotice tone="error">{error}</StatusNotice>}
    </div>
  );
}
