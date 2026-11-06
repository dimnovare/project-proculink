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

export const DOCUMENT_STATUSES: Record<string, DocumentStatusRow> = {
  received: { label: "Received", tone: "working", stage: 0, needsYou: false, editable: false },
  reading: { label: "Reading", tone: "working", stage: 1, needsYou: false, editable: false },
  read_failed: { label: "Couldn't read", tone: "error", stage: { failed: 1 }, needsYou: true, editable: false },
  needs_review: { label: "Needs review", tone: "warning", stage: 2, needsYou: true, editable: true },
  ready: { label: "Ready to send", tone: "warning", stage: 3, needsYou: true, editable: true },
  sending: { label: "Sending", tone: "working", stage: 4, needsYou: false, editable: false },
  sent: { label: "Sent", tone: "success", stage: 4, needsYou: false, editable: false },
  send_failed: { label: "Couldn't send", tone: "error", stage: { failed: 4 }, needsYou: true, editable: true },
};

/** An unknown status is surfaced as needing attention, never shown as sent. */
export function documentStatus(status: string, statusReason?: string | null): DocumentStatusRow {
  const row: DocumentStatusRow = Object.hasOwn(DOCUMENT_STATUSES, status)
    ? DOCUMENT_STATUSES[status]
    : { label: status, tone: "warning", stage: 0, needsYou: true, editable: false };
  return statusReason === "duplicate_file" ? { ...row, editable: false } : row;
}
