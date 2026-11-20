"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";
import { inboxQuery } from "@/hooks/useDocumentEngine";
import { ApiHttpError } from "@/lib/api/core";
import { deleteDocument, downloadDeliveryFile, retryDocumentRead, sendDocument, type DocumentFile } from "@/lib/api/documents";
import { canRetryRead, documentRefusalMessage } from "@/lib/documentRefusals";
import { dayAt, flowWords, madeLine } from "@/lib/flowWords";
import { saveBlob } from "@/lib/saveBlob";
import type { ListedDocument } from "./DocumentList";
import { BULK_SEND_KEY } from "./SelectionBar";

const href = (d: Pick<ListedDocument, "flowId" | "id">) => `/flows/${d.flowId}/documents/${d.id}`;

/** Send a ready document from a list row. A second press while it is out does nothing (the button is busy);
 *  on success onSent runs, then every documents list and the document's own queries refresh (the button stays busy until they have). */
export function useRowSend(id: string, onSent: () => void): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    // Keyed by document, so the selection bar leaves out a row whose own send is still out.
    mutationKey: ["document-send", id],
    mutationFn: () => sendDocument(id),
    onSuccess: () => {
      onSent();
      return Promise.all([["documents"], ["document", id], ["deliveries", id], ["document-history", id]].map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

/** Not while it is being read or sent: the server would answer document_busy. Never a reason to show Remove (the server's canRemove is). */
export const removable = (status: string): boolean => !["received", "reading", "sending"].includes(status);

/** The confirm before a removal (board Remove), for one document or several. */
export function removalDialog(docs: readonly Pick<ListedDocument, "fileName" | "countsThisMonth">[]) {
  const one = docs.length === 1;
  const counted = docs.filter((d) => d.countsThisMonth).length;
  return {
    title: one ? `Remove ${docs[0].fileName}?` : `Remove ${docs.length} documents?`,
    description: (
      <>
        <span className="block">
          {one ? "The document and the file we made from it are erased for good. This can't be undone."
            : "The documents and the files we made from them are erased for good. This can't be undone."}
        </span>
        {counted > 0 && (
          <span className="mt-2 block">
            {one ? "We already read it, so it still counts as one of this month's documents."
              : `We already read ${counted} of them, so they still count as this month's documents.`}
          </span>
        )}
      </>
    ) as ReactNode,
    confirmLabel: "Remove" as const,
    cancelLabel: "Keep it" as const,
    danger: true as const,
  };
}

/** Remove one document after asking. A 404 is done (another list or tab removed it first). */
export function useRemove(onRemoved: (id: string) => void): { ask(d: ListedDocument): Promise<void>; pendingId: string | null; error: unknown } {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const m = useMutation({
    mutationFn: async (d: ListedDocument) => {
      await deleteDocument(d.id).catch((e) => { if (!(e instanceof ApiHttpError && e.status === 404)) throw e; });
      return d.id;
    },
    onSuccess: (id) => {
      onRemoved(id);
      qc.removeQueries({ queryKey: ["document", id] });
      for (const key of ["documents", "flows", "onboarding-status"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
  return {
    ask: async (d) => {
      if (!(await confirm(removalDialog([d])))) return;
      await m.mutateAsync(d).catch(() => {});
    },
    pendingId: m.isPending ? m.variables?.id ?? null : null,
    error: m.error,
  };
}

/** A row's second line after what it is: a duplicate says when the earlier copy came, a made file is named. */
export function rowSecondLine(d: ListedDocument, said: string | null): string | null {
  if (d.statusReason === "duplicate_file") return d.duplicateOfAt ? `You added this same file ${dayAt(d.duplicateOfAt)}` : "You added this same file before.";
  const made = madeLine(d.files ?? []);
  // A sender may end in its own full stop ("Example Bank Ltd."): one stop between the two sentences.
  return made ? (said ? `${said.replace(/\.$/, "")}. ${made}` : made) : said;
}

/** A row's next step (spec D2). Buttons sit above the row's link overlay. `phone`: the card is the link, so Review/Open are not drawn. */
export function RowActions({ d, sendable, onSent, onRemoved, phone = false, className = "flex flex-wrap justify-end gap-2" }: {
  d: ListedDocument; sendable: boolean; onSent(): void; onRemoved(id: string): void; phone?: boolean; className?: string;
}) {
  const qc = useQueryClient();
  const send = useRowSend(d.id, onSent);
  // While the selection bar is sending or downloading, a row's own Send waits.
  const bulk = useIsMutating({ mutationKey: BULK_SEND_KEY }) > 0;
  const remove = useRemove(onRemoved);
  const read = useMutation({
    mutationFn: () => retryDocumentRead(d.id),
    onSuccess: () => Promise.all([["documents"], ["document", d.id]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
  const download = useMutation({ mutationFn: async (f: DocumentFile) => saveBlob(await downloadDeliveryFile(d.id, f.deliveryId), f.fileName) });
  // Read from what the screen already asked, never asked for here.
  const scansOn = useQuery({ ...inboxQuery, enabled: false }).data?.scansOn;

  const z = "relative z-[1]";
  const button = (label: string, onClick: () => void, loading = false, extra = "") => (
    <Button key={label} variant="secondary" size="sm" aria-label={`${label} ${d.fileName}`} loading={loading} onClick={onClick} className={`${z} ${extra}`}>{label}</Button>
  );
  const drawn = (label: string) => !phone && <span key={label} aria-hidden className={buttonClass("secondary", "sm")}>{label}</span>;
  const removeButton = d.canRemove === true && removable(d.status) && button("Remove", () => void remove.ask(d), remove.pendingId === d.id);
  const files = d.status === "sent" && d.statusReason !== "downloaded" ? d.files ?? [] : [];
  const copy = files.some((f) => f.delivered) ? "Download a copy" : "Download";

  let items: ReactNode[] = [];
  if (files.length === 1) items = [button(copy, () => download.mutate(files[0]), download.isPending)];
  else if (files.length > 1) items = [<Link key="open" href={href(d)} aria-label={`${copy} ${d.fileName}`} className={`${buttonClass("secondary", "sm")} ${z}`}>{copy}</Link>];
  else if (d.statusReason === "duplicate_file") items = [removeButton, button("Read it anyway", () => read.mutate(), read.isPending)];
  else if (d.status === "read_failed") items = [canRetryRead(d.statusReason, { scansOn }) && button("Try again", () => read.mutate(), read.isPending), removeButton];
  else if (d.status === "ready" && sendable && d.inInbox === false && d.statusReason !== "check_sort")
    items = [button(flowWords(d.downloadOnly).action, () => send.mutate(), send.isPending || bulk, "!border-brand-green-deep !text-brand-green-deep")];
  // An inbox document is answered on its own screen, never sent from a row; one not known to be sorted is not sent either.
  else if (d.inInbox !== false && (d.status === "ready" || (d.inInbox && d.status === "needs_review"))) items = [drawn("Open")];
  // A sort we were not sure of is reviewed, never sent from a row: its notice is on the review screen.
  else if (d.status === "needs_review" || d.statusReason === "check_sort") items = [drawn("Review")];

  const failed = send.isError && d.status === "ready" ? send.error : read.error ?? download.error ?? remove.error;
  items = items.filter(Boolean);
  if (!items.length && !failed) return null;
  return (
    <div className={className}>
      {items}
      {!!failed && <p role="alert" className="m-0 basis-full text-left text-[12.5px] text-danger-text">{documentRefusalMessage(failed)}</p>}
    </div>
  );
}
