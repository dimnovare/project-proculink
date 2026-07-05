"use client";

// OrgSwitcher — the sidebar workspace card + WORKSPACES dropdown (Claude Design
// v2 shell, screenshots 09_21_19 card / 09_23_39 open menu).
//
// The card shows the ACTIVE Clerk organization (name + live billing plan).
// Clicking it opens a white dropdown listing every organization the user
// actually belongs to (real Clerk memberships via useOrganizationList — nothing
// fabricated): each row shows the org name; the plan line renders ONLY for the
// active org because the billing query is org-scoped (we never invent plan
// tiers for other orgs); the active row gets a green check. "+ Add company…"
// opens Clerk's own CreateOrganization modal — Clerk itself enforces whether
// organization creation is allowed for this instance/user, so the item is
// never a dead end we have to predict.
//
// Switching: a row click calls Clerk's setActive({ organization }). The
// id-change effect below then HARD-navigates to /bridge (full document load).
// A soft refresh is not enough — every TanStack Query cache entry, component
// state and in-flight request is keyed to the previous org, and the current
// pathname may be an org-scoped detail page that doesn't exist in the next
// org. The same effect also covers orgs created through the Clerk modal
// (Clerk activates them automatically), so both paths land on a clean shell.

import { useEffect, useRef, useState } from "react";
import { useClerk, useOrganization, useOrganizationList } from "@clerk/nextjs";
import { Check, ChevronDown, Plus } from "lucide-react";

/** Initials for an identity tile — first letters of up to two words. */
export function orgInitials(name: string): string {
  return (name.match(/\b\p{L}/gu) ?? []).slice(0, 2).join("").toUpperCase() || "PL";
}

/**
 * Shared dismiss behavior for the sidebar's anchored menus: click outside
 * (excluding the trigger) and Escape both close; Escape returns focus to the
 * trigger. Exported for UserChipMenu so the two menus behave identically.
 */
export function useMenuDismiss(
  open: boolean,
  close: () => void,
  triggerRef: React.RefObject<HTMLElement | null>,
  menuRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, close, triggerRef, menuRef]);
}

// Dropdown surface tokens (white card per the v2 handoff): radius 10,
// shadow-lg-equivalent, 13px items, hairline #E5E8EE.
const MENU_SURFACE: React.CSSProperties = {
  position: "fixed",
  zIndex: 80, // above the mobile nav drawer (z-50)
  background: "#FFFFFF",
  border: "1px solid #E5E8EE",
  borderRadius: 10,
  boxShadow: "0 12px 32px rgba(11,26,47,0.18), 0 2px 6px rgba(11,26,47,0.08)",
  overflow: "hidden",
};

interface OrgSwitcherProps {
  /** Sidebar rail collapsed to the icon-only tile. Ignored when `compact`. */
  collapsed?: boolean;
  /**
   * Top-navbar variant: a small inline chip (identity tile + name on lg+ +
   * chevron) with no sidebar margins. The dropdown still opens downward and
   * lists the same real orgs. Mutually exclusive with the sidebar card look.
   */
  compact?: boolean;
  /** Display name of the active workspace (falls back before Clerk resolves). */
  orgName: string;
  /** Card subline, e.g. "Growth plan" / "Loading…" (from the live billing query). */
  planLabel: string;
  /** Dropdown plan line for the ACTIVE org only — null while billing is loading. */
  activePlan: string | null;
}

export function OrgSwitcher({ collapsed = false, compact = false, orgName, planLabel, activePlan }: OrgSwitcherProps) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const clerk = useClerk();

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, () => setOpen(false), btnRef, menuRef);

  // Hard-navigate to the dashboard whenever the active org CHANGES (not on the
  // first activation from none). Covers both the row-click switch and an org
  // created via Clerk's modal — org switch must never leave stale org data.
  const prevOrgId = useRef<string | null>(null);
  useEffect(() => {
    const id = activeOrg?.id ?? null;
    if (prevOrgId.current && id && prevOrgId.current !== id) {
      window.location.assign("/bridge");
      return; // page is unloading — keep prev id so a re-render can't re-fire
    }
    prevOrgId.current = id;
  }, [activeOrg?.id]);

  // If the membership list is paginated, pull the rest once the menu opens so
  // the WORKSPACES list is complete (typical users have 1–2 orgs; this no-ops).
  useEffect(() => {
    if (!open) return;
    if (userMemberships?.hasNextPage && !userMemberships.isFetching) {
      void userMemberships.fetchNext?.();
    }
  }, [open, userMemberships]);

  const initials = orgInitials(orgName);

  // ── Static card (Clerk not configured — mock/QA shells): no menu, no
  //    fabricated workspaces (offer ⇔ works). Same visual as the live card. ──
  if (!clerkConfigured) {
    // Top-navbar compact chip (no menu when Clerk is absent).
    if (compact) {
      return (
        <div
          title={`${orgName} · ${planLabel}`}
          className="flex items-center gap-2 rounded-[8px]"
          style={{ background: "#14253D", border: "1px solid #1F3252", height: 34, padding: "0 9px" }}
        >
          <IdentityTile initials={initials} size={22} />
          <span className="hidden lg:block text-[12.5px] font-semibold text-white truncate" style={{ maxWidth: 140 }}>{orgName}</span>
        </div>
      );
    }
    return (
      <div
        title={collapsed ? `${orgName} · ${planLabel}` : undefined}
        className={`flex items-center text-left rounded-[10px] ${collapsed ? "mx-auto justify-center w-[44px] py-[9px]" : "gap-2.5"}`}
        style={{ background: "#14253D", border: "1px solid #1F3252", margin: collapsed ? "12px auto 6px" : "12px 12px 6px", padding: collapsed ? undefined : "9px 11px" }}
      >
        <IdentityTile initials={initials} size={collapsed ? 26 : 28} />
        {!collapsed && (
          <div className="flex-1 min-w-0" style={{ lineHeight: 1.25 }}>
            <div className="text-[12.5px] font-semibold text-white truncate">{orgName}</div>
            <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>{planLabel}</div>
          </div>
        )}
      </div>
    );
  }

  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 212) });
    }
    setOpen((v) => !v);
  };

  // Rows = real memberships; make sure the active org is present even while
  // the membership page is still loading (it is the only org we KNOW about).
  const memberOrgs = (userMemberships?.data ?? []).map((m) => m.organization);
  const rows = activeOrg && !memberOrgs.some((o) => o.id === activeOrg.id)
    ? [{ id: activeOrg.id, name: activeOrg.name }, ...memberOrgs]
    : memberOrgs;

  const pick = (orgId: string) => {
    if (orgId === activeOrg?.id) {
      setOpen(false);
      return;
    }
    if (!setActive) return;
    setSwitchingId(orgId);
    // The activeOrg id-change effect above performs the hard navigation.
    setActive({ organization: orgId }).catch(() => setSwitchingId(null));
  };

  // The dropdown surface — shared by the sidebar card and the compact top-navbar
  // chip so the two triggers open an identical Workspaces menu (anchored downward).
  const renderMenu = () =>
    anchor && (
      <div
        ref={menuRef}
        role="menu"
        aria-label="Workspaces"
        style={{ ...MENU_SURFACE, top: anchor.top, left: anchor.left, width: anchor.width }}
      >
        <div
          className="uppercase"
          style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: "#98A0AE", padding: "10px 12px 5px" }}
        >
          Workspaces
        </div>

        {rows.map((org) => {
          const isActiveRow = org.id === activeOrg?.id;
          return (
            <button
              key={org.id}
              type="button"
              role="menuitem"
              onClick={() => pick(org.id)}
              disabled={switchingId !== null}
              className="flex w-full items-center gap-2.5 text-left"
              style={{ padding: "7px 12px", background: "#FFFFFF", border: "none", cursor: switchingId ? "wait" : "pointer" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
            >
              <IdentityTile initials={orgInitials(org.name)} size={26} />
              <span className="min-w-0 flex-1" style={{ lineHeight: 1.25 }}>
                <span className="block truncate" style={{ fontSize: 12.5, fontWeight: 600, color: "#0B1A2F" }}>
                  {org.name}
                </span>
                {/* Plan is only known (billing query) for the ACTIVE org — never
                    fabricate a tier for the others. */}
                {isActiveRow && activePlan && (
                  <span className="block" style={{ fontSize: 10.5, color: "#98A0AE", marginTop: 1 }}>
                    {activePlan}
                  </span>
                )}
                {switchingId === org.id && (
                  <span className="block" style={{ fontSize: 10.5, color: "#98A0AE", marginTop: 1 }}>
                    Switching…
                  </span>
                )}
              </span>
              {isActiveRow && <Check size={15} strokeWidth={2.4} style={{ color: "#2E8E3A", flexShrink: 0 }} aria-label="Current workspace" />}
            </button>
          );
        })}

        <div style={{ height: 1, background: "#E5E8EE", margin: "4px 0" }} aria-hidden />

        {/* Clerk's own modal enforces whether org creation is permitted for
            this instance/user — it is the source of truth, not us. */}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/bridge" });
          }}
          className="flex w-full items-center gap-2 text-left"
          style={{ padding: "9px 12px", background: "#FFFFFF", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#1E66C9" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden />
          Add company…
        </button>
      </div>
    );

  // ── Compact top-navbar chip: identity tile + name (lg+) + chevron, no
  //    sidebar margins, same downward menu. ──
  if (compact) {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Workspace: ${orgName}. Switch workspace`}
          title={`${orgName} · ${planLabel}`}
          className="flex items-center gap-2 rounded-[8px]"
          style={{
            background: "#14253D",
            border: "1px solid #1F3252",
            height: 34,
            padding: "0 9px",
            cursor: "pointer",
            transition: "border-color 140ms, background 140ms",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#294063"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#1F3252"; }}
        >
          <IdentityTile initials={initials} size={22} />
          <span className="hidden lg:block text-[12.5px] font-semibold text-white truncate" style={{ maxWidth: 140 }}>{orgName}</span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            style={{ color: "#7C8DA6", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
            aria-hidden
          />
        </button>
        {open && anchor && renderMenu()}
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${orgName}. Switch workspace`}
        title={collapsed ? `${orgName} · ${planLabel}` : undefined}
        className={`flex items-center text-left rounded-[10px] ${collapsed ? "mx-auto justify-center w-[44px] py-[9px]" : "gap-2.5"}`}
        style={{
          background: "#14253D",
          border: "1px solid #1F3252",
          margin: collapsed ? "12px auto 6px" : "12px 12px 6px",
          padding: collapsed ? undefined : "9px 11px",
          cursor: "pointer",
          transition: "border-color 140ms, background 140ms",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#294063"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#1F3252"; }}
      >
        <IdentityTile initials={initials} size={collapsed ? 26 : 28} />
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0" style={{ lineHeight: 1.25 }}>
              <div className="text-[12.5px] font-semibold text-white truncate">{orgName}</div>
              <div className="text-[10.5px] mt-0.5" style={{ color: "#7C8DA6" }}>{planLabel}</div>
            </div>
            <ChevronDown
              size={14}
              strokeWidth={2}
              style={{ color: "#7C8DA6", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
              aria-hidden
            />
          </>
        )}
      </button>

      {open && renderMenu()}
    </>
  );
}

/** Blue→green gradient identity tile (v2 workspace mark). */
function IdentityTile({ initials, size }: { initials: string; size: number }) {
  return (
    <span
      className="flex items-center justify-center font-[700] text-white flex-shrink-0"
      style={{ width: size, height: size, fontSize: 10.5, borderRadius: 7, background: "linear-gradient(135deg,#1E66C9,#2E8E3A)" }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
