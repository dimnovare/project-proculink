"use client";

// Connections list — Group V1. One row per versioned Supplier Connection
// (name, active version, status, last published). Reads GET /api/connections.
// Reachable from the sidebar (Library → Connections) and the Suppliers page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { EmptyState } from "@/components/bridge/EmptyState";
import { Button } from "@/components/bridge/DSPrimitives";
import { UnifiedStatusBadge, statusTone } from "@/components/bridge/UnifiedStatusBadge";
import { listConnections, isApiMockMode } from "@/lib/api-client";
import type { ConnectionSummary } from "@/lib/api/types";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { formatDate } from "@/lib/format-date";

/** Left-accent colour per semantic tone, mirroring UnifiedStatusBadge's token map. */
const TONE_ACCENT: Record<string, string> = {
  success: "var(--brand-green)",
  warning: "var(--amber)",
  danger: "var(--danger)",
  info: "var(--brand-blue)",
  neutral: "var(--ink-faint)",
};

/**
 * Resolve a connection's real row status for UnifiedStatusBadge (no more all-green).
 * Live (has an active published revision) -> success; draft-only -> neutral. The
 * needs-attention -> warning branch is wired for when the summary DTO exposes such
 * a signal; ConnectionSummary carries none today, so it never fires (no fake data).
 */
function badgeStatus(c: ConnectionSummary): { status: string; accent: string } {
  const status = c.activeRevisionId ? "live" : "draft";
  return { status, accent: TONE_ACCENT[statusTone(status)] ?? "var(--ink-faint)" };
}

export function ConnectionsList() {
  const router = useRouter();
  const queriesEnabled = useQueriesEnabled();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: queriesEnabled,
  });

  const connections: ConnectionSummary[] = data ?? [];

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Connections"
        sub="Each supplier's complete setup — how their orders are mapped, checked and delivered — with safe version history."
        actions={
          <Button variant="secondary" size="md" onClick={() => router.push("/library/suppliers")}>
            Manage suppliers
          </Button>
        }
      />

      {isLoading && (
        <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading connections">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-[8px] animate-pulse"
              style={{ height: 76, background: "var(--border)", border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <Card className="flex flex-col items-center justify-center gap-3 text-center" >
          <p className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>
            Could not load connections
          </p>
          <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            Check the API connection and try again.
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      )}

      {!isLoading && !isError && connections.length === 0 && (
        <Card className="flex items-center justify-center min-h-[360px]">
          <EmptyState
            title="No connections yet"
            sub={
              isApiMockMode
                ? "Connections appear here once a supplier integration exists."
                : "A connection is created the first time you configure a supplier. Add a supplier and set up its mapping, output and delivery — it becomes a versioned connection you can publish and roll back."
            }
            action={{ label: "Go to Suppliers", onClick: () => router.push("/library/suppliers") }}
          />
        </Card>
      )}

      {!isLoading && !isError && connections.length > 0 && (
        <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
          {connections.map((c) => {
            const badge = badgeStatus(c);
            return (
            <li key={c.id}>
              <Link
                href={`/connections/${c.id}`}
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 no-underline"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderLeft: `3px solid ${badge.accent}`,
                  borderRadius: "var(--radius-md)",
                  padding: "14px 16px",
                  boxShadow: "var(--shadow-card)",
                  minHeight: "var(--tap-min)",
                  WebkitTapHighlightColor: "transparent",
                  transition: "box-shadow 120ms",
                }}
              >
                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[14px] font-semibold truncate"
                    style={{ color: "var(--ink)", margin: 0 }}
                  >
                    {c.name}
                  </p>
                  <p
                    className="text-[12px] mt-1"
                    style={{ color: "var(--ink-muted)", margin: "4px 0 0" }}
                  >
                    {c.activeVersionNo != null ? (
                      <>
                        Live version{" "}
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>v{c.activeVersionNo}</span>
                        {" · since "}
                        {formatDate(c.updatedAt)}
                      </>
                    ) : (
                      <span style={{ fontStyle: "italic" }}>Not live yet</span>
                    )}
                  </p>
                </div>

                {/* Meta cluster */}
                <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                  <span
                    className="inline-flex"
                    style={{ cursor: "help" }}
                    title={
                      badge.status === "live"
                        ? "New orders are using this version."
                        : "A work-in-progress — not processing orders yet."
                    }
                    aria-label={
                      badge.status === "live"
                        ? "Live — new orders are using this version."
                        : "Draft — a work-in-progress, not processing orders yet."
                    }
                  >
                    <UnifiedStatusBadge status={badge.status} icon />
                  </span>
                  <span aria-hidden style={{ color: "var(--ink-faint)", fontSize: 16 }}>
                    ›
                  </span>
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}

export default ConnectionsList;
