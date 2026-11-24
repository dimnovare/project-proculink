/**
 * flowWords.ts — the one place for the words that change when a flow only makes files to download.
 *
 * The server answers one flag, `downloadOnly` (FlowSummaries.DownloadOnly): no output in use has a
 * live destination. Action words follow the flow's current flag; a finished status follows the
 * document's own files, so a file delivered to a destination since deleted still says "Sent".
 * An unknown flag (an older backend) gets the destination words, today's words.
 */
import { activityTime } from "./activityRows";
import { and } from "./flowSentences";
import type { DocumentDelivery, DocumentFile } from "./api/documents";

export function flowWords(downloadOnly: boolean | undefined): { action: string; primary: string; pane: string; ready: string } {
  return downloadOnly === true
    ? { action: "Make the file", primary: "Make the file", pane: "The file we make", ready: "Nothing to check" }
    : { action: "Send", primary: "Send and open next", pane: "What we'll send", ready: "Ready to send" };
}

/** A document's made files: its delivered or stored deliveries that carry a file name. */
export function filesOf(deliveries: readonly DocumentDelivery[] | undefined): DocumentFile[] {
  return (deliveries ?? []).filter((d) => d.fileName && (d.status === "delivered" || d.status === "stored")).map((d) => {
    const delivered = d.status === "delivered";
    return { deliveryId: d.id, fileName: d.fileName!, delivered, destination: delivered ? d.destination ?? null : null };
  });
}

export function finishedLabel(files: readonly DocumentFile[]): string {
  const sent = files.filter((f) => f.delivered);
  if (!sent.length) return "File ready";
  const names = [...new Set(sent.flatMap((f) => (f.destination ? [f.destination] : [])))];
  return names.length ? `Sent to ${and(names)}` : "Sent";
}

/** "Made into …" for a document whose files wait to be downloaded; null once any went somewhere, or when none exist. */
export function madeLine(files: readonly DocumentFile[]): string | null {
  if (!files.length || files.some((f) => f.delivered)) return null;
  return files.length === 1 ? `Made into ${files[0].fileName}` : `Made into ${files.length} files`;
}

/** "today at 14:02", "yesterday at 09:30", "on 18 November at 14:02" (en-GB, 24 h, local time). */
export function dayAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "yesterday"
    : `on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })}`;
  return `${day} at ${activityTime(iso)}`;
}

/** A repeated number in words: "INV-1001 was already received on 22 May at 09:00." */
export const duplicateLine = (d: { number: string | null; receivedAt: string }) =>
  `${d.number ?? "A document with this number"} was already received ${dayAt(d.receivedAt)}.`;
