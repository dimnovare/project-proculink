import { zipSync } from "fflate";
import { ApiHttpError } from "@/lib/api/core";
import { fetchDocumentSource, sendDocument } from "@/lib/api/documents";
import { refusalToken } from "@/lib/documentRefusals";
import { saveBlob } from "@/lib/saveBlob";

export type Each<T extends { id: string; fileName: string }, R> = {
  /** In the order asked. */
  done: { item: T; value: R }[];
  /** An answer about that one document; the run went on. */
  refused: { item: T; error: unknown }[];
  /** An answer about the workspace or the connection; nothing more was asked. `left` counts the refused item and every one after it. */
  stopped?: { error: unknown; left: number };
};

/** Not about one document: paused processing, a plan, limit, sign-in or rate refusal, a server error, or no answer at all. */
export function aboutWorkspace(error: unknown): boolean {
  if (refusalToken(error) === "processing_paused") return true;
  if (!(error instanceof ApiHttpError)) return true;
  return [401, 402, 403, 429].includes(error.status) || error.status >= 500;
}

/** One request per item, one after another. Never throws. `onDone` runs as each item succeeds. */
export async function eachDocument<T extends { id: string; fileName: string }, R>(
  items: readonly T[], run: (item: NoInfer<T>) => Promise<R>, onDone?: (item: NoInfer<T>) => void,
): Promise<Each<T, R>> {
  const out: Each<T, R> = { done: [], refused: [] };
  for (const [i, item] of items.entries()) {
    try {
      out.done.push({ item, value: await run(item) });
      onDone?.(item);
    } catch (error) {
      if (aboutWorkspace(error)) return { ...out, stopped: { error, left: items.length - i } };
      out.refused.push({ item, error });
    }
  }
  return out;
}

/** Sends one document. */
export const sendOne = (d: { id: string }) => sendDocument(d.id);

/** The server answered 204: storage could not read this original. Worded by `documentRefusalMessage` (`missing_original`). */
export class MissingOriginal extends ApiHttpError {
  constructor() {
    super("missing_original", 204, { error: "missing_original" });
  }
}

/** Fetches one original; a 204 throws MissingOriginal. */
export async function fetchOriginal(d: { id: string; fileName: string }): Promise<{ name: string; blob: Blob }> {
  const blob = await fetchDocumentSource(d.id);
  if (!blob) throw new MissingOriginal();
  return { name: d.fileName, blob };
}

const MAX_NAME = 180;
/**
 * A file name someone else chose (an upload, an email attachment), made safe to save or put in a zip:
 * the base name only, no control or Windows-forbidden characters, no leading dots, never a device name.
 * A zip entry like "../../x" would otherwise write outside the folder it is extracted into.
 */
export function safeFileName(name: string): string {
  let s = name.normalize("NFC").split(/[/\\]/).filter(Boolean).pop() ?? "";
  // Control and Windows-forbidden characters, bidi controls (an "invoice<RLO>fdp.exe" spoof) and look-alike slashes.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f:<>"|?*\u200e\u200f\u202a-\u202e\u2066-\u2069\uff0f\uff3c\u2215\u2044]/g, "").replace(/^[.\s/\\]+/, "");
  if (s.length > MAX_NAME) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 16 ? s.slice(dot) : "";
    s = s.slice(0, MAX_NAME - ext.length) + ext;
  }
  s = s.replace(/[.\s]+$/, ""); // after the cut, so a cut name cannot end in a dot or a space again
  if (!s) return "document";
  return /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])\s*(\.|$)/i.test(s) ? `_${s}` : s;
}

/** "invoice.pdf" taken: "invoice (2).pdf", then "invoice (3).pdf". */
function unique(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let out = name;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${stem} (${n})${ext}`;
  taken.add(out.toLowerCase());
  return out;
}

/** Saves one file under its name, or several in documents.zip with unique names. */
export async function saveOriginals(files: readonly { name: string; blob: Blob }[]): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) return saveBlob(files[0].blob, safeFileName(files[0].name));
  const taken = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[unique(safeFileName(f.name), taken)] = new Uint8Array(await f.blob.arrayBuffer());
  saveBlob(new Blob([zipSync(entries)], { type: "application/zip" }), "documents.zip");
}
