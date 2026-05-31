"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/bridge/EmptyState";
import { isApiMockMode } from "@/lib/api-client";

// ── Palette — ported verbatim from the design system (tokens.css / globals.css) ─
// The design source renders the drafts screen as GenericLibraryScreen, whose
// primary "New" action is variant="blue" — buyer-blue #1E66C9, the ProcuLink
// PRIMARY / ACTIVE colour. The supplier entity uses the design's forest green
// (#2E8E3A / deep #1E6D29) — NOT the retired #28C55E. Stage / exception meta on a
// draft row reuse the ported .pill design classes (.pill-review amber,
// .pill-failed red) so colours stay identical to the rest of the app.
const BLUE        = "#1E66C9"; // --brand-blue        · primary / buyer / active (New button)
const BLUE_HOVER  = "#0F4FA8"; // --brand-blue-deep
const GREEN_DEEP  = "#1E6D29"; // --brand-green-deep  · supplier name text
const INK         = "#0B1A2F"; // --ink               · title + PO number
const TEXT_MUTED  = "#56627A"; // --ink-muted         · subtitle / body
const TEXT_FAINT  = "#8A93A5"; // --ink-faint         · arrow / saved-at meta
const BORDER      = "#E2E6EE"; // --border            · card border
const CANVAS      = "#F6F7FA"; // --surface-1         · page canvas

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
    <div className="flex flex-col h-full min-h-0 overflow-auto" style={{ background: CANVAS }}>
      <div className="mx-auto w-full max-w-[1480px] flex-1 min-h-0 px-4 pb-16 pt-5 sm:px-6 md:px-[34px] sm:pt-[26px]">
        {/* ── Page header — title + subtitle on the page surface, primary blue
            "New" action on the right (design source: GenericLibraryScreen,
            variant="blue"). Subtitle is plain copy. ──────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "14px 24px",
            marginBottom: 22,
            flexWrap: "wrap",
          }}
        >
          <div className="min-w-0">
            <h1
              className="text-[26px] sm:text-[30px]"
              style={{
                fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
                fontWeight: 600,
                letterSpacing: "-0.025em",
                lineHeight: 1.1,
                margin: 0,
                color: INK,
              }}
            >
              Drafts
            </h1>
            <div style={{ color: TEXT_MUTED, fontSize: 13, marginTop: 5 }}>
              Orders saved but not yet sent
            </div>
          </div>

          {/* New draft → start a fresh upload */}
          <button
            onClick={() => router.push("/upload")}
            className="h-9 sm:h-[34px]"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              padding: "0 16px",
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              background: BLUE,
              color: "#FFFFFF",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(30,102,201,0.30)",
              transition: "background 150ms",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE_HOVER; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
          >
            {/* plus icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5v14" />
            </svg>
            New
          </button>
        </div>

        {DRAFTS.length === 0 ? (
          // ── Empty state — card-wrapped, matching the design source's
          // GenericLibraryScreen (a single .card containing EmptyState: bare
          // Mark, Bricolage title, muted sub, secondary action). ────────────
          <div
            className="flex items-center justify-center"
            style={{
              background: "#FFFFFF",
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
              minHeight: 360,
            }}
          >
            <EmptyState
              title="Drafts live here"
              sub="Save an order while you are still resolving it — mapping SKUs, clearing exceptions, picking a supplier — and it waits here until you are ready to send it."
              action={{ label: "Go to Inbox", onClick: () => router.push("/inbox") }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {DRAFTS.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/inbox/${d.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/inbox/${d.id}`); } }}
                className="flex flex-col gap-3 cursor-pointer sm:flex-row sm:items-center sm:gap-4"
                style={{
                  background: "#FFFFFF",
                  border: `1px solid ${BORDER}`,
                  borderLeft: "3px solid var(--amber)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
                  transition: "box-shadow 120ms, border-color 120ms",
                  WebkitTapHighlightColor: "transparent",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(11,26,47,0.08)"; e.currentTarget.style.borderColor = "#D4DAE5"; e.currentTarget.style.borderLeftColor = "var(--amber)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(11,26,47,0.04)"; e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.borderLeftColor = "var(--amber)"; }}
              >
                {/* Identity: PO number + buyer → supplier. Flexes to fill on
                    desktop, pushing the meta cluster to the right. */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[12px] font-semibold"
                    style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)", color: INK, margin: 0 }}
                  >
                    {d.po}
                  </p>
                  <p className="text-[12px] mt-1 flex items-center gap-1.5 min-w-0" style={{ color: TEXT_MUTED, margin: "4px 0 0" }}>
                    <span className="truncate" style={{ color: INK, fontWeight: 500 }}>{d.buyer}</span>
                    <span style={{ color: TEXT_FAINT, flexShrink: 0 }}>→</span>
                    <span className="truncate" style={{ color: GREEN_DEEP, fontWeight: 500 }}>{d.supplier}</span>
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
                  <span style={{ fontSize: 11, color: TEXT_FAINT, minWidth: 56, textAlign: "right" }}>{d.savedAt} ago</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
