"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/bridge/EmptyState";
import { isApiMockMode } from "@/lib/api-client";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";

// Demo drafts are dev-only. There is no draft-persistence endpoint yet, so real
// users (NEXT_PUBLIC_USE_MOCK=false) see an honest empty state instead of
// fabricated rows that would 404 against the live API.
const DEMO_DRAFTS = [
  { id: "d1", po: "PO-2026-008422", buyer: "Heinrich Industries", supplier: "Acme Components", savedAt: "3m", stage: "Validate", issues: 2 },
  { id: "d2", po: "AR-2026-1110",   buyer: "Atlas Reseller AG",   supplier: "Nordix Distribution", savedAt: "2h",  stage: "Normalize", issues: 0 },
];

const DRAFTS = isApiMockMode ? DEMO_DRAFTS : [];

export default function DraftsPage() {
  const router = useRouter();

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Drafts"
        sub="Orders saved but not yet sent"
        actions={
          <Button
            variant="blue"
            size="md"
            onClick={() => router.push("/upload")}
          >
            {/* plus icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M12 5v14" />
            </svg>
            New
          </Button>
        }
      />

      {DRAFTS.length === 0 ? (
        // ── Empty state — card-wrapped, matching the design source's
        // GenericLibraryScreen (a single .card containing EmptyState: bare
        // Mark, Bricolage title, muted sub, secondary action). ────────────
        <Card className="flex items-center justify-center min-h-[360px]">
          <EmptyState
            title="Drafts live here"
            sub="Save an order while you are still resolving it — mapping SKUs, clearing exceptions, picking a supplier — and it waits here until you are ready to send it."
            action={{ label: "Go to Inbox", onClick: () => router.push("/inbox") }}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {DRAFTS.map((d) => (
            // Draft row: MobileListRow pattern with amber left-border accent.
            // MobileListRow does not accept a style prop, so we replicate its
            // interactive behaviour on a styled div (role/tabIndex/keyboard/
            // tap-min/press feedback) with the amber border-left intact.
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/inbox/${d.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/inbox/${d.id}`); } }}
              className="flex flex-col gap-3 cursor-pointer active:bg-surface-2 sm:flex-row sm:items-center sm:gap-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderLeft: "3px solid var(--amber)",
                borderRadius: "var(--radius-md)",
                padding: "14px 16px",
                boxShadow: "var(--shadow-card)",
                minHeight: "var(--tap-min)",
                WebkitTapHighlightColor: "transparent",
                transition: "background 120ms, box-shadow 120ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(11,26,47,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "var(--shadow-card)"; }}
            >
              {/* Identity: PO number + buyer → supplier. Flexes to fill on
                  desktop, pushing the meta cluster to the right. */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-[12px] font-semibold"
                  style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)", color: "var(--ink)", margin: 0 }}
                >
                  {d.po}
                </p>
                <p className="text-[12px] mt-1 flex items-center gap-1.5 min-w-0" style={{ color: "var(--ink-muted)", margin: "4px 0 0" }}>
                  <span className="truncate" style={{ color: "var(--ink)", fontWeight: 500 }}>{d.buyer}</span>
                  <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>→</span>
                  <span className="truncate" style={{ color: "var(--brand-green-deep)", fontWeight: 500 }}>{d.supplier}</span>
                </p>
              </div>

              {/* Meta cluster: stage + exceptions + saved-at, grouped so the
                  pills sit next to the timestamp. Reuses the ported .pill
                  design classes (amber stage, red exceptions). On mobile it
                  wraps under the identity block, left-aligned. */}
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <span className="pill pill-review"><span className="dot" />{d.stage}</span>
                {d.issues > 0 && (
                  <span className="pill pill-failed">
                    <span className="dot" />
                    {d.issues} {d.issues === 1 ? "exception" : "exceptions"}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "var(--ink-faint)", minWidth: 56, textAlign: "right" }}>{d.savedAt} ago</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
