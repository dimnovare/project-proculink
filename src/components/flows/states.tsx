"use client";

import Link from "next/link";
import type { UseMutationResult } from "@tanstack/react-query";
import { Check, TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { EmptyState } from "@/components/bridge/EmptyState";
import { Loading, LogoLoader } from "@/components/bridge/LogoLoader";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import type { DocumentCheck, DocumentSummary } from "@/lib/api/documents";
import { classifyApiFailure } from "@/lib/apiFailure";
import { canRetryRead, COPY, documentRefusalMessage, readFailureMessage, refusalToken } from "@/lib/documentRefusals";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { documentsAddress, type DocumentTab } from "@/lib/documentTabs";
import { firstRunAddress } from "@/lib/firstRun";

/** Reasons the engine parks a document for review on its own, each worded in COPY. */
const AUTOMATIC_HOLDS = new Set(["no_output_matches", "output_invalid"]);

/** Gone: the server's words and the way on: back to the start of a first run, or back to Documents from the review screen. */
export const Gone = ({ text, back = "start" }: { text: string; back?: "start" | "documents" }) => (
  <StatusNotice
    tone="error"
    action={back === "documents"
      ? <Link href="/documents" className={buttonClass("secondary", "sm")}>Back to Documents</Link>
      : <Link href={firstRunAddress({})} className={buttonClass("secondary", "sm")}>Start again</Link>}
  >{text}</StatusNotice>
);

export const Quiet =({ children }: { children: string }) => (
  <p role="status" className="m-0 text-[13px] text-ink-muted">{children}</p>
);

export { Loading };

/** A page on its way: the moving mark, in the space a page's first list takes. `label` is what a screen reader hears. */
export const LoadingPanel = ({ label }: { label: string }) => (
  <div role="status" aria-label={label} className="flex h-[207px] items-center justify-center">
    <span className="sr-only">{label}</span>
    <LogoLoader size={56} />
  </div>
);

const Empty = ({ icon, title, line, action }: { icon?: React.ReactNode; title: string; line: string; action: React.ReactNode }) => (
  <Card>
    <EmptyState compact={false} icon={icon} title={title} sub={line} action={action} />
  </Card>
);

const upload = <Link href="/upload" className={buttonClass("blue", "md")}>Upload a document</Link>;

/** Nothing needs you. */
export const CaughtUp = () => (
  <Empty
    icon={<span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green-soft text-brand-green-deep"><Check size={22} /></span>}
    title="You're all caught up." line="New documents appear here as they arrive." action={upload}
  />
);

const EMPTY: Record<Exclude<DocumentTab, "needs-you">, { title: string; line: string }> = {
  sent: { title: "Nothing has finished yet.", line: "Documents show here once their file is made or sent." },
  failed: { title: "Nothing has failed.", line: "Documents we couldn't read or couldn't send show here." },
  all: { title: "No documents yet.", line: "Upload one, or send one to a flow's email address." },
};

/** A filter with nothing in it; `tab` picks the words. */
export const EmptyFilter = ({ tab }: { tab: Exclude<DocumentTab, "needs-you"> }) => (
  <Empty
    {...EMPTY[tab]}
    action={tab === "all" ? upload : <Link href={documentsAddress("all")} className="inline-flex items-center text-[14px] font-semibold">Show all documents</Link>}
  />
);

/** The board's "couldn't load" panel. `page` makes the heading the page's h1 (error boundaries). */
export function CouldNotLoad({ title, line, retry, page, extra }: {
  title: string; line: string; retry?: () => void; page?: boolean; extra?: React.ReactNode;
}) {
  const Heading = page ? "h1" : "h2";
  return (
    <Card>
      <div role="alert" className="flex flex-col items-center gap-2 px-6 py-7 text-center">
        <TriangleAlert aria-hidden size={26} className="text-danger" />
        <Heading className="m-0 text-[18px] font-semibold text-ink">{title}</Heading>
        <p className="m-0 text-[14px] text-ink-muted">{line}</p>
        {(retry || extra) && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            {retry && <Button variant="secondary" size="md" onClick={retry}>Try again</Button>}
            {extra}
          </div>
        )}
      </div>
    </Card>
  );
}

/** The server worded this refusal itself: a token we have words for, or a plan limit. */
const serverWorded = (error: unknown) => {
  const token = refusalToken(error);
  return !!token && (Object.hasOwn(COPY, token) || LIMIT_CODES.has(token));
};

/** What to say about a failed read, in order: the server's words, no answer, anything else. */
export function failedLine(error: unknown): string {
  if (serverWorded(error)) return documentRefusalMessage(error);
  const { kind } = classifyApiFailure(error);
  if (kind === "unreachable" || kind === "server") return "Nothing is lost. Check your connection and try again.";
  return documentRefusalMessage(error);
}

export const Failed = ({ error, retry, what, lead = "We couldn't load this." }: {
  error: unknown; retry(): void; /** "your documents": draws the panel */ what?: string;
  /** The notice's first sentence when the server gave none, for a failure that is not a load. */ lead?: string;
}) =>
  what ? (
    <CouldNotLoad title={`We couldn't load ${what}.`} line={failedLine(error)} retry={retry} />
  ) : (
    <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}>
      {serverWorded(error) ? failedLine(error) : `${lead} ${failedLine(error)}`}
    </StatusNotice>
  );

/** Failed checks are a heads-up; they never stop a send. In the inbox nothing is set up (so "fields not confirmed" is no news)
 *  and nothing is sent from the document, so neither is said. */
export function Checks({ checks, inbox = false }: { checks: DocumentCheck[]; inbox?: boolean }) {
  const failed = checks.filter((c) => !c.passed && !(inbox && c.code === "fields_unconfirmed"));
  if (!failed.length) return null;
  return (
    <div className="grid gap-2">
      {failed.map((c, i) => <StatusNotice key={`${c.code}-${i}`} tone="warning">{c.message}</StatusNotice>)}
      {!inbox && <p className="m-0 text-[12.5px] text-ink-muted">Checks are a heads-up; they never stop you sending.</p>}
    </div>
  );
}

/** Why a document has nothing to edit, and the way forward: a failed read, or a file we had already. */
export function ReadProblem({ summary, retry, scansOn, uploadHref, held }: {
  summary: DocumentSummary; scansOn?: boolean; retry: UseMutationResult<unknown, unknown, void>;
  /** Where "Upload a clearer copy" goes: where this screen uploads to the document's flow. */
  uploadHref: string;
  /** The server's sentence for a held duplicate ("This file is already in your workspace." in the inbox). */
  held?: string;
}) {
  if (AUTOMATIC_HOLDS.has(summary.statusReason ?? "")) return <StatusNotice tone="warning">{readFailureMessage(summary.statusReason)}</StatusNotice>;
  // A held duplicate always shows its hold and "Read it anyway", even when values were read (a moved inbox document was).
  const duplicate = summary.statusReason === "duplicate_file";
  if (summary.status !== "read_failed" && !duplicate) return null;
  const again = duplicate ? "Read it anyway" : canRetryRead(summary.statusReason, { scansOn }) ? "Try again" : null;
  return (
    <div className="grid gap-2">
      <StatusNotice
        tone={duplicate ? "warning" : "error"}
        action={again && <Button variant="secondary" size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>{again}</Button>}
      >
        {duplicate ? held ?? "This file was already uploaded to this flow." :readFailureMessage(summary.statusReason)}
      </StatusNotice>
      {summary.status === "read_failed" && (
        <>
          <p className="m-0 text-[13px] text-ink-muted">It hasn't been sent anywhere, and it doesn't count as a document on your plan.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={uploadHref} className={buttonClass("secondary", "md")}>Upload a clearer copy</Link>
          </div>
        </>
      )}
      {retry.isError && <StatusNotice tone="error">{documentRefusalMessage(retry.error)}</StatusNotice>}
    </div>
  );
}
