import Link from "next/link";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import type { DocumentPage, DocumentRow } from "@/lib/api/documents";
import { documentsAddress } from "@/lib/documentTabs";
import { DATE_LOCALE } from "@/lib/format-date";
import { relativeTime } from "@/lib/relativeTime";
import { serverReasonOrNull } from "@/lib/serverText";

/** Where a person goes to fix a stopped delivery. The flow's outputs, until Settings › Destinations exists (14.7). */
export const destinationFixHref = (row: Pick<DocumentRow, "flowId">) => `/flows/${row.flowId}?tab=outputs`;

/** "on 2 Nov, 09:12" in the viewer's zone. `formatDateTime` adds the year, so not reused. */
const stoppedOn =(iso: string) =>
  `on ${new Date(iso).toLocaleString(DATE_LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;

/** One alert for every document whose sending stopped. Nothing when there are none or the answer is not in. */
export function StoppedAlert({ page }: { page: DocumentPage | undefined }) {
  if (!page || page.totalCount === 0) return null;
  const { items: rows, totalCount: n } = page;
  const one = n === 1;
  const first = rows[0]?.stop;
  // Named only when every stopped document was read and all stopped at the same, still-named destination.
  const named = rows.length === n && !!first?.destinationId
    && rows.every((r) => r.stop?.destinationId === first.destinationId && !!r.stop.destination);
  let detail: React.ReactNode;
  let link: React.ReactNode;
  if (named) {
    const at = rows[0].failedAt;
    const when = relativeTime(at);
    const error = serverReasonOrNull(first.error);
    detail = (
      <>
        {`Sending to ${first.destination} stopped`}
        {/* The alert is live: the eye gets "12m ago", a screen reader a moment that does not change, so it is not re-announced. */}
        {at && when && <> <span aria-hidden="true">{when}</span><span className="sr-only">{stoppedOn(at)}</span></>}
        {error ? `: ${/[.!?]$/.test(error) ? error : `${error}.`}` : "."}
        {one
          ? " The document is safe. Fix the destination, then send it again."
          : " The documents are safe. Fix the destination, then send them again."}
      </>
    );
    link = <Link href={destinationFixHref(rows[0])} className="font-semibold underline">Fix the destination</Link>;
  } else {
    detail = one
      ? "The document is safe. Open it to see what happened, then send it again."
      : "The documents are safe. Open them to see what happened, then send them again.";
    link = <Link href={documentsAddress("failed")} className="font-semibold underline">Show what couldn&apos;t be sent</Link>;
  }
  return (
    <StatusNotice tone="error" action={link}>
      <strong>{one ? "1 document couldn't be sent." : `${n} documents couldn't be sent.`}</strong> {detail}
    </StatusNotice>
  );
}
