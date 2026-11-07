import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import type { DocumentCheck, DocumentSummary } from "@/lib/api/documents";
import { canRetryRead, documentRefusalMessage, readFailureMessage } from "@/lib/documentRefusals";

/** Reasons the engine parks a document for review on its own, each worded in COPY. */
const AUTOMATIC_HOLDS = new Set(["no_output_matches", "output_invalid"]);

export const Quiet = ({ children }: { children: string }) => (
  <p role="status" className="m-0 text-[13px] text-ink-muted">{children}</p>
);

export const Failed = ({ error, retry }: { error: unknown; retry(): void }) => (
  <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={retry}>Retry</Button>}>
    {documentRefusalMessage(error)}
  </StatusNotice>
);

export const destinationName = (q: { data?: { id: string; name: string }[]; isError: boolean }, id: string | null) =>
  !id ? "Download only" : q.data?.find((d) => d.id === id)?.name ?? (q.isError ? "Unknown destination" : "…");

/** Failed checks are a heads-up; they never stop a send. */
export function Checks({ checks }: { checks: DocumentCheck[] }) {
  const failed = checks.filter((c) => !c.passed);
  if (!failed.length) return null;
  return (
    <div className="grid gap-2">
      {failed.map((c, i) => <StatusNotice key={`${c.code}-${i}`} tone="warning">{c.message}</StatusNotice>)}
      <p className="m-0 text-[12px] text-ink-muted">Checks are a heads-up; they never stop you sending.</p>
    </div>
  );
}

/** Why a document has nothing to edit, and the way forward: a failed read, or a file we had already. */
export function ReadProblem({ summary, nothingRead, retry }: {
  summary: DocumentSummary; nothingRead: boolean; retry: UseMutationResult<unknown, unknown, void>;
}) {
  if (AUTOMATIC_HOLDS.has(summary.statusReason ?? "")) return <StatusNotice tone="warning">{readFailureMessage(summary.statusReason)}</StatusNotice>;
  const duplicate = summary.statusReason === "duplicate_file" && nothingRead;
  if (summary.status !== "read_failed" && !duplicate) return null;
  const again = duplicate ? "Read it anyway" : canRetryRead(summary.statusReason) ? "Try again" : null;
  return (
    <div className="grid gap-2">
      <StatusNotice
        tone={duplicate ? "warning" : "error"}
        action={again && <Button variant="secondary" size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>{again}</Button>}
      >
        {duplicate ? "This file was already uploaded to this flow." : readFailureMessage(summary.statusReason)}
      </StatusNotice>
      {retry.isError && <StatusNotice tone="error">{documentRefusalMessage(retry.error)}</StatusNotice>}
    </div>
  );
}
