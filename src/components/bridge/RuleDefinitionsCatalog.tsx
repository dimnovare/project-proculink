"use client";

// Rule definitions catalog (Group V4) — the org's reusable validation rule
// definitions, grouped by scope. Each row shows code, title and default
// severity, with an expandable info affordance that reveals the standards
// references (UBL / EDIFACT / X12 / cXML) — this satisfies the project's
// standards-visibility rule. Read-only: authoring acceptance rules lives on each
// supplier's Validation rules tab.
//
// Endpoint: GET /api/rule-definitions → RuleDefinition[] (org-scoped server-side).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listRuleDefinitions, type RuleDefinition } from "@/lib/api-client";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { HubTabs } from "@/components/bridge/layout/HubTabs";
import { Card } from "@/components/bridge/layout/Card";
import { StandardsRefList, hasStandardsRefs } from "@/components/bridge/StandardsRefList";

// Severity → swatch (default severity classification, not a gate).
const SEV_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  error: { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Error" },
  warning: { bg: "var(--amber-soft)", fg: "var(--amber)", label: "Warning" },
  info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", label: "Info" },
};

function SeverityPill({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity?.toLowerCase()] ?? { bg: "var(--surface-2)", fg: "var(--ink-muted)", label: severity };
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

// Human label per known scope; unknown scopes are humanized.
function scopeLabel(scope: string): string {
  const s = (scope ?? "").toLowerCase();
  if (s === "order") return "Order-level";
  if (s === "line") return "Line-level";
  if (s === "header") return "Header";
  if (!s) return "Other";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function RuleDefinitionRow({ def }: { def: RuleDefinition }) {
  const [open, setOpen] = useState(false);
  const refs = { ublRef: def.ublRef, edifactRef: def.edifactRef, x12Ref: def.x12Ref, cxmlRef: def.cxmlRef };
  const showRefs = hasStandardsRefs(refs);

  return (
    <div style={{ borderBottom: "1px solid #F0F2F6" }}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{def.title}</span>
            <SeverityPill severity={def.defaultSeverity} />
            {def.isSystem && (
              <span className="inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]" style={{ background: "var(--surface-2)", color: "var(--ink-faint)" }}>
                System
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11px]" style={{ color: "var(--ink-faint)" }}>{def.code}</span>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>·</span>
            <span className="font-mono text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {def.fieldPath} {def.operator}{def.defaultExpectedValue ? ` ${def.defaultExpectedValue}` : ""}
            </span>
          </div>
          {def.description && (
            <p className="mt-1.5 text-[12px] leading-snug" style={{ color: "var(--ink-muted)" }}>{def.description}</p>
          )}
        </div>
        {showRefs && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide standards mapping" : "Show standards mapping"}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-[6px] px-2 h-[28px] text-[11.5px] font-medium transition-colors"
            style={{ border: "1px solid var(--border)", background: open ? "var(--surface-2)" : "var(--surface)", color: "var(--ink-muted)", cursor: "pointer" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            Standards
          </button>
        )}
      </div>
      {open && showRefs && (
        <div className="px-4 pb-3.5">
          <div className="rounded-[8px] px-3.5 py-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)" }}>
              Maps to
            </div>
            <StandardsRefList refs={refs} />
          </div>
        </div>
      )}
    </div>
  );
}

export function RuleDefinitionsCatalog() {
  const queryEnabled = useQueriesEnabled();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["rule-definitions"],
    queryFn: listRuleDefinitions,
    enabled: queryEnabled,
    staleTime: 60_000,
    retry: 1,
  });

  const showLoading = !queryEnabled || (isLoading && data === undefined);

  // Group by scope, preserving a stable order (order → line → header → others).
  const groups = useMemo(() => {
    const defs = data ?? [];
    const byScope = new Map<string, RuleDefinition[]>();
    for (const d of defs) {
      const key = (d.scope ?? "").toLowerCase() || "other";
      const arr = byScope.get(key) ?? [];
      arr.push(d);
      byScope.set(key, arr);
    }
    const order = ["order", "line", "header"];
    return Array.from(byScope.entries()).sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [data]);

  const total = data?.length ?? 0;

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Rule definitions"
        sub={
          [
            "Your reusable validation rule catalog, with the standard each field maps to.",
            !showLoading && !isError ? `${total} definition${total === 1 ? "" : "s"}` : "",
          ]
            .filter(Boolean)
            .join("  ")
        }
      />

      {/* Hub tab bar — Rules & formats hub (this sub-route lights the Rules tab) */}
      <HubTabs hub="rules-formats" />

      {/* Read-only context — authoring is per supplier */}
      <div
        className="mb-4 flex flex-col gap-1.5 rounded-[8px] px-3.5 py-2.5 text-[12px] sm:flex-row sm:items-center sm:gap-2.5"
        style={{ border: "1px solid #D6E2F4", background: "var(--brand-blue-soft)", color: "var(--ink)" }}
      >
        <span className="font-semibold" style={{ color: "var(--brand-blue-deep)" }}>Built-in rule definitions.</span>
        <span style={{ color: "var(--ink-muted)" }}>
          These are the building blocks for acceptance rules. Bind and enforce them on each{" "}
          <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "var(--brand-blue)" }}>supplier&apos;s Validation rules tab</Link>.
        </span>
      </div>

      {/* Loading */}
      {showLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-44 rounded-[12px] animate-pulse" style={{ background: "var(--surface-2)" }} />
          ))}
        </div>
      )}

      {/* Error */}
      {!showLoading && isError && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <p className="text-[14px] font-semibold" style={{ color: "var(--danger)" }}>Couldn&apos;t load rule definitions</p>
            <p className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>This is usually transient.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-1 rounded-[8px] px-4 h-[36px] text-[12.5px] font-semibold"
              style={{ background: "var(--ink)", color: "#FFFFFF", border: 0, cursor: "pointer" }}
            >
              ↻ Retry
            </button>
          </div>
        </Card>
      )}

      {/* Empty */}
      {!showLoading && !isError && total === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <p className="text-[16px] font-semibold" style={{ color: "var(--ink)", fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}>
              No rule definitions yet
            </p>
            <p className="text-[12.5px]" style={{ color: "var(--ink-muted)", maxWidth: 420 }}>
              Your org has no reusable validation rule definitions. They appear here once defined.
            </p>
          </div>
        </Card>
      )}

      {/* Grouped catalog */}
      {!showLoading && !isError && total > 0 && (
        <div className="grid gap-4">
          {groups.map(([scope, defs]) => (
            <div key={scope}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{scopeLabel(scope)}</h2>
                <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{defs.length}</span>
              </div>
              <div
                className="overflow-hidden rounded-[12px]"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}
              >
                {defs.map((d) => (
                  <RuleDefinitionRow key={d.id} def={d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default RuleDefinitionsCatalog;
