import { ApiHttpError } from "@/lib/api/core";
import { errorField } from "@/lib/api/refusal";

const GENERIC = "Something went wrong. Try again.";

const COPY: Record<string, string> = {
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
};

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
  return (token && COPY[token]) || GENERIC;
}
