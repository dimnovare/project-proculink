import type { DocumentRow, Inbox } from "@/lib/api/documents";

/** The kind as the machine read it ("Invoice"), or null when it read none or read no letter or digit. A kind is never guessed. */
const read = (kind: string | null | undefined) => {
  const k = kind?.trim();
  return k && /[\p{L}\p{N}]/u.test(k) ? k : null;
};
/** An acronym: 1 to 4 capital letters, alone or before a hyphen, maybe with a plural s ("CMR", "X-ray", "ASNs"). */
const capitals = (word: string) => /^[A-Z]{1,4}s?(?=-|$)/.test(word);

/** The kind inside a sentence: words lowercased unless they start with an acronym ("CMR note", "X-ray report"). */
export const kindWords = (kind: string) =>
  kind.trim().split(/\s+/).map((w) => (capitals(w) ? w : w.toLowerCase())).join(" ");

const article = (words: string) => {
  const first = words.split(" ")[0];
  if (capitals(first)) return /^[AEFHILMNORSX]/.test(first) ? "An" : "A";
  return /^[aeiou]/i.test(first) || /^(hour|honest|heir|honou?r)/i.test(first) ? "An" : "A";
};

/**
 * "An invoice from Example Supplier Ltd", "An invoice", "From Example Supplier Ltd", or null when neither is known. A kind whose
 * last word before any " of " reads as a plural ("Invoices", "Analysis"; not "Bill of materials", "Bonus") takes no article. The sender is kept as written, so one ending in a full
 * stop ("Example Ltd.") keeps it: a caller that puts its own full stop after the sentence must not double it.
 */
export function kindSentence(kind: string | null | undefined, sender: string | null | undefined): string | null {
  const k = read(kind);
  const from = sender?.trim() || null;
  if (!k) return from && `From ${from}`;
  const words = kindWords(k);
  const tail = from ? ` from ${from}` : "";
  if (/[^su]s$/i.test(words.split(" of ")[0])) return `${words[0].toUpperCase()}${words.slice(1)}${tail}`;
  return `${article(words)} ${words}${tail}`;
}

/** Is this document in the inbox? undefined = not known, which draws neither the inbox answers nor Send. */
export const inInbox = (summary: Pick<DocumentRow, "flowId" | "inInbox">, inbox: Inbox | undefined): boolean | undefined =>
  summary.inInbox ?? (inbox ? summary.flowId === inbox.flowId : undefined);
