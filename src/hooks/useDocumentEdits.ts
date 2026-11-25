"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { editDocumentValues, type EditValuesRequest } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { editKey, type EditTarget } from "@/lib/reviewMarks";
import { useAutosave, type SaveState } from "./useAutosave";

export interface DocumentEdits {
  /** Unsaved values by editKey. An input shows `drafts[key] ?? the server's value`. */
  drafts: Readonly<Record<string, string>>;
  /** A keystroke: saved 1.5 s after typing stops (R7). */
  type(target: EditTarget, value: string): void;
  /** Enter or leaving a box: save now; never throws. */
  commit(): void;
  /** After flush; locks the values while it runs. Resolves false when the rows did not change. */
  rows(req: Pick<EditValuesRequest, "addRowToTables" | "removeRows">): Promise<boolean>;
  state: SaveState;
  /** The connection failure behind "failed". */
  error: unknown;
  /** The server's words when it refused a save. */
  refusal: string | null;
  /** A row change is on its way. */
  busy: boolean;
  /** Resolves when everything typed is saved; rejects when it could not be, or with the server's refusal of it. */
  flush(): Promise<void>;
}

type Draft = { target: EditTarget; value: string };

/** Every unsaved value of one document in one request: the server writes no history row for a value sent again unchanged. */
const requestOf = (drafts: ReadonlyMap<string, Draft>): EditValuesRequest => {
  const fields: NonNullable<EditValuesRequest["fields"]> = [];
  const cells: NonNullable<EditValuesRequest["cells"]> = [];
  for (const { target: t, value } of drafts.values())
    if ("field" in t) fields.push({ key: t.field, value });
    else cells.push({ table: t.table, row: t.row, column: t.column, value });
  return { ...(fields.length && { fields }), ...(cells.length && { cells }) };
};

/** The values a person types on one document: kept as drafts, saved as they type, never lost and never saved twice. */
export function useDocumentEdits(documentId: string): DocumentEdits {
  const qc = useQueryClient();
  const drafts = useRef(new Map<string, Draft>());
  const [shown, setShown] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const refused = useRef<unknown>(null);
  const show = useCallback(() => setShown(Object.fromEntries([...drafts.current].map(([k, d]) => [k, d.value]))), []);

  /** Sends one request. A refusal resolves (the values can no longer change); any other failure rejects. */
  const apply = useCallback(async (req: EditValuesRequest) => {
    try {
      const answer = await editDocumentValues(documentId, req);
      // A refetch that started before the answer must not write the old value back over it.
      await qc.cancelQueries({ queryKey: ["document", documentId] });
      qc.setQueryData(["document", documentId], answer);
      qc.invalidateQueries({ queryKey: ["document-history", documentId] });
      qc.invalidateQueries({ queryKey: ["output-preview", documentId] });
      // A typed Receiver Peppol ID or VAT number changes who the Peppol line looks up.
      qc.invalidateQueries({ queryKey: ["peppol-receiver", documentId] });
      // A saved value can change a list row: its number, sender, checks or status.
      qc.invalidateQueries({ queryKey: ["documents"] });
      const sent = new Map<string, string | null>([
        ...(req.fields ?? []).map((f) => [editKey({ field: f.key }), f.value] as const),
        ...(req.cells ?? []).map((c) => [editKey(c), c.value] as const),
      ]);
      // A newer keystroke stays.
      for (const [k, v] of sent) if (drafts.current.get(k)?.value === v) drafts.current.delete(k);
      show();
      setRefusal(null);
    } catch (e) {
      // A 429 (rate limit or quota) is about the moment, not the value: it fails, and what was typed stays.
      if (refusalToken(e) === null || (e instanceof ApiHttpError && e.status === 429)) throw e;
      refused.current = e;
      drafts.current.clear();
      show();
      setRefusal(documentRefusalMessage(e));
      qc.invalidateQueries({ queryKey: ["document", documentId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    }
  }, [documentId, qc, show]);

  const { state, error, change, flush } = useAutosave(apply, 1500);
  const rowChange = useMutation({ mutationKey: ["edit-values", documentId], mutationFn: apply });

  const type = useCallback((target: EditTarget, value: string) => {
    drafts.current.set(editKey(target), { target, value });
    show();
    change(requestOf(drafts.current));
  }, [change, show]);

  const commit = useCallback(() => { flush().catch(() => {}); }, [flush]);

  const rows = useCallback(async (req: Pick<EditValuesRequest, "addRowToTables" | "removeRows">) => {
    try { await flush(); } catch { return false; }   // the unsaved values say so with their own Try again
    refused.current = null;
    // A coded refusal resolves inside apply (the values can no longer change): it is still "the rows did not change".
    try { await rowChange.mutateAsync(req); return refused.current === null; } catch (e) { setRefusal(documentRefusalMessage(e)); return false; }
  }, [flush, rowChange]);

  /** A refused save resolves inside the hook (the values can no longer change), but a caller waiting to send must not go on. */
  const flushed = useCallback(async () => {
    refused.current = null;
    await flush();
    if (refused.current !== null) throw refused.current;
  }, [flush]);

  return { drafts: shown, type, commit, rows, state, error, refusal, busy: rowChange.isPending, flush: flushed };
}
