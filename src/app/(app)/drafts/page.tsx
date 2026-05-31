"use client";
import { useRouter } from "next/navigation";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { isApiMockMode } from "@/lib/api-client";

// ─── Accent palette (sampled from the 2026-05-30 design render) ──────────────────
// Primary accent is green (mirrors --brand-green* in globals.css / ds-tokens, and
// the polished sibling pages library/templates + library/buyers). The design demo
// rendered the top-right "New" action in buyer-blue, but the locked ProcuLink app
// convention — and these task instructions — keep GREEN for the primary CTA.
const GREEN      = "#28C55E"; // --brand-green       (primary CTA fill)
const GREEN_DEEP = "#1DAF50"; // --brand-green-deep  (hover / strong supplier text)
const INK        = "#0B1A2F"; // navy ink — sampled from title + headings
const SUBTLE     = "#56627A"; // subtitle / muted body — sampled from subtitle
const MUTED      = "#8A93A5"; // faint meta (arrow, timestamp) — sampled from table head
const BORDER     = "#E2E6EE"; // card border — sampled from card edge
const CANVAS     = "#F6F7FA"; // page canvas — sampled from empty area

// Stage / exception pill colours — sampled EXACT from the design's Warn / Block pills
// (crop_table.png): amber pill #FAEFD6/#C97A14, red pill #FBE3E3/#C53A3A.
const AMBER      = "#C97A14"; // stage pill text + dot
const AMBER_SOFT = "#FAEFD6"; // stage pill background
const RED        = "#C53A3A"; // exception pill text + dot
const RED_SOFT   = "#FBE3E3"; // exception pill background

// Demo drafts are dev-only. There is no draft-persistence endpoint yet, so real
// users (NEXT_PUBLIC_USE_MOCK=false) see an honest empty state instead of
// fabricated rows that would 404 against the live API.
const DEMO_DRAFTS = [
  { id: "d1", po: "PO-2026-008422", buyer: "Heinrich Industries", supplier: "Acme Components", savedAt: "3m", stage: "Validate", issues: 2 },
  { id: "d2", po: "AR-2026-1110",   buyer: "Atlas Reseller AG",   supplier: "Nordix Distribution", savedAt: "2h",  stage: "Normalize", issues: 0 },
];

const DRAFTS = isApiMockMode ? DEMO_DRAFTS : [];

// Small pill matching the design's severity pills: pill-shaped, ~20px tall, with a
// leading status dot. Used for the workflow stage (amber) and exception count (red).
function StatusPill({ dot, bg, fg, children }: { dot: string; bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold flex-shrink-0 whitespace-nowrap"
      style={{ height: 20, padding: "0 9px", borderRadius: 999, fontSize: 11, background: bg, color: fg }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 999, background: dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}

export default function DraftsPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto" style={{ background: CANVAS }}>
      <div className="flex-1 min-h-0 px-4 pt-6 pb-8 sm:px-7 sm:pt-7">
        {/* Header — title + subtitle on the page surface (no bar / no divider),
            primary "New" action on the right, matching the design reference. */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1
              className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.02em] leading-none"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: INK }}
            >
              Drafts
            </h1>
            <p className="text-[13px] mt-2" style={{ color: SUBTLE }}>
              Orders saved but not yet sent
            </p>
          </div>
          <button
            onClick={() => router.push("/upload")}
            className="inline-flex items-center gap-1.5 rounded-[8px] font-semibold text-white flex-shrink-0"
            style={{ height: 33, padding: "0 14px", fontSize: 13, background: GREEN, border: "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(11,26,47,0.10)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = GREEN_DEEP)}
            onMouseLeave={(e) => (e.currentTarget.style.background = GREEN)}
          >
            <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span>
            New
          </button>
        </div>

        {DRAFTS.length === 0 ? (
          // Large bordered card with a centered empty state, matching the design reference.
          <div
            className="flex items-center justify-center rounded-[12px]"
            style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(11,26,47,0.04)", minHeight: 360 }}
          >
            <div className="flex flex-col items-center text-center" style={{ padding: "48px 24px" }}>
              <div style={{ marginBottom: 20 }}>
                <ProcuLinkMark size={52} />
              </div>
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontWeight: 600,
                  fontSize: 20,
                  letterSpacing: "-0.02em",
                  color: INK,
                }}
              >
                Drafts live here
              </div>
              <div style={{ fontSize: 13, color: SUBTLE, maxWidth: 420, lineHeight: 1.65, marginTop: 10 }}>
                Save an order while you are still resolving it — mapping SKUs, clearing
                exceptions, picking a supplier — and it waits here until you are ready to
                send it.
              </div>
              <button
                onClick={() => router.push("/inbox")}
                className="inline-flex items-center gap-2 rounded-[8px] font-semibold"
                style={{ marginTop: 22, height: 38, padding: "0 16px", fontSize: 13, background: "#FFFFFF", color: INK, border: `1px solid ${BORDER}`, cursor: "pointer", transition: "background 150ms,border-color 150ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = CANVAS; e.currentTarget.style.borderColor = "#C6CDDA"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = BORDER; }}
              >
                {/* Small file/document glyph — mirrors the design's outline button icon */}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path d="M3.5 1.5h5L13 6v8a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8.5 1.5V6H13" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                Go to Inbox
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {DRAFTS.map((d) => (
              <div
                key={d.id}
                onClick={() => router.push(`/inbox/${d.id}`)}
                className="flex flex-col gap-3 rounded-[10px] px-4 py-3.5 cursor-pointer sm:flex-row sm:items-center sm:gap-4"
                style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(11,26,47,0.04)", borderLeft: `3px solid ${AMBER}`, transition: "box-shadow 120ms,border-color 120ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(11,26,47,0.08)"; e.currentTarget.style.borderColor = "#D4DAE5"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(11,26,47,0.04)"; e.currentTarget.style.borderColor = BORDER; }}
              >
                {/* Identity: PO number + buyer → supplier. On mobile this is the top
                    block; on desktop it flexes to fill, pushing meta to the right. */}
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[12px] font-semibold" style={{ color: INK }}>{d.po}</p>
                  <p className="text-[12px] mt-1 flex items-center gap-1.5 min-w-0" style={{ color: SUBTLE }}>
                    <span className="truncate" style={{ color: INK, fontWeight: 500 }}>{d.buyer}</span>
                    <span style={{ color: MUTED, flexShrink: 0 }}>→</span>
                    <span className="truncate" style={{ color: GREEN_DEEP, fontWeight: 500 }}>{d.supplier}</span>
                  </p>
                </div>
                {/* Meta cluster: stage + exceptions + saved-at. Grouped together so the
                    pills sit next to the timestamp instead of stranding across the row.
                    On mobile it wraps under the identity block, left-aligned. */}
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <StatusPill dot={AMBER} bg={AMBER_SOFT} fg={AMBER}>{d.stage}</StatusPill>
                  {d.issues > 0 && (
                    <StatusPill dot={RED} bg={RED_SOFT} fg={RED}>
                      {d.issues} {d.issues === 1 ? "exception" : "exceptions"}
                    </StatusPill>
                  )}
                  <span style={{ fontSize: 11, color: MUTED, minWidth: 56, textAlign: "right" }}>{d.savedAt} ago</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
