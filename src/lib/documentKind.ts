import type { DocumentRow, Inbox } from "@/lib/api/documents";

/** The kind as the machine read it ("Invoice"), or null when it read none. A kind is never guessed. */
const read = (kind: string | null | undefined) => kind?.trim() || null;
const capitals = (word: string) => /^[A-Z]{1,4}$/.test(word);

/** The kind inside a sentence: words lowercased unless written in capitals of up to 4 letters ("CMR note"). */
export const kindWords = (kind: string) =>
  kind.trim().split(/\s+/).map((w) => (capitals(w) ? w : w.toLowerCase())).join(" ");

/** "An invoice from Example Supplier Ltd", "An invoice", "From Example Supplier Ltd", or null when neither is known. */
export function kindSentence(kind: string | null | undefined, sender: string | null | undefined): string | null {
  const k = read(kind);
  const from = sender?.trim() || null;
  if (!k) return from && `From ${from}`;
  const words = kindWords(k);
  const article = /^[aeiou]/i.test(words) && !capitals(words.split(" ")[0]) ? "An" : "A";
  return `${article} ${words}${from ? ` from ${from}` : ""}`;
}

/** "invoices", "delivery notes", "CMR notes"; "documents like this" with no kind. Same rule as the backend's `DocumentKind.FlowNameFor`. */
export function kindPlural(kind: string | null | undefined): string {
  const k = read(kind);
  if (!k) return "documents like this";
  const words = kindWords(k);
  const lower = words.toLowerCase();
  if (lower.endsWith("s")) return words;
  if (/[^aeiou]y$/.test(lower)) return `${words.slice(0, -1)}ies`;
  return /(x|ch|sh)$/.test(lower) ? `${words}es` : `${words}s`;
}

/** Is this document in the inbox? undefined = not known, which draws neither the inbox answers nor Send. */
export const inInbox = (summary: Pick<DocumentRow, "flowId" | "inInbox">, inbox: Inbox | undefined): boolean | undefined =>
  summary.inInbox ?? (inbox ? summary.flowId === inbox.flowId : undefined);
