import { ApiHttpError } from "@/lib/api/core";

/** The file kinds a flow reads, by switch. Mirrors ProcuLink.Core/Documents/DocumentFormats.cs Base / Images / More (pinned by backendMirror.test.ts). */
export const FILE_KINDS = {
  base: ["pdf", "csv", "xlsx"],
  photos: ["png", "jpg", "jpeg"],
  more: ["docx", "txt", "xml", "cxml", "json", "edi", "x12"],
} as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // IngressLimits.MaxFileBytes

const dotted = (kinds: readonly string[]) => kinds.map((k) => `.${k}`);

/** An input's accept list: ".pdf,.csv,.xlsx", plus photos when scans are on and the more-formats set when formats are on. */
export function acceptFor(flow: { scansOn?: boolean; formatsOn?: boolean } | undefined): string {
  return [FILE_KINDS.base, flow?.scansOn ? FILE_KINDS.photos : [], flow?.formatsOn ? FILE_KINDS.more : []].flatMap(dotted).join(",");
}

/** The refusal the server would give for this file's kind or size, made here so no request is spent; null when it may go. */
export function fileRefusal(file: File, accept: string, maxBytes = MAX_UPLOAD_BYTES): ApiHttpError | null {
  const name = file.name.toLowerCase();
  if (!accept.split(",").some((ext) => name.endsWith(ext.trim().toLowerCase())))
    return new ApiHttpError("unsupported", 415, { error: "unsupported_format" });
  if (file.size > maxBytes) return new ApiHttpError("too large", 413, { error: "file_too_large" });
  return null;
}
