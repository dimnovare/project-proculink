import Link from "next/link";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import type { DocumentPage } from "@/lib/api/documents";
import { fixDestinationHref } from "@/lib/activityRows";
import { documentsAddress } from "@/lib/documentTabs";
import { pageTotal } from "@/lib/pageTotal";
import { DATE_LOCALE } from "@/lib/format-date";
import { relativeTime } from "@/lib/relativeTime";
import { serverReasonOrNull } from "@/lib/serverText";

/** "on 2 Nov, 09:12" in the viewer's zone. `formatDateTime` adds the year, so not reused. */
const stoppedOn =(iso: string) =>
  `on ${new Date(iso).toLocaleString(DATE_LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;

/** One alert for every document whose sending stopped. Nothing when there are none or the answer is not in. */
export function StoppedAlert({ page }: { page: DocumentPage | undefined }) {
  const n = pageTotal(page);
  if (!page || !n) return null;
  const rows = page.items;
  const one = n === 1;
  const first = rows[0]?.stop;
  // Named only when every stopped document was read and all stopped at the same, still-named destination.
  const named = rows.length === n && !!first?.destinationId
    && rows.every((r) => r.stop?.destinationId === first.destinationId && !!r.stop.destination);
  let detail: React.ReactNode;
  let link: React.ReactNode;
  if (named) {
    // The latest stop across the rows.
    const at = rows.reduce<string | null>((m, r) => (r.failedAt && (!m || Date.parse(r.failedAt) > Date.parse(m)) ? r.failedAt : m), null);
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
    link = <Link href={fixDestinationHref(first.destinationId)} className={buttonClass("secondary", "sm")}>Fix the destination</Link>;
  } else if (one && rows.length === 1 && !first?.destinationId && serverReasonOrNull(first?.error)) {
    // Held where it was sent (a KSeF duplicate): its answer is the whole story; there is no destination to fix.
    detail = serverReasonOrNull(first!.error);
    link = <Link href={documentsAddress("failed")} className="inline-flex items-center font-semibold underline">Show what couldn&apos;t be sent</Link>;
  } else {
    detail = one
      ? "The document is safe. Open it to see what happened, then send it again."
      : "The documents are safe. Open them to see what happened, then send them again.";
    link = <Link href={documentsAddress("failed")} className="inline-flex items-center font-semibold underline">Show what couldn&apos;t be sent</Link>;
  }
  return (
    <StatusNotice tone="error" action={link}>
      <strong>{one ? "1 document couldn't be sent." : `${n} documents couldn't be sent.`}</strong> {detail}
    </StatusNotice>
  );
}
