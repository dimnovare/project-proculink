"use client";

import Link from "next/link";
import { Card } from "@/components/bridge/layout/Card";
import { Pill } from "@/components/bridge/DSPrimitives";
import type { DocumentPage } from "@/lib/api/documents";
import { pageTotal } from "@/lib/pageTotal";
import { relativeTime } from "@/lib/relativeTime";
import { documentHref } from "@/lib/reviewQueue";
import { rowNeed } from "./DocumentList";

/**
 * The documents that need a person, beside the one being reviewed, so the queue and the work are on one screen.
 * Drawn on wide screens only (the caller hides it below 1700px): there it costs the document and its values nothing.
 */
export function WaitingList({ queue, currentId }: { queue: DocumentPage; currentId: string }) {
  const total = pageTotal(queue);
  return (
    <Card flush as="aside" aria-label="Documents that need you" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="m-0 text-[13px] font-semibold text-ink">Needs you</h2>
        {total !== undefined && <span className="text-[12.5px] text-ink-muted">{total}</span>}
      </div>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-1.5">
        {queue.items.map((d) => {
          const need = rowNeed(d);
          const here = d.id === currentId;
          const when = relativeTime(d.createdAt);
          return (
            <li key={d.id}>
              <Link
                replace href={documentHref(d)} aria-current={here ? "page" : undefined}
                className={`grid gap-0.5 rounded-md px-2.5 py-2 no-underline ${here ? "bg-brand-blue-soft" : "hover:bg-surface-2"}`}
              >
                <span className="truncate text-[13px] font-semibold text-ink">{d.fileName}</span>
                <span className="truncate text-[12.5px] text-ink-muted">{d.flowName}{when && `, ${when}`}</span>
                <span className="min-w-0 [&>*]:max-w-full [&>*]:truncate"><Pill tone={need.tone}>{need.text}</Pill></span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-1 border-t border-border px-4 py-2.5">
        {total !== undefined && total > queue.items.length && <p className="m-0 text-[12.5px] text-ink-muted">The newest {queue.items.length} are listed.</p>}
        <Link href="/documents" className="inline-flex min-h-[32px] items-center text-[13px] font-semibold text-brand-blue">All documents</Link>
      </div>
    </Card>
  );
}
