"use client";

// Erase a whole workspace — POST /api/admin/organisations/{id}/erase.
//
// IRREVERSIBLE, so it is an inline panel under the row rather than a modal: the row
// and its slug stay in view, and the button only arms once the exact slug is typed
// back. The server re-checks the slug (400) and refuses a paying or billed workspace
// (409); that refusal is the one an operator can act on, so it is named.

import { useState } from "react";
import { ApiHttpError, eraseOrganisation, type AdminOrganisation, type OrgEraseReceipt } from "@/lib/api-client";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

// A 409 is a refusal the server made before touching anything. Anything else may have landed
// mid-erase, so it never claims nothing happened.
function refusalMessage(err: unknown): string {
  const code = err instanceof ApiHttpError && err.status === 409 ? (err.body as { error?: string } | null)?.error : undefined;
  if (code === "billing_evidence") return "This workspace has been billed for overage — its billing records can't be erased.";
  if (code === "paid_subscription") return "This workspace has a paid subscription — cancel it in Stripe first.";
  if (code) return `The server refused the erase (${code}).`;
  return "The erase did not confirm — check the receipt before retrying.";
}

export function EraseWorkspacePanel({ org, onClose }: { org: AdminOrganisation; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OrgEraseReceipt | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      setReceipt(await eraseOrganisation(org.id, typed));
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
    return (
      <div data-testid="admin-erase-panel" style={panel}>
        <StatusNotice tone="success" action={<Button variant="secondary" size="sm" onClick={onClose}>Done</Button>}>
          Erased {org.name}: {rows} rows across {tables.length} tables, {receipt.blobsDeleted} stored files.
          {receipt.failedBlobKeys.length > 0 && ` ${receipt.failedBlobKeys.length} stored files could not be deleted — they are listed in the receipt.`}
        </StatusNotice>
        <div style={{ fontSize: 11.5, color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>
          {tables.map(([table, n]) => `${table} ${n}`).join(" · ")}
        </div>
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
