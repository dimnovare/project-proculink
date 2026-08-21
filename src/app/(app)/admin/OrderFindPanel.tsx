"use client";

// The PO-number support lookup — GET /api/admin/orders/find.
//
// WHY IT IS THE FIRST THING ON /admin. This is the "a customer just emailed me"
// entry point: someone writes "PO 4500012580 never arrived", and until this
// endpoint existed there was no route at all from a PO number to the workspace
// that owns it. The founder's own memory was the index.
//
// THREE THINGS THIS SCREEN REFUSES TO DO:
//
//  1. Render a failed fetch as an empty result. "No order in any workspace carries
//     that PO number" is a strong claim, and a 503 does not support it. The error
//     branch is explicit, announced (StatusNotice owns role/tone), and offers a
//     retry — the defect family fixed across eight surfaces this month.
//
//  2. Round a capped result down to a complete one. The server takes one row over
//     its cap precisely so it can say `capped: true`; the panel repeats that.
//
//  3. Promise a drill-down it does not have. A platform admin holds no membership
//     in a customer's organisation, so /inbox/{orderId} would 404 for them. The
//     result names the workspace and stops there, and says so out loud.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { findAdminOrdersByPo, type AdminOrderFindResult } from "@/lib/api-client";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderFindPanel({
  /** Org ids the customers table below is rendering, so a match can link to its row. */
  knownOrgIds,
}: {
  knownOrgIds?: Set<string>;
}) {
  const queryEnabled = useQueriesEnabled();
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");

  const findQ = useQuery<AdminOrderFindResult>({
    queryKey: ["admin-order-find", submitted],
    queryFn: () => findAdminOrdersByPo(submitted),
    enabled: queryEnabled && submitted.length > 0,
    retry: false,
    // A support lookup is a point-in-time question; a cached answer from ten
    // minutes ago is the wrong answer to "is it moving yet?".
    staleTime: 0,
    gcTime: 0,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setSubmitted(next);
  }

  return (
    <Card
      as="section"
      data-testid="admin-order-find"
      aria-label="Find an order by PO number"
      className="mb-5"
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: "var(--ink-faint)" }}
      >
        Find an order by PO number
      </div>
      <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
        A customer quotes a PO number; this says which workspace it belongs to. Searches
        every organisation.
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="PO number"
          placeholder="e.g. 4500012580"
          className="min-w-0 flex-1 rounded-[8px] px-3 py-2 text-[13px] font-mono"
          style={{
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--ink)",
            minHeight: "var(--tap-min)",
          }}
        />
        <Button type="submit" variant="blue" size="lg" disabled={draft.trim().length === 0}>
          <Search size={15} strokeWidth={2} aria-hidden style={{ marginRight: 4 }} />
          Find order
        </Button>
      </form>

      {submitted.length > 0 && (
        <div className="mt-3">
          {findQ.isError ? (
            // NOT an empty state. The lookup did not run to an answer, and saying
            // "no order carries that PO number" here would be a fabricated verdict.
            <StatusNotice
              tone="error"
              action={
                <Button variant="secondary" size="sm" onClick={() => findQ.refetch()}>
                  Retry
                </Button>
              }
            >
              The lookup did not complete, so nothing is known about {submitted} either way.{" "}
              {findQ.error instanceof Error ? findQ.error.message : "The API may be unavailable."}
            </StatusNotice>
          ) : findQ.data === undefined ? (
            // NOT the empty state, and this branch has to come FIRST.
            //
            // The query is `enabled: queryEnabled && …`, and a DISABLED TanStack query
            // is neither loading nor errored — `data` is simply `undefined`. Checking
            // `matches.length === 0` before this fell through to "no order in any
            // workspace carries that number": a verdict about every customer's data,
            // reached without a single request leaving the browser, during the window
            // where Clerk had not finished loading. Absence of an answer is not an
            // answer of absence.
            <div
              data-testid="admin-order-find-pending"
              className="text-[13px]"
              style={{ color: "var(--ink-muted)" }}
            >
              {queryEnabled
                ? `Searching every workspace for ${submitted}…`
                : "Waiting for your session before searching — nothing has been looked up yet."}
            </div>
          ) : findQ.data.matches.length === 0 ? (
            <div
              data-testid="admin-order-find-empty"
              className="rounded-[8px] px-3 py-2.5 text-[13px]"
              style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
            >
              No order in any workspace carries the PO number {submitted}. Check the spelling
              with the customer — casing and padding are already ignored.
            </div>
          ) : (
            <>
              {findQ.data.capped && (
                <div className="mb-2 text-[12px]" style={{ color: "var(--amber-text)" }}>
                  More matched than are shown — these are the first {findQ.data.count}, exact
                  spellings first.
                </div>
              )}
              <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {findQ.data.matches.map((m) => (
                  <li
                    key={m.orderId}
                    className="rounded-[8px] px-3 py-2.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {knownOrgIds?.has(m.orgId) ? (
                        <a
                          href={`#org-${m.orgId}`}
                          className="text-[13.5px] font-semibold"
                          style={{ color: "var(--brand-blue-deep)", textDecoration: "none" }}
                        >
                          {m.orgName}
                        </a>
                      ) : (
                        <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
                          {m.orgName}
                        </span>
                      )}
                      <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                        {m.orgSlug}
                      </span>
                    </div>
                    <div
                      className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      <span className="font-mono">{m.poNumber}</span>
                      <span>
                        status <strong style={{ color: "var(--ink)" }}>{m.status}</strong>
                      </span>
                      <span>{m.supplierName ?? "no supplier assigned"}</span>
                    </div>
                    <div className="mt-1 text-[11.5px] font-mono" style={{ color: "var(--ink-faint)" }}>
                      {m.orderId}
                    </div>
                    <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                      created {stamp(m.createdAt)} · updated {stamp(m.updatedAt)}
                    </div>
                  </li>
                ))}
              </ul>
              <p
                data-testid="admin-order-find-limit"
                className="mt-2 text-[11.5px]"
                style={{ color: "var(--ink-faint)" }}
              >
                You are not a member of these workspaces, so there is no order screen to open
                from here. This lookup tells you whose workspace to ask about.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
