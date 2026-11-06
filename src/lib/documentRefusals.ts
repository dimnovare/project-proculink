import { ApiHttpError } from "@/lib/api/core";
import { errorField } from "@/lib/api/refusal";
import { LIMIT_CODES } from "@/lib/limitRefusal";

const GENERIC = "Something went wrong. Try again.";

export const COPY: Record<string, string> = {
  document_engine_not_enabled: "Flows aren't switched on for this workspace yet.",
  unsupported_format: "This file type can't be read. Use PDF, CSV or Excel (.xlsx).",
  file_too_large: "This file is too large.",
  unreadable_file: "This file couldn't be opened. It may be password-protected or damaged.",
  fields_unconfirmed: "Confirm this flow's fields first.",
  no_outputs: "Add an output to this flow before sending.",
  not_ready: "This document can't be sent right now. Reload to see its latest state.",
  document_sent: "This document was already sent, so its values can't change.",
  not_editable: "This document can't be edited in its current state.",
  processing_paused: "Processing is paused on this workspace.",
  destination_in_use: "An output still sends here. Change that output first.",
  unsupported_destination: "That kind of destination isn't available.",
  requires_org_admin: "Only a workspace admin can change destinations.",
  document_not_found: "This document or flow no longer exists.",
  flow_not_found: "This document or flow no longer exists.",
  not_retryable: "This document can't be read again.",
  invalid_name: "Use a name of 120 characters or fewer.",
  pilot_expired: "Your trial has ended, so new documents aren't being accepted.",
  order_limit_reached: "You've reached your plan's document limit for this month.",
  scanned_not_supported: "This looks like a scanned document, which can't be read yet.",
};

/** Reasons a read can never succeed on a retry (`ReadDocumentJob`). */
const PERMANENT_READ_FAILURES = new Set(["unreadable_file", "scanned_not_supported"]);
export const canRetryRead = (reason: string | null) => !PERMANENT_READ_FAILURES.has(reason ?? "");
export const readFailureMessage = (reason: string | null) =>
  (reason && Object.hasOwn(COPY, reason) && COPY[reason]) || "We couldn't read this document.";

const body = (error: unknown) => (error instanceof ApiHttpError ? error.body : null);
const field = (error: unknown, key: string): string | null => {
  const v = (body(error) as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** The server's machine token (`error`), or null when this isn't an API refusal. */
export const refusalToken = (error: unknown): string | null => errorField(body(error));

export function documentRefusalMessage(error: unknown): string {
  const token = refusalToken(error);
  const detail = field(error, "detail");
  if (token === "output_invalid") {
    const output = field(error, "output");
    return `The output${output ? ` "${output}"` : ""} couldn't be made${detail ? `: ${detail}` : "."}`;
  }
  if (token === "invalid_destination" || token === "invalid_fields") return detail ?? GENERIC;
  if (token && LIMIT_CODES.has(token))
    return token === "pilot_expired" ? COPY.pilot_expired : COPY.order_limit_reached;
  if (error instanceof ApiHttpError && error.status === 413 && !token) return COPY.file_too_large;
  return (token && Object.hasOwn(COPY, token) && COPY[token]) || GENERIC;
}
