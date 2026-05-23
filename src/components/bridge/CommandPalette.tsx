"use client";

// CommandPalette — cmd+K fuzzy search across orders, suppliers, SKUs, actions.
// Built on cmdk (already installed). Wired into BridgeTopbar.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Mock index ───────────────────────────────────────────────────────────────

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

function buildIndex(router: ReturnType<typeof useRouter>): CmdItem[] {
  return [
    // ── Orders ─────────────────────────────────────────
    { id: "o1",  group: "Orders", icon: "↗", label: "PO-2026-008412",    sub: "Heinrich Industries → Acme · Needs review",  href: "/inbox/008412",  color: "#C97A14" },
    { id: "o2",  group: "Orders", icon: "↗", label: "PO-NRD-9981",       sub: "Nordmark → BoltWorks · New",                 href: "/inbox/nrd9981", color: "#1E66C9" },
    { id: "o3",  group: "Orders", icon: "↗", label: "SH-PO-44120",       sub: "Steelhouse → VanDerBerg · Extracting",       href: "/inbox/sh44120", color: "#6F4FCE" },
    { id: "o4",  group: "Orders", icon: "↗", label: "850-99201",         sub: "Centralis Pharma → MedicaSupply · Failed",   href: "/inbox/850201",  color: "#C53A3A" },
    { id: "o5",  group: "Orders", icon: "↗", label: "WMT-2026-0341",     sub: "Westmark → Acme · Ready",                   href: "/inbox/wmt341",  color: "#2E8E3A" },
    { id: "o6",  group: "Orders", icon: "↗", label: "AR-2026-1107",      sub: "Atlas Reseller → Nordix · Needs review",     href: "/inbox/ar1107",  color: "#C97A14" },
    // ── Suppliers ──────────────────────────────────────
    { id: "s1",  group: "Suppliers", icon: "⊞", label: "Acme Components",    sub: "ACM · Health 97%", href: "/library/suppliers/s1", color: "#2E8E3A" },
    { id: "s2",  group: "Suppliers", icon: "⊞", label: "BoltWorks BV",       sub: "BWK · Health 91%", href: "/library/suppliers/s2", color: "#2E8E3A" },
    { id: "s3",  group: "Suppliers", icon: "⊞", label: "VanDerBerg Metaal",  sub: "VDB · Health 88%", href: "/library/suppliers/s3", color: "#C97A14" },
    { id: "s4",  group: "Suppliers", icon: "⊞", label: "Nordix Distribution",sub: "NDX · Health 73%", href: "/library/suppliers/s4", color: "#C97A14" },
    { id: "s5",  group: "Suppliers", icon: "⊞", label: "MedicaSupply OY",    sub: "MDS · Health 96%", href: "/library/suppliers/s5", color: "#2E8E3A" },
    // ── Buyers ─────────────────────────────────────────
    { id: "b1",  group: "Buyers", icon: "◎", label: "Heinrich Industries",   sub: "HEI · 412/wk", href: "/library/buyers", color: "#1E66C9" },
    { id: "b2",  group: "Buyers", icon: "◎", label: "Nordmark Logistics",    sub: "NRD · 287/wk", href: "/library/buyers", color: "#1E66C9" },
    { id: "b3",  group: "Buyers", icon: "◎", label: "Centralis Pharma",      sub: "CPH · 94/wk",  href: "/library/buyers", color: "#1E66C9" },
    // ── SKUs ───────────────────────────────────────────
    { id: "k1",  group: "SKUs", icon: "⇄", label: "ACM-BOLT-M8",         sub: "→ BWK-M8-HEX-ZN · 98% confidence", href: "/library/mappings", color: "#6F4FCE" },
    { id: "k2",  group: "SKUs", icon: "⇄", label: "MDS-SYRG-10ML",       sub: "→ MDS-SY-10-STERILE · 96%",        href: "/library/mappings", color: "#6F4FCE" },
    { id: "k3",  group: "SKUs", icon: "⇄", label: "ACM-SCREW-M4x10",     sub: "→ BWK-CS-M4-10-ZN · 99%",          href: "/library/mappings", color: "#6F4FCE" },
    // ── Actions ────────────────────────────────────────
    { id: "a1",  group: "Actions", icon: "↑", label: "Upload document",      sub: "Open upload workbench",  action: () => router.push("/upload"),           color: "#0F4FA8" },
    { id: "a2",  group: "Actions", icon: "⊞", label: "View all crossings",   sub: "Go to inbox",            action: () => router.push("/inbox"),            color: "#0F4FA8" },
    { id: "a3",  group: "Actions", icon: "⇄", label: "Manage mappings",      sub: "Open mapping editor",    action: () => router.push("/library/mappings"), color: "#0F4FA8" },
    { id: "a4",  group: "Actions", icon: "✓", label: "Validation rules",     sub: "Open rule library",      action: () => router.push("/library/rules"),    color: "#0F4FA8" },
    { id: "a5",  group: "Actions", icon: "⚙", label: "Settings",             sub: "Workspace settings",     action: () => router.push("/settings"),         color: "#0F4FA8" },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const router    = useRouter();

  // esc closes
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onClose]);

  const items = buildIndex(router);

  function run(item: CmdItem) {
    onClose();
    setQ("");
    if (item.action) { item.action(); return; }
    if (item.href)   router.push(item.href);
  }

  // Group items
  const groups: Record<string, CmdItem[]> = {};
  for (const item of items) {
    const label = item.label.toLowerCase();
    const sq    = q.toLowerCase();
    if (sq && !label.includes(sq) && !(item.sub ?? "").toLowerCase().includes(sq)) continue;
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }
  const hasResults = Object.values(groups).some((g) => g.length > 0);

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
          border: "1px solid #E2E6EE",
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
            borderBottom: "1px solid #E2E6EE",
          }}
        >
          <span style={{ fontSize: 16, color: "#8A93A5" }}>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orders, suppliers, SKUs, actions…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "#0B1A2F",
              background: "transparent",
            }}
          />
          <kbd
            style={{
              fontSize: 10.5,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#8A93A5",
              background: "#F6F7FA",
              border: "1px solid #E2E6EE",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {!hasResults ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "#8A93A5",
                fontSize: 13,
              }}
            >
              No results for &ldquo;{q}&rdquo;
            </div>
          ) : (
            Object.entries(groups).map(([group, groupItems]) => (
              <div key={group}>
                <div
                  style={{
                    padding: "8px 16px 4px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "#8A93A5",
                  }}
                >
                  {group}
                </div>
                {groupItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => run(item)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "transparent")
                    }
                  >
                    {/* Icon */}
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: `${item.color ?? "#1E66C9"}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        color: item.color ?? "#1E66C9",
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
                            color: "#8A93A5",
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
                    <span style={{ fontSize: 11, color: "#C6CDDA" }}>↵</span>
                  </button>
                ))}
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
            borderTop: "1px solid #E2E6EE",
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
                    color: "#56627A",
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: 11, color: "#8A93A5" }}>{label}</span>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
