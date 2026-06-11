"use client";

// ManualCodeRow — manual supplier-code entry row for an unresolved line.
// Extracted as-is from SpineReview.tsx (batch 9 Phase A) so the classic
// triptych and the Fix Queue rail share one implementation. Free text + a
// native <datalist> typeahead of the supplier's known codes (zero deps,
// accessible). Enter commits, Escape cancels. Persistence is the caller's job
// (commitMappings via useResolveActions — the single server path, gate G2).

// Manual supplier-code entry API, threaded into the line cards so the control
// renders identically on mobile / tablet / desktop / triage. Persistence goes
// through the SAME /resolve path as Accept (commitMappings + refetch) so the
// server needsReview send-guard clears.
export interface LineEditApi {
  /** Datalist typeahead codes (supplier catalog ∪ saved mappings). */
  knownCodes: string[];
  /** The supplier's CATALOG codes — the ground truth of valid codes. Empty if no catalog uploaded. */
  catalogCodes: string[];
  /** Supplier display name, for the "not in {supplier}'s catalog" warning. */
  supplierName: string;
  /** Line id currently in manual-entry mode (only one at a time), or null. */
  editId: string | null;
  /** Current draft text in the manual-entry input. */
  draft: string;
  onStart: (lineId: string, initial: string) => void;
  onChange: (value: string) => void;
  onCommit: (lineId: string) => void;
  onCancel: () => void;
}

/** The minimal line shape ManualCodeRow needs (subset of SpineReview's SubNode). */
export interface ManualCodeLineRef {
  id: string;
  /** 1-based line number shown in the aria-label. */
  lineNo?: number | null;
  /** Fallback identifier when lineNo is absent (buyer/supplier code). */
  sku: string;
}

export function ManualCodeRow({ sn, lineEdit, saving }: { sn: ManualCodeLineRef; lineEdit: LineEditApi; saving: boolean }) {
  const listId = `known-codes-${sn.id}`;
  const draft = lineEdit.draft.trim();
  const hasCatalog = lineEdit.catalogCodes.length > 0;
  // Strong, ground-truth signal: the supplier has a catalog and this isn't one of its codes.
  const notInCatalog = hasCatalog && draft.length > 0 && !lineEdit.catalogCodes.includes(draft);
  // Soft signal (only when there's no catalog to check against): unseen in saved mappings.
  const novel = !hasCatalog && draft.length > 0 && lineEdit.knownCodes.length > 0 && !lineEdit.knownCodes.includes(draft);
  return (
    <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input
        autoFocus
        list={lineEdit.knownCodes.length ? listId : undefined}
        value={lineEdit.draft}
        onChange={(e) => lineEdit.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); lineEdit.onCommit(sn.id); }
          if (e.key === "Escape") { e.preventDefault(); lineEdit.onCancel(); }
        }}
        placeholder="Supplier code"
        aria-label={`Supplier code for line ${sn.lineNo ?? sn.sku}`}
        disabled={saving}
        style={{ flex: "1 1 140px", minWidth: 120, minHeight: 32, border: "1px solid #2E8E3A", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", background: "#F0FDF4", color: "#0B1A2F" }}
      />
      {lineEdit.knownCodes.length > 0 && (
        <datalist id={listId}>
          {lineEdit.knownCodes.map((c) => <option key={c} value={c} />)}
        </datalist>
      )}
      <button
        type="button"
        onClick={() => lineEdit.onCommit(sn.id)}
        disabled={saving || draft.length === 0}
        style={{ fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2E8E3A", color: "#FFFFFF", cursor: saving || draft.length === 0 ? "default" : "pointer", opacity: saving || draft.length === 0 ? 0.55 : 1, minHeight: 32 }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={lineEdit.onCancel}
        disabled={saving}
        style={{ fontSize: 11, fontWeight: 600, padding: "6px 10px", borderRadius: 6, border: "none", background: "transparent", color: "var(--ink-faint)", cursor: saving ? "default" : "pointer", minHeight: 32 }}
      >
        Cancel
      </button>
      {notInCatalog && (
        <span style={{ flexBasis: "100%", fontSize: 10.5, color: "#C53A3A" }}>
          ⚠ Not in {lineEdit.supplierName || "the supplier"}&apos;s catalog — double-check this is a real supplier code.
        </span>
      )}
      {novel && (
        <span style={{ flexBasis: "100%", fontSize: 10.5, color: "#C97A14" }}>
          Not in saved mappings — it&apos;ll be remembered for next time.
        </span>
      )}
    </div>
  );
}
