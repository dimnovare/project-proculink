"use client";

// Delete chosen documents of one workspace on a written request —
// POST /api/admin/organisations/{id}/documents/erase.
//
// IRREVERSIBLE, so it follows EraseWorkspacePanel: an inline panel under the row, armed
// only once there is a filter (ids or a date) and the exact slug is typed back. A field
// left empty is left out of the request rather than sent empty.

import { useState } from "react";
import { ApiHttpError, eraseDocuments, type AdminOrganisation, type DocumentEraseReceipt } from "@/lib/api-client";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

// Only the missing-filter 400 is known to have touched nothing; anything else may have
// landed part-way, so it never claims nothing happened.
function refusalMessage(err: unknown): string {
  const code = err instanceof ApiHttpError && err.status === 400 ? (err.body as { error?: string } | null)?.error : undefined;
  return code === "filter_required"
    ? "Give at least one document id or a date."
    : "The delete did not confirm. Run it again — documents already deleted are left out.";
}

const label = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--ink-muted)" } as const;
const field = { border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", maxWidth: 360 } as const;
const panel = { display: "flex", flexDirection: "column", gap: 10, padding: 12, textAlign: "left", whiteSpace: "normal" } as const;

export function EraseDocumentsPanel({ org, onClose }: { org: AdminOrganisation; onClose: () => void }) {
  const [idsText, setIdsText] = useState("");
  const [date, setDate] = useState("");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DocumentEraseReceipt | null>(null);

  const ids = idsText.split(/[\s,]+/).filter(Boolean);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      setReceipt(
        await eraseDocuments(org.id, {
          confirmSlug: typed,
          ...(ids.length ? { ids } : {}),
          ...(date ? { receivedBefore: `${date}T00:00:00Z` } : {}),
        }),
      );
    } catch (err) {
      setError(refusalMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    const tables = Object.entries(receipt.rowsDeleted).filter(([, n]) => n > 0);
    const rows = tables.reduce((sum, [, n]) => sum + n, 0);
    return (
      <div data-testid="admin-erase-documents-panel" style={panel}>
        <StatusNotice tone="success" action={<Button variant="secondary" size="sm" onClick={onClose}>Done</Button>}>
          <div>Deleted {receipt.documentsErased} documents: {rows} rows, {receipt.blobsDeleted} stored files.</div>
          {receipt.failedBlobKeys.length > 0 && (
            <div>{receipt.failedBlobKeys.length} stored files could not be deleted — they are listed in the receipt.</div>
          )}
          {receipt.skippedInFlight.length > 0 && (
            <div>{receipt.skippedInFlight.length} were still being read or sent and were left alone — run it again later.</div>
          )}
          {receipt.more && <div>More documents match — run it again to continue.</div>}
        </StatusNotice>
        <div style={{ fontSize: 11.5, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {[...tables.map(([table, n]) => `${table} ${n}`), ...receipt.failedBlobKeys].join(" · ")}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="admin-erase-documents-panel" style={panel}>
      <div style={{ fontSize: 13, color: "var(--ink)" }}>
        Permanently deletes the chosen documents of <strong>{org.name}</strong> and their stored files. This cannot be
        undone.
      </div>
      <label style={label}>
        <span>Document ids (one per line)</span>
        <textarea
          value={idsText}
          onChange={(e) => setIdsText(e.target.value)}
          rows={4}
          spellCheck={false}
          className="rounded-[8px] px-3 py-2 text-[13px]"
          style={{ ...field, fontFamily: "var(--font-mono)" }}
        />
      </label>
      <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: -6 }}>
        A document&apos;s id is the last part of its address in the app.
      </div>
      <label style={label}>
        <span>Or everything received before</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-[8px] px-3 py-2 text-[13px]" style={field} />
      </label>
      <label style={label}>
        <span>
          Type <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{org.slug}</code> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="rounded-[8px] px-3 py-2 text-[13px]"
          style={field}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          variant="danger"
          size="sm"
          disabled={(!ids.length && !date) || typed !== org.slug || submitting}
          onClick={submit}
        >
          {submitting ? "Deleting…" : "Delete documents"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error && <StatusNotice tone="error">{error}</StatusNotice>}
    </div>
  );
}
