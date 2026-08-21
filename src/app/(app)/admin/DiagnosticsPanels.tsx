"use client";

// The two read-only admin diagnostics that were curl-only:
//
//   GET /api/admin/job-failures        recent Hangfire failures
//   GET /api/admin/item-mapping-twins  learned mappings differing only in CASE
//
// COLLAPSED BY DEFAULT, AND THE QUERY IS GATED ON THAT. This is diagnostics, not a
// dashboard: nobody opens /admin to look at the Hangfire queue, and a cross-org twin
// scan walks every organisation server-side. Both panels cost nothing until asked.
//
// THE HONESTY PROBLEM THAT SHAPES THE EMPTY STATE. AdminController.GetJobFailures
// catches an unreachable Hangfire monitoring API and answers 200 with an EMPTY list
// rather than a 500. So on this one panel "nothing here" has two possible meanings
// and the response cannot distinguish them. The empty copy says that instead of
// reading as an all-clear — the panel whose whole job is noticing a broken worker is
// the worst possible place to invent good news.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  getAdminJobFailures,
  getAdminItemMappingTwins,
  type AdminJobFailures,
  type AdminItemMappingTwins,
} from "@/lib/api-client";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

function stamp(iso: string | null): string {
  if (!iso) return "unknown time";
  return new Date(iso).toLocaleString("en-IE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One disclosure panel. The heading IS the button — `aria-expanded` is on the
 * control, not on a decorative chevron — so a screen reader is told the panel is
 * shut rather than told nothing.
 */
function Disclosure({
  testId,
  title,
  sub,
  open,
  onToggle,
  children,
}: {
  testId: string;
  title: string;
  sub: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" data-testid={testId} aria-label={title}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 bg-transparent text-left"
        style={{
          border: 0,
          padding: 0,
          cursor: "pointer",
          minHeight: "var(--tap-min)",
        }}
      >
        <span aria-hidden style={{ color: "var(--ink-faint)", marginTop: 1 }}>
          {open ? <ChevronDown size={15} strokeWidth={2} /> : <ChevronRight size={15} strokeWidth={2} />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            className="block text-[11px] font-semibold uppercase tracking-[0.05em]"
            style={{ color: "var(--ink-faint)" }}
          >
            {title}
          </span>
          <span className="mt-0.5 block text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            {sub}
          </span>
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </Card>
  );
}

// ── Job failures ─────────────────────────────────────────────────────────────

export function JobFailuresPanel() {
  const queryEnabled = useQueriesEnabled();
  const [open, setOpen] = useState(false);

  const q = useQuery<AdminJobFailures>({
    queryKey: ["admin-job-failures"],
    queryFn: () => getAdminJobFailures(50),
    enabled: queryEnabled && open,
    retry: false,
    staleTime: 15_000,
  });

  return (
    <Disclosure
      testId="admin-job-failures"
      title="Worker job failures"
      sub="The most recent Hangfire failures, so a stuck worker is visible without opening the job store."
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {q.isError ? (
        <StatusNotice
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => q.refetch()}>
              Retry
            </Button>
          }
        >
          Could not read the job failures, so the worker&apos;s state is unknown — this is not
          an all-clear.{" "}
          {q.error instanceof Error ? q.error.message : "The API may be unavailable."}
        </StatusNotice>
      ) : q.data === undefined ? (
        // NOT the empty state, and it MUST be checked before emptiness. The query is
        // `enabled: queryEnabled && open`, and a DISABLED TanStack query is neither
        // loading nor errored — `data` is just `undefined`. Testing `length === 0`
        // first rendered the all-clear below during the window where Clerk had not
        // loaded, without one request having been made. Absence of an answer is not
        // an answer of absence.
        <div className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
          {queryEnabled ? "Reading the job store…" : "Waiting for your session — nothing has been read yet."}
        </div>
      ) : q.data.failures.length === 0 ? (
        <div
          data-testid="admin-job-failures-empty"
          className="rounded-[8px] px-3 py-2.5 text-[13px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
        >
          No failed jobs are recorded. Read that carefully: the API returns an empty list both
          when nothing has failed and when the Hangfire job store is unreachable, so this is
          not proof the worker is running.
        </div>
      ) : (
        <>
          <div className="mb-2 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            Showing {q.data.shown} of {q.data.totalFailed} failed job
            {q.data.totalFailed === 1 ? "" : "s"} in the store.
          </div>
          <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {q.data.failures.map((f) => (
              <li
                key={f.id}
                className="rounded-[8px] px-3 py-2.5"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[13px] font-semibold font-mono" style={{ color: "var(--ink)" }}>
                    {f.job}
                  </span>
                  <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                    {stamp(f.failedAt)}
                  </span>
                </div>
                {f.exceptionType && (
                  <div className="mt-1 text-[12.5px] font-mono" style={{ color: "var(--danger)" }}>
                    {f.exceptionType}
                  </div>
                )}
                {f.exceptionMessage && (
                  <div
                    className="mt-1 text-[12.5px]"
                    style={{ color: "var(--ink-muted)", overflowWrap: "anywhere" }}
                  >
                    {f.exceptionMessage}
                  </div>
                )}
                {f.reason && (
                  <div className="mt-1 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                    {f.reason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Disclosure>
  );
}

// ── Case-variant item mapping twins ──────────────────────────────────────────

export function ItemMappingTwinsPanel() {
  const queryEnabled = useQueriesEnabled();
  const [open, setOpen] = useState(false);

  const q = useQuery<AdminItemMappingTwins>({
    queryKey: ["admin-item-mapping-twins"],
    queryFn: getAdminItemMappingTwins,
    enabled: queryEnabled && open,
    retry: false,
    staleTime: 60_000,
  });

  return (
    <Disclosure
      testId="admin-item-mapping-twins"
      title="Case-variant item mappings"
      sub="Learned mappings whose buyer codes differ only in capitalisation. Read-only — this list can only shrink."
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {q.isError ? (
        <StatusNotice
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => q.refetch()}>
              Retry
            </Button>
          }
        >
          Could not read the item-mapping twins, so whether any exist is unknown.{" "}
          {q.error instanceof Error ? q.error.message : "The API may be unavailable."}
        </StatusNotice>
      ) : q.data === undefined ? (
        // NOT the empty state, and it MUST be checked before emptiness. The query is
        // `enabled: queryEnabled && open`, and a DISABLED TanStack query is neither
        // loading nor errored — `data` is just `undefined`. Testing `length === 0`
        // first rendered the all-clear below during the window where Clerk had not
        // loaded, without one request having been made. Absence of an answer is not
        // an answer of absence.
        <div className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
          {queryEnabled ? "Scanning every workspace…" : "Waiting for your session — nothing has been read yet."}
        </div>
      ) : q.data.groups.length === 0 ? (
        <div
          data-testid="admin-item-mapping-twins-empty"
          className="rounded-[8px] px-3 py-2.5 text-[13px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
        >
          No case-variant twins in any workspace.
        </div>
      ) : (
        <>
          <div className="mb-2 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            {q.data.note}
          </div>
          <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {q.data.groups.map((g) => (
              <li
                key={`${g.organisationId}:${g.supplierId}:${g.foldedCode}`}
                className="rounded-[8px] px-3 py-2.5"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="text-[13px] font-semibold font-mono" style={{ color: "var(--ink)" }}>
                  {g.foldedCode}
                </div>
                <div className="mt-1 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
                  {g.rowCount} rows spelled{" "}
                  <span className="font-mono" style={{ color: "var(--ink)" }}>
                    {g.spellings.join(" · ")}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] font-mono" style={{ color: "var(--ink-faint)" }}>
                  org {g.organisationId} · supplier {g.supplierId}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Disclosure>
  );
}
