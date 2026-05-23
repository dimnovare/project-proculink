"use client";

import { UserButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";

interface BridgeTopbarProps {
  crumb?: ReactNode;
}

export function BridgeTopbar({ crumb }: BridgeTopbarProps) {
  const router = useRouter();
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
      style={{ height: 52, background: "#0B1A2F" }}
    >
      {/* Content row */}
      <div className="flex h-full items-center px-5 gap-4">
        {/* Breadcrumbs */}
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0 text-[13px]"
          style={{ color: "#C5D2E4" }}
        >
          {crumb ?? (
            <span style={{ color: "#7C8DA6" }}>ProcuLink</span>
          )}
        </div>

        {/* cmd-K search trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 rounded-[6px] px-3 transition-colors"
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
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: "w-7 h-7",
              },
            }}
          />
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
