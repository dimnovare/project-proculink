"use client";

// CommandPalette — cmd+K filter over navigation actions and the Advanced
// view's mapper commands (that IS the whole index — keep the placeholder copy
// in sync). The order, supplier, buyer and sample-order groups went with the
// order product on 2026-11-13. Wired into BridgeTopbar.

import { useEffect, useState, useRef, useCallback } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useRouter } from "next/navigation";
import { buildMapperCommands, dispatchMapper } from "./mapper/mapperCommands";

// ─── Index ────────────────────────────────────────────────────────────────────

type CmdItem = {
  id: string;
  label: string;
  sub?: string;
  group: string;
  icon: string;
  href?: string;
  action?: () => void;
  color?: string;
};

// Each row paints item.color TWICE, at two different floors: as the chip's
// 9.4%-alpha FILL (non-text, 3:1) and as the GLYPH inside it. The glyph (↑ ▤ ⚙)
// carries meaning, so it is text and owes 4.5:1 — and #2E8E3A on its own tint is
// only 3.7024:1 (#EBF4EC), or 3.3789:1 over the #F0F4FB active row (#DEEAE9).
// So the glyph alone steps to green-deep: 5.7056:1 / 5.2071:1. item.color itself
// is deliberately NOT changed — the fill keeps it, so the chip looks identical.
//
// ALL THREE FAMILIES ARE MAPPED, not just green. Green was the one the sweep was
// scoped to, but the other two rows fail the same way for the same reason, and a
// map covering one of three would read as "checked" while two thirds of the
// palette still failed. Both replacements are existing tokens; neither is new.
//   #B36D14 (needs-review; and the parked bucket — see below. It carried
//     delivery-failed when this was written; that status is danger now) →
//     3.6662:1 resting, 3.3358:1 active
//     → --amber-text #8A5310: 5.6384:1 / 5.1302:1
//   #1E66C9 (buyers) → 4.8592:1 resting but 4.4231:1 over the active row — the
//     kind of near-miss that only shows up if you measure the state the user is
//     actually looking at when they arrow onto the row
//     → --brand-blue-deep #0F4FA8: 6.8270:1 / 6.2143:1
const GLYPH_TEXT_COLOR: Record<string, string> = {
  "#2E8E3A": "#1E6D29",
  "#B36D14": "#8A5310",
  "#1E66C9": "#0F4FA8",
};

function glyphColor(fill: string): string {
  return GLYPH_TEXT_COLOR[fill] ?? fill;
}

function buildIndex(router: ReturnType<typeof useRouter>): CmdItem[] {
  return [
    // ── Actions ────────────────────────────────────────
    { id: "a1",  group: "Actions", icon: "↑", label: "Upload document",      sub: "Open upload workbench",  action: () => router.push("/upload"),           color: "#0F4FA8" },
    { id: "a9",  group: "Actions", icon: "▤", label: "Deliveries",           sub: "Every delivery attempt — the delivery log", action: () => router.push("/operations/log"),   color: "#0F4FA8" },
    { id: "a7",  group: "Actions", icon: "⚙", label: "Settings",             sub: "Workspace settings",     action: () => router.push("/settings"),         color: "#0F4FA8" },
    { id: "a12", group: "Actions", icon: "?", label: "Open help",            sub: "Help docs",              action: () => router.push("/help"),             color: "#0F4FA8" },
    // ── Mapper power commands (a13..a16) ────────────────────
    // These dispatch onto the window "plk:mapper" bus; the mounted MapperWorkbench
    // (a flow output's Advanced view) listens and acts on its focused field.
    // They show always (progressive disclosure — discoverable for anyone who needs them);
    // outside the mapper the dispatch is a harmless no-op (no listener attached).
    ...buildMapperCommands(dispatchMapper).map((c) => ({
      id: c.id,
      group: c.group,
      icon: c.icon,
      label: c.label,
      sub: c.sub,
      action: c.run,
      color: c.color,
    })),
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ]               = useState("");
  const [activeIndex, setActive] = useState(0);
  const router                   = useRouter();
  const listRef                  = useRef<HTMLDivElement>(null);
  const activeRef                = useRef<HTMLButtonElement>(null);
  const paletteRef               = useRef<HTMLDivElement>(null);

  const normalizedQ = q.trim();
  const items = buildIndex(router);

  // Build filtered groups + flat list for keyboard nav
  const groups: Record<string, CmdItem[]> = {};
  const sq = normalizedQ.toLowerCase();
  for (const item of items) {
    if (sq && !item.label.toLowerCase().includes(sq) && !(item.sub ?? "").toLowerCase().includes(sq)) continue;
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }
  const flatItems = Object.values(groups).flat();
  const hasResults = flatItems.length > 0;

  function run(item: CmdItem) {
    onClose();
    setQ("");
    if (item.action) { item.action(); return; }
    if (item.href)   router.push(item.href);
  }

  // Reset active index when query changes
  useEffect(() => { setActive(0); }, [q]);

  // Scroll active item into view when index changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatItems[activeIndex]) {
      e.preventDefault();
      run(flatItems[activeIndex]);
    } else if (e.key === "Escape") {
      onClose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatItems, activeIndex, onClose]);

  // Focus trap + Escape + focus restore + scroll lock — one shared contract
  // (src/hooks/useDialogA11y.ts) instead of the local copy this file used to
  // carry. The palette mounts only while open, so `open` is constant true.
  // `autoFocus: false` — the search input already autoFocuses itself.
  useDialogA11y({ open: true, onClose, panelRef: paletteRef, autoFocus: false });

  // Track flat index across groups for active highlighting
  let flatIdx = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,26,47,0.55)",
          backdropFilter: "blur(4px)",
          zIndex: 9998,
        }}
        onClick={onClose}
      />

      {/* Palette */}
      <div
        ref={paletteRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          position: "fixed",
          top: "20vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          maxWidth: "calc(100vw - 32px)",
          background: "#FFFFFF",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(11,26,47,0.22), 0 4px 12px rgba(11,26,47,0.12)",
          border: "1px solid #E5E8EE",
          overflow: "hidden",
          zIndex: 9999,
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid #E5E8EE",
          }}
        >
          <span style={{ fontSize: 16, color: "var(--ink-faint)" }}>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search actions…"
            role="combobox"
            aria-label="Search actions"
            aria-autocomplete="list"
            aria-expanded={hasResults}
            aria-controls="cmd-listbox"
            aria-activedescendant={hasResults ? `cmd-option-${activeIndex}` : undefined}
            style={{
              flex: 1,
              border: "none",
              fontSize: 14,
              color: "#0B1A2F",
              background: "transparent",
            }}
          />
          <kbd
            style={{
              fontSize: 10.5,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--ink-faint)",
              background: "#F6F7FA",
              border: "1px solid #E5E8EE",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="cmd-listbox"
          role={hasResults ? "listbox" : undefined}
          aria-label={hasResults ? "Results" : undefined}
          style={{ maxHeight: 420, overflowY: "auto" }}
        >
          {!hasResults ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--ink-faint)",
                fontSize: 13,
              }}
            >
              {`No results for “${normalizedQ}”`}
            </div>
          ) : (
            Object.entries(groups).map(([group, groupItems]) => (
              <div key={group} role="group" aria-label={group}>
                <div
                  aria-hidden="true"
                  style={{
                    padding: "8px 16px 4px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                  }}
                >
                  {group}
                </div>
                {groupItems.map((item) => {
                  const isActive = flatIdx === activeIndex;
                  const currentIdx = flatIdx++;
                  return (
                  <button
                    key={item.id}
                    id={`cmd-option-${currentIdx}`}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    ref={isActive ? activeRef : undefined}
                    onClick={() => run(item)}
                    onMouseEnter={() => setActive(currentIdx)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px",
                      border: "none",
                      background: isActive ? "#F0F4FB" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      borderLeft: isActive ? "2px solid #2E8E3A" : "2px solid transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Icon */}
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: `${item.color ?? "#2E8E3A"}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        // Text floor, not the fill's — see GLYPH_TEXT_COLOR.
                        color: glyphColor(item.color ?? "#2E8E3A"),
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </span>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#0B1A2F",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.label}
                      </div>
                      {item.sub && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--ink-faint)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.sub}
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <span style={{ fontSize: 11, color: "#CBD0DA" }}>↵</span>
                  </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 16px",
            borderTop: "1px solid #E5E8EE",
            background: "#F6F7FA",
          }}
        >
          {[["↵", "open"], ["↑↓", "navigate"], ["esc", "close"]].map(
            ([key, label]) => (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <kbd
                  style={{
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "#5E6779",
                    background: "#FFFFFF",
                    border: "1px solid #E5E8EE",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</span>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
