/** Mirrors `ProcuLink.Core/Documents/DocumentStatus.cs` (pinned by backendMirror.test.ts). */
import type { OrderStage } from "@/components/bridge/StatusJourney";

export interface DocumentStatusRow {
  label: string;
  tone: "working" | "warning" | "error" | "success";
  stage: OrderStage;
  needsYou: boolean;
  /** Mirrors `DocumentStatus.IsEditable` before the duplicate-file rule. */
  editable: boolean;
}

const ROWS = {
  received: { label: "Received", tone: "working", stage: 0, needsYou: false, editable: false },
  reading: { label: "Reading", tone: "working", stage: 1, needsYou: false, editable: false },
  read_failed: { label: "Not read", tone: "error", stage: { failed: 1 }, needsYou: true, editable: false },
  needs_review: { label: "Needs review", tone: "warning", stage: 2, needsYou: true, editable: true },
  ready: { label: "Ready to send", tone: "warning", stage: 3, needsYou: true, editable: true },
  sending: { label: "Sending", tone: "working", stage: 4, needsYou: false, editable: false },
  sent: { label: "Sent", tone: "success", stage: 5, needsYou: false, editable: false },
  send_failed: { label: "Couldn't send", tone: "error", stage: { failed: 4 }, needsYou: true, editable: true },
} satisfies Record<string, DocumentStatusRow>;
export const DOCUMENT_STATUSES: Record<string, DocumentStatusRow> = ROWS;

/** Each status by name (`STATUS.sent` is `"sent"`), so code compares against the manifest, not a typed string. */
export const STATUS = Object.fromEntries(Object.keys(ROWS).map((k) => [k, k])) as { readonly [K in keyof typeof ROWS]: K };

/** Checks about the whole document; each fails at most once. Every other failed check is about a value.
 *  Mirrors `ProcuLink.Core/Documents/DocumentChecks.cs` (pinned by backendMirror.test.ts). */
export const WHOLE_DOCUMENT_CHECKS = ["fields_unconfirmed", "duplicate", "text_truncated", "new_sender"] as const;

/** A reason's own label, by `status/reason`: how the inbox sorted a document. Every other fact stays the status's. */
export const REASON_LABELS: Record<string, string> = {
  "needs_review/new_kind": "First of its kind",
  "needs_review/choose_flow": "Where should it go?",
  "needs_review/check_sort": "Check where we put it",
  "sent/downloaded": "Downloaded",
};

/** An unknown status is surfaced as needing attention, never shown as sent. An unknown reason keeps the status's label. */
export function documentStatus(status: string, statusReason?: string | null): DocumentStatusRow {
  const row: DocumentStatusRow = Object.hasOwn(DOCUMENT_STATUSES, status)
    ? DOCUMENT_STATUSES[status]
    : { label: status, tone: "warning", stage: 0, needsYou: true, editable: false };
  if (statusReason === "duplicate_file") return { ...row, editable: false };
  const key = `${status}/${statusReason}`;
  return Object.hasOwn(REASON_LABELS, key) ? { ...row, label: REASON_LABELS[key] } : row;
}
