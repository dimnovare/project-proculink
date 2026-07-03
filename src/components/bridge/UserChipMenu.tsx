"use client";

// UserChipMenu — the sidebar footer user chip + profile dropdown (Claude Design
// v2 shell, screenshots 09_21_19 chip / 09_23_33 open menu).
//
// The chip shows the REAL signed-in user (name + active-org role from Clerk).
// Clicking opens a white menu anchored above the chip: a header with the user's
// name + primary email, then Profile (Clerk's manage-account modal via
// openUserProfile()), Settings (/settings) and a red Sign out
// (signOut({ redirectUrl: "/" })). The design's "Preferences" item is
// deliberately NOT rendered — there is no preferences page, and we never ship
// dead menu items (offer ⇔ works).
//
// The topbar's Clerk <UserButton /> stays — the design shows the avatar
// top-right AND the footer chip; this chip is the richer menu.

import Link from "next/link";
import { useRef, useState } from "react";
import { useClerk, useOrganization, useUser } from "@clerk/nextjs";
import { MoreHorizontal } from "lucide-react";
import { useMenuDismiss } from "./OrgSwitcher";

/** "org:admin" → "Administrator"; "org:member" → "Member"; else title-case. */
export function membershipRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  const raw = role.replace(/^org:/, "");
  if (raw === "admin") return "Administrator";
  if (raw === "member") return "Member";
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameInitials(name: string): string {
  return (name.match(/\b\p{L}/gu) ?? []).slice(0, 2).join("").toUpperCase() || "?";
}

const MENU_SURFACE: React.CSSProperties = {
  position: "fixed",
  zIndex: 80, // above the mobile nav drawer (z-50)
  background: "#FFFFFF",
  border: "1px solid #E5E8EE",
  borderRadius: 10,
  boxShadow: "0 12px 32px rgba(11,26,47,0.18), 0 2px 6px rgba(11,26,47,0.08)",
  overflow: "hidden",
};

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "#24324A",
  background: "#FFFFFF",
  border: "none",
  cursor: "pointer",
  textDecoration: "none",
};

interface UserChipMenuProps {
  collapsed: boolean;
  /** Mobile drawer: close the drawer after an in-app navigation. */
  onNavigate?: () => void;
}

export function UserChipMenu({ collapsed, onNavigate }: UserChipMenuProps) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const { user } = useUser();
  const { membership } = useOrganization();
  const clerk = useClerk();

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, () => setOpen(false), btnRef, menuRef);

  const name =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const subline = membershipRoleLabel(membership?.role) ?? email;
  const initials = nameInitials(name);

  // Clerk not configured (mock/QA shells) or no session yet: render the chip
  // shape without a menu — none of the menu actions could work (offer ⇔ works).
  if (!clerkConfigured || !user) {
    return (
      <div
        className={`flex items-center flex-shrink-0 ${collapsed ? "justify-center" : "gap-2.5"}`}
        style={{ borderTop: "1px solid #1F3252", padding: collapsed ? "10px 0" : "10px 14px" }}
        title={clerkConfigured ? undefined : "Clerk is not configured"}
      >
        <AvatarCircle initials={clerkConfigured ? "…" : "MK"} />
        {!collapsed && (
          <div className="min-w-0 flex-1" style={{ lineHeight: 1.25 }}>
            <div className="truncate text-[12.5px] font-semibold text-white">
              {clerkConfigured ? "Signing in…" : "Demo user"}
            </div>
            <div className="truncate text-[10.5px]" style={{ color: "#7C8DA6" }}>
              {clerkConfigured ? "" : "Local session"}
            </div>
          </div>
        )}
      </div>
    );
  }

  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        setAnchor({
          bottom: window.innerHeight - r.top + 8,
          left: r.left,
          width: Math.max(r.width, 216),
        });
      }
    }
    setOpen((v) => !v);
  };

  const closeMenu = () => setOpen(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}. Open account menu`}
        title={collapsed ? name : undefined}
        className={`flex w-full items-center flex-shrink-0 ${collapsed ? "justify-center" : "gap-2.5"}`}
        style={{
          border: "none",
          borderTop: "1px solid #1F3252",
          padding: collapsed ? "10px 0" : "10px 14px",
          background: open ? "rgba(255,255,255,0.05)" : "transparent",
          borderRadius: 0,
          cursor: "pointer",
          transition: "background 140ms",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <AvatarCircle initials={initials} />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 text-left" style={{ lineHeight: 1.25 }}>
              <div className="truncate text-[12.5px] font-semibold text-white">{name}</div>
              <div className="truncate text-[10.5px]" style={{ color: "#7C8DA6" }}>{subline}</div>
            </div>
            <MoreHorizontal size={16} strokeWidth={2} style={{ color: "#7C8DA6", flexShrink: 0 }} aria-hidden />
          </>
        )}
      </button>

      {open && anchor && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          style={{ ...MENU_SURFACE, bottom: anchor.bottom, left: anchor.left, width: anchor.width }}
        >
          {/* Identity header — real name + primary email from Clerk. */}
          <div className="flex items-center gap-2.5" style={{ padding: "11px 12px", borderBottom: "1px solid #E5E8EE" }}>
            <span
              className="flex items-center justify-center rounded-full font-[700] flex-shrink-0"
              style={{ width: 30, height: 30, fontSize: 11, background: "#14253D", color: "#FFFFFF" }}
              aria-hidden
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1" style={{ lineHeight: 1.3 }}>
              <span className="block truncate" style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F" }}>{name}</span>
              {email && <span className="block truncate" style={{ fontSize: 11, color: "#98A0AE" }}>{email}</span>}
            </span>
          </div>

          <div style={{ padding: "4px 0" }}>
            {/* Profile — Clerk's manage-account modal (name, avatar, security). */}
            <button
              type="button"
              role="menuitem"
              style={ITEM_STYLE}
              onClick={() => {
                closeMenu();
                clerk.openUserProfile();
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
            >
              Profile
            </button>

            {/* "Preferences" from the design mock is intentionally skipped —
                no preferences page exists (offer ⇔ works). */}

            <Link
              href="/settings"
              role="menuitem"
              style={ITEM_STYLE}
              onClick={() => {
                closeMenu();
                onNavigate?.();
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
            >
              Settings
            </Link>
          </div>

          <div style={{ height: 1, background: "#E5E8EE" }} aria-hidden />

          <div style={{ padding: "4px 0" }}>
            <button
              type="button"
              role="menuitem"
              style={{ ...ITEM_STYLE, color: "#B43838", fontWeight: 600 }}
              onClick={() => {
                closeMenu();
                void clerk.signOut({ redirectUrl: "/" });
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#FBF1F1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Dark navy initials circle (matches the design's footer avatar). */
function AvatarCircle({ initials }: { initials: string }) {
  return (
    <span
      className="flex items-center justify-center rounded-full font-[700] flex-shrink-0"
      style={{ width: 28, height: 28, fontSize: 10.5, background: "#14253D", border: "1px solid #2A3F5F", color: "#FFFFFF" }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
