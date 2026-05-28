"use client";

import { UserButton } from "@clerk/nextjs";
import { Menu } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";

interface BridgeTopbarProps {
  crumb?: ReactNode;
  onMenuClick?: () => void;
}

function AccountMenu() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div
        className="flex items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          width: 28,
          height: 28,
          background: "#E2F1E2",
          color: "#1E6D29",
        }}
        title="Clerk is not configured"
      >
        D
      </div>
    );
  }

  return (
    <UserButton
      appearance={{
        elements: {
          userButtonAvatarBox: "w-7 h-7",
        },
      }}
    />
  );
}

/** Derive a 1–2-segment breadcrumb from the current pathname. */
function useAutoCrumb(): ReactNode {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean);

  const LABELS: Record<string, string> = {
    bridge:    "Dashboard",
    inbox:     "Inbox",
    upload:    "Upload",
    drafts:    "Drafts",
    orders:    "Orders",
    settings:  "Settings",
    library:   "Library",
    suppliers: "Suppliers",
    buyers:    "Buyers",
    mappings:  "Mappings",
    rules:     "Rules",
    templates: "Output templates",
    operations: "Operations",
    log:       "Delivery log",
    connectors: "Connectors",
    webhooks:  "Webhooks",
  };

  if (seg.length === 0) return null;

  const root = LABELS[seg[0]] ?? seg[0];

  // Two-segment paths like /library/suppliers or /operations/log
  if (seg.length >= 2 && LABELS[seg[1]]) {
    return (
      <>
        <span style={{ color: "#7C8DA6" }}>{root}</span>
        <span style={{ color: "#3A547A", margin: "0 3px" }}>/</span>
        <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{LABELS[seg[1]]}</span>
      </>
    );
  }

  // Detail pages like /inbox/[id] or /library/suppliers/[id] or /orders/[id]
  if (seg.length >= 2 && !LABELS[seg[1]]) {
    const slug = seg[1].length > 16 ? seg[1].slice(0, 15) + "…" : seg[1];
    return (
      <>
        <span style={{ color: "#7C8DA6" }}>{root}</span>
        <span style={{ color: "#3A547A", margin: "0 3px" }}>/</span>
        <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{slug}</span>
      </>
    );
  }

  return <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{root}</span>;
}

export function BridgeTopbar({ crumb, onMenuClick }: BridgeTopbarProps) {
  const router = useRouter();
  const autoCrumb = useAutoCrumb();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global cmd+K listener
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <header
      className="flex-shrink-0 relative"
      style={{ height: 56, background: "#0B1A2F" }}
    >
      {/* Content row */}
      <div className="flex h-full items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-[7px] md:hidden"
          style={{
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#C5D2E4",
          }}
          aria-label="Open navigation"
        >
          <Menu size={18} strokeWidth={2.2} />
        </button>

        {/* Breadcrumbs */}
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"
          style={{ color: "#C5D2E4" }}
        >
          {crumb ?? autoCrumb}
        </div>

        {/* cmd-K search trigger */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          onClick={() => setPaletteOpen(true)}
          className="hidden items-center gap-2 rounded-[6px] px-3 transition-colors sm:flex"
          style={{
            height: 30,
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#7C8DA6",
            fontSize: 12.5,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#2A4A70";
            (e.currentTarget as HTMLElement).style.color = "#C5D2E4";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#1C2F49";
            (e.currentTarget as HTMLElement).style.color = "#7C8DA6";
          }}
        >
          <span>Search orders, suppliers, SKUs…</span>
          <kbd
            className="flex items-center gap-0.5 rounded text-[10px] font-medium px-1"
            style={{ background: "#0B1A2F", color: "#7C8DA6" }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <button
          type="button"
          aria-label="Notifications"
          className="flex items-center justify-center rounded-[6px] relative"
          style={{
            width: 30,
            height: 30,
            color: "#7C8DA6",
            fontSize: 16,
          }}
          title="Notifications"
        >
          <span>🔔</span>
          {/* Unread dot */}
          <span
            className="absolute rounded-full"
            style={{
              width: 6,
              height: 6,
              background: "#C53A3A",
              top: 6,
              right: 6,
            }}
          />
        </button>

        {/* Help */}
        <button
          type="button"
          aria-label="Help"
          className="flex items-center justify-center rounded-full text-[11px] font-bold"
          style={{
            width: 24,
            height: 24,
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#7C8DA6",
          }}
          title="Help"
        >
          ?
        </button>

        {/* Avatar / Clerk */}
        <div className="flex-shrink-0">
          <AccountMenu />
        </div>
      </div>

      {/* Command Palette */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Link-spine — 2px gradient line at bottom edge */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: 2,
          background:
            "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
        }}
        aria-hidden
      />
    </header>
  );
}
