"use client";

// useResolveActions — every line/header resolution action on the review screen.
// Extracted from SpineReview.tsx (batch 9 Phase A). SINGLE-PATH RULE (gate G2):
// every mutation here goes through apiClient.commitMappings (POST /resolve) or
// apiClient.acceptAiSuggestions (POST /accept-ai-suggestions) followed by an
// order invalidate + refetch — a line is NEVER marked resolved in local state.
//
// Deliberately DELETED in this extraction (per the 2026-06-11 redesign spec):
//   • handleRejectSubnode + the rejected/accepted local Sets — the P0 dead-end
//     (local strike-through that never reached the server and could only be
//     undone by reloading). "Enter manually" is the honest replacement.
//
// NEW in this extraction:
//   • bulkAcceptSuggestions(minConfidence) — wraps the EXISTING bulk endpoint
//     (one call + ONE refetch instead of N accept round-trips).
//   • confirmFlaggedLine(line) — clears the flagged-but-coded review class by
//     re-committing the line's existing supplier code via the same /resolve
//     path (OrderResolutionService clears NeedsReview unconditionally).
//   • commitVersion — bumps after every successful server commit; consumed by
//     useAcceptanceValidation's debounced auto-revalidate.

import { useState, useRef, useCallback, useMemo, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderLine } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";

export type FlowSetter = (message: string | null, severity?: "info" | "success" | "error") => void;

/** The minimal node shape header editing needs (id + parsed value + editability). */
export interface EditableNodeRef {
  id: string;
  value: string;
  editable?: boolean;
}

export function useResolveActions({ orderId, order, nodes, labels, setFlow, refetchOrder }: {
  orderId: string;
  order: Order | null | undefined;
  /** Canonical nodes (id/value/editable) — drives header edit start + the Tab-chain. */
  nodes: EditableNodeRef[];
  labels: PartyLabels;
  setFlow: FlowSetter;
  refetchOrder: () => Promise<unknown>;
}) {
  const qc = useQueryClient();

  // The line id currently being resolved against the backend (Accept/Save in-flight).
  const [acceptingLineId, setAcceptingLineId] = useState<string | null>(null);
  // The header field id (date/buyer/currency/po/supplier) whose correction is being persisted.
  const [savingHeaderId, setSavingHeaderId] = useState<string | null>(null);
  // Header inline-edit state.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  // Manual supplier-code entry: which line (id) is in edit mode + its draft text.
  const [lineEditId, setLineEditId] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<string>("");
  // Bulk accept in-flight flag.
  const [bulkAccepting, setBulkAccepting] = useState(false);
  // Bumped after EVERY successful server commit (single line, header, bulk).
  const [commitVersion, setCommitVersion] = useState(0);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const refreshFromServer = useCallback(async () => {
    // Pull server truth so the needsReview-based guards recompute.
    await qc.invalidateQueries({ queryKey: ["order", orderId] });
    await refetchOrder();
    setCommitVersion(v => v + 1);
  }, [qc, orderId, refetchOrder]);

  // ── Accept an AI suggestion (was handleAcceptSubnode) ──────────────────────
  // Accept must REALLY resolve the line on the server, not just flip local state:
  // the Send guard reads `order.lines.some(l => l.needsReview)` from server truth,
  // so a purely-local accept would never unblock Send. We commit the AI-suggested
  // supplier code via POST /api/orders/{id}/resolve, then refetch so every guard
  // (exceptionCount, the send button, the keyboard 'a' shortcut) recomputes from
  // the fresh server state. The row collapses to done ONLY after refetch confirms.
  const acceptSuggestion = useCallback((id: string) => {
    if (!order) return;
    const line = order.lines.find(l => l.id === id);
    const code = line?.supplierItemCode ?? line?.aiSuggestion?.supplierItemCode;
    if (!line || !code) return; // nothing the backend can persist
    setAcceptingLineId(id);
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [{ lineNumber: line.lineNumber, supplierItemCode: code }]);
        await refreshFromServer();
      } catch (err) {
        setFlow(err instanceof Error ? err.message : `Couldn't save that ${labels.counterpartyNoun.toLowerCase()} code. Try again.`, "error");
      } finally {
        setAcceptingLineId(null);
      }
    })();
  }, [order, orderId, refreshFromServer, labels, setFlow]);

  // ── Bulk accept (NEW) — one call to the existing endpoint + ONE refetch ────
  const bulkAcceptSuggestions = useCallback((minConfidence: number) => {
    if (bulkAccepting) return;
    setBulkAccepting(true);
    void (async () => {
      try {
        const { accepted } = await apiClient.acceptAiSuggestions(orderId, minConfidence);
        await refreshFromServer();
        setFlow(
          accepted > 0
            ? `Accepted ${accepted} AI suggestion${accepted !== 1 ? "s" : ""} at ≥${Math.round(minConfidence * 100)}% confidence.`
            : `No AI suggestions at ≥${Math.round(minConfidence * 100)}% confidence to accept.`,
          accepted > 0 ? "success" : "info",
        );
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't accept the AI suggestions. Try again.", "error");
      } finally {
        setBulkAccepting(false);
      }
    })();
  }, [orderId, bulkAccepting, refreshFromServer, setFlow]);

  // ── Confirm a flagged-but-coded line (NEW) ─────────────────────────────────
  // A line can be needsReview=true WITH a supplier code already set (e.g. a
  // scanned-PDF review flag). Re-committing its existing code via the same
  // /resolve path clears NeedsReview on the server (verified: the backend
  // clears it unconditionally on resolution) — no new endpoint, no local state.
  const confirmFlaggedLine = useCallback((line: Pick<OrderLine, "id" | "lineNumber" | "supplierItemCode">) => {
    if (!line.supplierItemCode) return;
    setAcceptingLineId(line.id);
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [{ lineNumber: line.lineNumber, supplierItemCode: line.supplierItemCode! }]);
        await refreshFromServer();
        setFlow(`Line ${line.lineNumber} confirmed.`, "success");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't confirm that line. Try again.", "error");
      } finally {
        setAcceptingLineId(null);
      }
    })();
  }, [orderId, refreshFromServer, setFlow]);

  // ── Manual supplier-code entry (the #1 review action) ──────────────────────
  const startLineEdit = useCallback((id: string, initial: string) => {
    setLineEditId(id);
    setLineDraft(initial ?? "");
  }, []);
  const cancelLineEdit = useCallback(() => {
    setLineEditId(null);
    setLineDraft("");
  }, []);
  // Persist a hand-typed supplier code via the SAME server path as Accept
  // (commitMappings → refetch) so the needsReview send-guard recomputes from
  // server truth — never local-only, or the line would look fixed but still
  // block Send. saveMappings (default true) also remembers it for next time.
  const commitLineCode = useCallback((id: string) => {
    if (!order) return;
    const line = order.lines.find(l => l.id === id);
    const code = lineDraft.trim();
    if (!line || code.length === 0) return;
    setAcceptingLineId(id);
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [{ lineNumber: line.lineNumber, supplierItemCode: code }]);
        await refreshFromServer();
        setLineEditId(null);
        setLineDraft("");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : `Couldn't save that ${labels.counterpartyNoun.toLowerCase()} code. Try again.`, "error");
      } finally {
        setAcceptingLineId(null);
      }
    })();
  }, [order, orderId, lineDraft, refreshFromServer, labels, setFlow]);

  // ── Header inline editing ───────────────────────────────────────────────────
  const startEdit = useCallback((id: string) => {
    // Don't re-open a field whose previous edit is still persisting.
    if (savingHeaderId) return;
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    setFieldValues(prev => ({ ...prev, [id]: prev[id] ?? node.value }));
    setEditingId(id);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [nodes, savingHeaderId]);

  const changeValue = useCallback((id: string, val: string) => {
    setFieldValues(prev => ({ ...prev, [id]: val }));
  }, []);

  // Header fields that map to a backend resolve correction. Each maps the node id
  // to the resolve payload key and the order's current persisted value (for change
  // detection). poNumber + supplierName are display-only on the backend
  // (supplierName does NOT change routing/SupplierId).
  const headerFieldMap: Record<string, { key: "orderDate" | "buyerName" | "currency" | "poNumber" | "supplierName"; current: string }> = useMemo(() => ({
    date:     { key: "orderDate",    current: order?.orderDate ?? "" },
    buyer:    { key: "buyerName",    current: order?.buyerName ?? "" },
    currency: { key: "currency",     current: order?.currency ?? "" },
    po:       { key: "poNumber",     current: order?.poNumber ?? "" },
    supplier: { key: "supplierName", current: order?.supplierName ?? "" },
  }), [order]);

  const commitEdit = useCallback((id: string) => {
    setEditingId(null);

    const header = headerFieldMap[id];
    if (!header || !order) return;
    if (savingHeaderId === id) return;       // a save for this field is already in flight

    const raw = fieldValues[id];
    if (raw === undefined) return;           // never edited
    const next = raw.trim();
    if (next === "" || next === header.current) return; // blank or unchanged → no-op

    // Persist the single edited header field via the resolve endpoint (empty
    // line resolutions — the backend treats absent line work + present header
    // field as a header-only correction). Refetch on success so the persisted
    // value renders from server truth.
    setSavingHeaderId(id);
    setFlow("Saving change…", "info");
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [], { [header.key]: next });
        await refreshFromServer();
        // Drop the local override so the refetched server value is the source of
        // truth (avoids a stale fieldValues entry masking the persisted value).
        setFieldValues(prev => { const n = { ...prev }; delete n[id]; return n; });
        setFlow("Change saved.", "success");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't save that change. Try again.", "error");
      } finally {
        setSavingHeaderId(null);
      }
    })();
  }, [headerFieldMap, order, fieldValues, orderId, refreshFromServer, setFlow, savingHeaderId]);

  // Tab-chain: Enter/Tab commits; Tab additionally advances to the next editable field.
  const handleEditKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commitEdit(id);
      // Tab to next editable field
      if (e.key === "Tab") {
        const editables = nodes.filter(n => n.editable);
        const idx = editables.findIndex(n => n.id === id);
        const next = editables[idx + 1];
        if (next) setTimeout(() => startEdit(next.id), 0);
      }
    }
    if (e.key === "Escape") {
      setEditingId(null);
      // Restore original value
      const node = nodes.find(n => n.id === id);
      if (node) setFieldValues(prev => ({ ...prev, [id]: node.value }));
    }
  }, [commitEdit, startEdit, nodes]);

  const inputRefCallback = useCallback((el: HTMLInputElement | null, id: string) => {
    inputRefs.current[id] = el;
  }, []);

  return {
    // line resolution
    acceptSuggestion,
    bulkAcceptSuggestions,
    bulkAccepting,
    confirmFlaggedLine,
    acceptingLineId,
    // manual code entry
    lineEditId,
    lineDraft,
    setLineDraft,
    startLineEdit,
    cancelLineEdit,
    commitLineCode,
    // header editing
    fieldValues,
    editingId,
    savingHeaderId,
    startEdit,
    changeValue,
    commitEdit,
    handleEditKeyDown,
    inputRefCallback,
    // revalidation driver
    commitVersion,
  };
}

export type ResolveActionsApi = ReturnType<typeof useResolveActions>;
