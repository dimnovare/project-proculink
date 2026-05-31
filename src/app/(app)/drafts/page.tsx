"use client";
import { useRouter } from "next/navigation";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { isApiMockMode } from "@/lib/api-client";

// ─── Accent palette ─────────────────────────────────────────────────────────────
// Primary accent is green (mirrors --brand-green* in globals.css / ds-tokens).
// Kept as local consts so every inline style swaps consistently with the rest
// of the restyled app (see InboxView for the same constants).
const GREEN      = "#28C55E"; // --brand-green       (primary CTA)
const GREEN_DEEP = "#1DAF50"; // --brand-green-deep  (hover / strong supplier text)
const INK        = "#0B1A2F"; // navy ink — PO numbers, buyer side, headings
const AMBER      = "#C97A14"; // stage / draft accent
const AMBER_SOFT = "#FAEFD6"; // stage-pill background

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
    <div className="flex flex-col h-full min-h-0 overflow-auto" style={{ background: "#F6F7FA" }}>
      <div className="flex-1 min-h-0 px-4 pt-7 pb-8 sm:px-7">
        {/* Header — title + subtitle on the page surface (no bar / no divider),
            primary "New" action on the right, matching the design reference. */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1
              className="text-[28px] font-semibold tracking-[-0.02em] leading-none"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: INK }}
            >
              Drafts
            </h1>
            <p className="text-[13px] mt-2" style={{ color: "#56627A" }}>
              Orders saved but not yet sent
            </p>
          </div>
          <button
            onClick={() => router.push("/upload")}
            className="inline-flex items-center gap-1.5 rounded-[8px] font-semibold text-white flex-shrink-0"
            style={{ height: 38, padding: "0 16px", fontSize: 13, background: GREEN, border: "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(11,26,47,0.10)" }}
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
            style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", minHeight: 360 }}
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
              <div style={{ fontSize: 13, color: "#56627A", maxWidth: 420, lineHeight: 1.65, marginTop: 10 }}>
                Save an order while you are still resolving it — mapping SKUs, clearing
                exceptions, picking a supplier — and it waits here until you are ready to
                send it.
              </div>
              <button
                onClick={() => router.push("/inbox")}
                className="inline-flex items-center gap-2 rounded-[8px] font-semibold"
                style={{ marginTop: 22, height: 38, padding: "0 16px", fontSize: 13, background: "#FFFFFF", color: INK, border: "1px solid #E2E6EE", cursor: "pointer", transition: "background 150ms,border-color 150ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F7FA"; e.currentTarget.style.borderColor = "#C6CDDA"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#E2E6EE"; }}
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
                className="flex items-center gap-4 rounded-[10px] px-4 py-3.5 cursor-pointer"
                style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)", borderLeft: `3px solid ${AMBER}`, transition: "box-shadow 120ms,border-color 120ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(11,26,47,0.08)"; e.currentTarget.style.borderColor = "#D4DAE5"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(11,26,47,0.04)"; e.currentTarget.style.borderColor = "#E2E6EE"; }}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[12px] font-semibold" style={{ color: INK }}>{d.po}</p>
                  <p className="text-[12px] mt-1 flex items-center gap-1.5 min-w-0" style={{ color: "#56627A" }}>
                    <span className="truncate" style={{ color: INK, fontWeight: 500 }}>{d.buyer}</span>
                    <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
                    <span className="truncate" style={{ color: GREEN_DEEP, fontWeight: 500 }}>{d.supplier}</span>
                  </p>
                </div>
                <span
                  className="font-semibold flex-shrink-0"
                  style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, fontSize: 11, background: AMBER_SOFT, color: AMBER }}
                >
                  {d.stage}
                </span>
                {d.issues > 0 && (
                  <span
                    className="font-semibold flex-shrink-0"
                    style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, fontSize: 11, background: "#FBE3E3", color: "#C53A3A" }}
                  >
                    {d.issues} {d.issues === 1 ? "exception" : "exceptions"}
                  </span>
                )}
                <span className="flex-shrink-0" style={{ fontSize: 11, color: "#8A93A5", minWidth: 56, textAlign: "right" }}>{d.savedAt} ago</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
