import type { DocumentPage, DocumentRow } from "@/lib/api/documents";
import { pageTotal } from "@/lib/pageTotal";

/** Where this document sits in the queue, or null when it is not in it or the queue is unknown. */
export function queuePosition(queue: DocumentPage | undefined, id: string): { n: number; of: number } | null {
  const i = queue?.items.findIndex((d) => d.id === id) ?? -1;
  const of = pageTotal(queue);
  return i < 0 || of === undefined ? null : { n: i + 1, of };
}

/** "Document {n} of {m}" | "The only one waiting" | null */
export function positionText(p: { n: number; of: number } | null): string | null {
  if (!p) return null;
  return p.of === 1 ? "The only one waiting" : `Document ${p.n} of ${p.of}`;
}

/** R2. `before`: the queue when the person pressed; `after`: the queue now (undefined when unknown). */
export function pickNext(before: readonly DocumentRow[] | undefined, after: readonly DocumentRow[] | undefined, id: string): DocumentRow | null {
  const listed = after ?? before;
  if (!listed) return null;
  // The queue as the person saw it, starting after this document, so the order stays theirs.
  const seen = before ?? [];
  const at = seen.findIndex((d) => d.id === id);
  const turn = [...seen.slice(at + 1), ...seen.slice(0, at + 1)];
  for (const d of turn) {
    const still = d.id !== id && listed.find((x) => x.id === d.id);
    if (still) return still;
  }
  return listed.find((d) => d.id !== id) ?? null;
}

export const documentHref = (d: Pick<DocumentRow, "flowId" | "id">) => `/flows/${d.flowId}/documents/${d.id}`;
