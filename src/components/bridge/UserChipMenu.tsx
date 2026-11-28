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
import { Check, ChevronDown, Globe, MoreHorizontal } from "lucide-react";
import { chooseLocale, ENDONYMS, LOCALES } from "@/i18n/locales";
import { useCopy } from "@/i18n/useCopy";
import { useConfirm } from "@/components/ui/confirm";
import { clearHeldUploads, heldCount } from "@/lib/pwa/heldUploads";
import { turnOffAlerts } from "@/lib/pwa/push";
import { useMenuDismiss } from "@/hooks/useMenuDismiss";
import { forgetWorkspace, useRememberedInitials } from "@/hooks/useWorkspaceName";

/** "org:admin" → "Administrator"; "org:member" → "Member"; else title-case. */
export function membershipRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  const raw = role.replace(/^org:/, "");
  if (raw === "admin") return "Administrator";
  if (raw === "member") return "Member";
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function nameInitials(name: string): string {
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

/** A Language row: ITEM_STYLE's look in classes, 44px tall on phones. */
const LANG_ROW =
  "flex w-full items-center gap-2 bg-surface px-3 py-2 text-left text-[13px] font-medium text-ink hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue max-md:min-h-11";

interface UserChipMenuProps {
  collapsed: boolean;
  /** Mobile drawer: close the drawer after an in-app navigation. */
  onNavigate?: () => void;
  /**
   * Where the dropdown opens relative to the trigger. The sidebar footer chip
   * opens "up" (default — the chip sits at the bottom of the rail). The top
   * navbar chip opens "down" (the chip sits at the top of the viewport, so an
   * upward menu would clip off-screen).
   */
  placement?: "up" | "down";
  /** On a light page (the Settings header on phones): larger initials, and hover, open and focus from the light tokens. */
  onLight?: boolean;
}

export function UserChipMenu({ collapsed, onNavigate, placement = "up", onLight }: UserChipMenuProps) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const { user } = useUser();
  const { membership } = useOrganization();
  const clerk = useClerk();
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  // "up" placement anchors by the menu's bottom edge (grows upward from the
  // chip); "down" placement anchors by its top edge (grows downward). Right-
  // aligned in both cases so a compact chip near the viewport edge stays on-screen.
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; right: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, () => setOpen(false), btnRef, menuRef);
  const { locale, c } = useCopy("app");
  const [langOpen, setLangOpen] = useState(false);

  const name =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const subline = membershipRoleLabel(membership?.role) ?? email;
  const initials = nameInitials(name);
  const keptInitials = useRememberedInitials(user ? initials : null);

  // Clerk not configured (mock/QA shells) or no session yet: render the chip
  // shape without a menu — none of the menu actions could work (offer ⇔ works).
  if (!clerkConfigured || !user) {
    return (
      <div
        className={`flex items-center flex-shrink-0 ${collapsed ? "justify-center" : "gap-2.5"}`}
        style={placement === "down" ? undefined : { borderTop: "1px solid #1F3252", padding: collapsed ? "10px 0" : "10px 14px" }}
        title={clerkConfigured ? undefined : "Clerk is not configured"}
      >
        <AvatarCircle initials={clerkConfigured ? (keptInitials ?? "…") : "MK"} onLight={onLight} />
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
        const width = Math.max(r.width, 216);
        // Right-align the menu to the trigger's right edge (keeps a compact
        // top-right chip's menu inside the viewport). Clamp so it never runs
        // off the left edge on a very narrow trigger position.
        const right = Math.max(8, window.innerWidth - r.right);
        setAnchor(
          placement === "down"
            ? { top: r.bottom + 8, right, width }
            : { bottom: window.innerHeight - r.top + 8, right, width },
        );
      }
    }
    setOpen((v) => !v);
  };

  const closeMenu = () => {
    setOpen(false);
    setLangOpen(false);
  };

  // Files added while offline, and files shared to this phone, must not stay on a device nobody is signed in to: ask, then remove them.
  // Neither step can hold the sign-out up for more than about two seconds (heldUploads.ts).
  const signOut = async () => {
    closeMenu();
    const n = await heldCount(user.id);
    if (n > 0) {
      const ok = await confirm({
        title: "Sign out?",
        description: n === 1
          ? "1 file on this device hasn't gone up yet. Signing out removes it from this device."
          : `${n} files on this device haven't gone up yet. Signing out removes them from this device.`,
        confirmLabel: "Sign out",
        danger: true,
      });
      if (!ok) return;
    }
    await turnOffAlerts();
    await clearHeldUploads();
    forgetWorkspace();
    void clerk.signOut({ redirectUrl: "/" });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={c("accountLabel", `Account: ${name}. Open account menu`, { name })}
        title={collapsed ? name : undefined}
        className={`flex w-full items-center flex-shrink-0 ${collapsed ? "justify-center" : "gap-2.5"}${onLight
          ? " rounded-card-sm p-1 hover:bg-surface-2 aria-expanded:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
        style={{
          border: "none",
          borderTop: placement === "down" ? undefined : "1px solid #1F3252",
          padding: onLight ? undefined : placement === "down" ? 0 : collapsed ? "10px 0" : "10px 14px",
          background: onLight ? undefined : open ? "rgba(255,255,255,0.05)" : "transparent",
          borderRadius: onLight ? undefined : 0,
          cursor: "pointer",
          transition: "background 140ms",
        }}
        onMouseEnter={onLight ? undefined : (e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={onLight ? undefined : (e) => { if (!open) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <AvatarCircle initials={initials} onLight={onLight} />
        {/* On a light page (Settings on a phone) the chip stands alone, so it names itself. */}
        {onLight && <span className="pl-2 pr-1 text-[13px] font-semibold text-ink">{c("account", "Account")}</span>}
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
          aria-label={c("account", "Account")}
          style={{ ...MENU_SURFACE, top: anchor.top, bottom: anchor.bottom, right: anchor.right, width: anchor.width }}
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
              {email && <span className="block truncate" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{email}</span>}
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
              {c("profile", "Profile")}
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
              {c("settings", "Settings")}
            </Link>

            {/* Language: the current one; pressing it shows the five as rows. 44px on phones. */}
            <button
              type="button"
              role="menuitem"
              aria-expanded={langOpen}
              className={LANG_ROW}
              onClick={() => setLangOpen((v) => !v)}
            >
              <Globe size={14} strokeWidth={1.9} aria-hidden />
              <span className="flex-1">{c("language", "Language")}</span>
              <span className="text-ink-muted">{ENDONYMS[locale]}</span>
              <ChevronDown size={14} aria-hidden className={langOpen ? "rotate-180" : undefined} />
            </button>
            {langOpen && LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                role="menuitem"
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                className={`${LANG_ROW} justify-between !pl-[34px]`}
                onClick={() => chooseLocale(l)}
              >
                {ENDONYMS[l]}
                {l === locale && <Check size={14} strokeWidth={2.4} aria-hidden className="text-brand-green-deep" />}
              </button>
            ))}
          </div>

          <div style={{ height: 1, background: "#E5E8EE" }} aria-hidden />

          <div style={{ padding: "4px 0" }}>
            <button
              type="button"
              role="menuitem"
              style={{ ...ITEM_STYLE, color: "#B43838", fontWeight: 600 }}
              onClick={() => void signOut()}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#FBF1F1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
            >
              {c("signOut", "Sign out")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Dark navy initials circle (matches the design's footer avatar). */
function AvatarCircle({ initials, onLight }: { initials: string; onLight?: boolean }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full font-[700] flex-shrink-0${onLight ? " text-[12.5px]" : ""}`}
      style={{ width: 28, height: 28, fontSize: onLight ? undefined : 10.5, background: "#14253D", border: "1px solid #2A3F5F", color: "#FFFFFF" }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
