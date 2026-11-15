import { ApiHttpError } from "@/lib/api/core";

/** The file kinds a flow reads, by switch. Mirrors ProcuLink.Core/Documents/DocumentFormats.cs Base / Images / More (pinned by backendMirror.test.ts). */
export const FILE_KINDS = {
  base: ["pdf", "csv", "xlsx"],
  photos: ["png", "jpg", "jpeg"],
  more: ["docx", "txt", "xml", "cxml", "json", "edi", "x12"],
} as const;

/** The photo pickers' accept list: the types of FILE_KINDS.photos, so a phone converts its own format to JPEG (R12). */
export const PHOTO_ACCEPT = "image/jpeg,image/png";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // IngressLimits.MaxFileBytes (pinned by backendMirror.test.ts)

const dotted = (kinds: readonly string[]) => kinds.map((k) => `.${k}`);

type FileKind = (typeof FILE_KINDS)[keyof typeof FILE_KINDS][number];
/** How a person names each kind, in the order the sentence lists them. Every kind has a word (checked by the type). */
const KIND_WORDS = {
  pdf: "PDF", docx: "Word", xlsx: "Excel", csv: "CSV", txt: "text", xml: "XML", cxml: "XML", json: "JSON", edi: "EDI", x12: "EDI",
  png: "a photo", jpg: "a photo", jpeg: "a photo",
} as const satisfies Record<FileKind, string>;

/** "PDF, Excel or CSV, up to 10 MB.": the kinds this flow reads, by the same switches as `acceptFor`. */
export function kindsLine(flow: { scansOn?: boolean; formatsOn?: boolean }): string {
  const read = new Set<string>([...FILE_KINDS.base, ...(flow.scansOn ? FILE_KINDS.photos : []), ...(flow.formatsOn ? FILE_KINDS.more : [])]);
  const words = [...new Set(Object.entries(KIND_WORDS).filter(([k]) => read.has(k)).map(([, w]) => w))];
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
}

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
