import type { Flow, FlowSummaryOutput } from "@/lib/api/documents";

/** How a flow row names each intake kind. Keys mirror `IntakeKind.cs` (pinned by backendMirror.test.ts); order is the sentence's. */
export const WAY_IN_WORDS: Record<string, string> = {
  email: "email", imap: "a mailbox", outlook: "a mailbox", sftp: "a server", ftp: "a server", ftps: "a server", s3: "an S3 bucket", api: "the API",
};

/** "a, b and c". */
export const and = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/** Each way once, in WAY_IN_WORDS order, upload always last. An unknown kind is skipped. */
export function waysInWords(kinds: readonly string[]): string {
  const words = Object.keys(WAY_IN_WORDS).filter((k) => kinds.includes(k)).map((k) => WAY_IN_WORDS[k]);
  return and([...new Set(words), "upload"]);
}

/** A file's name is whatever the person typed ("CSV file", "ZUGFeRD"), so it is quoted: the sentence reads for any name. */
export function sendsWords(outputs: readonly FlowSummaryOutput[]): string {
  if (!outputs.length) return "Nothing is sent yet.";
  const q = (o: FlowSummaryOutput) => `“${o.name}”`;
  const sent = outputs.filter((o) => o.destination !== null).map((o) => `${q(o)} to ${o.destination}`);
  const kept = outputs.filter((o) => o.destination === null).map(q);
  return [sent.length ? `Sends ${and(sent)}.` : "", kept.length ? `You download ${and(kept)}.` : ""].filter(Boolean).join(" ");
}

/** The row's sentence, or null when the server sent no summary (an older backend, or a single-flow response). */
export function doesLine(flow: Pick<Flow, "summary">): string | null {
  const s = flow.summary;
  return s ? `Reads documents from ${waysInWords(s.waysIn)}. ${sendsWords(s.outputs)}` : null;
}
