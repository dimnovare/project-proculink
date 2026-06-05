"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BridgeSidebar } from "@/components/bridge/BridgeSidebar";
import { BridgeTopbar } from "@/components/bridge/BridgeTopbar";
import { ErrorBoundary } from "@/components/bridge/ErrorBoundary";
import { MSWProvider } from "@/mocks/MSWProvider";

/**
 * Auto-activates the user's first Clerk organization when they have one but
 * none is currently active. Without an active org the JWT lacks the org_id
 * claim, which causes TenantResolutionMiddleware to leave the tenant unresolved
 * and every API call to fail with "Organisation not resolved".
 *
 * Must render inside QueryClientProvider so it can invalidate queries after
 * setActive resolves and the session token refreshes with the org_id claim.
 */
function AutoActivateOrg() {
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (activeOrg) return; // already active — nothing to do
    const first = userMemberships.data?.[0]?.organization;
    if (!first || !setActive) return;

    void setActive({ organization: first.id }).then(() => {
      // Session token now contains org_id. Invalidate all cached queries so
      // any requests that fired before the token refreshed will retry correctly.
      void queryClient.invalidateQueries();
    });
  }, [activeOrg, userMemberships.data, setActive, queryClient]);

  return null;
}

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Element that had focus when the drawer opened — focus returns here on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  const openSidebar = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setSidebarOpen(true);
  }, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Mobile nav drawer: Escape to close, body-scroll lock, focus move-in + trap,
  // and focus restore to the trigger on close. Mirrors CommandPalette/HelpSlideover.
  useEffect(() => {
    if (!sidebarOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the panel (first focusable, else the panel itself).
    const panel = drawerRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];
    const first = focusables()[0];
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSidebar();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === firstEl || active === panel || !panel.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the drawer.
      triggerRef.current?.focus?.();
    };
  }, [sidebarOpen, closeSidebar]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <MSWProvider>
    <QueryClientProvider client={queryClient}>
      <AutoActivateOrg />
      <TooltipProvider>
        {/* Bridge shell — full viewport, no scroll on the wrapper */}
        <div className="flex h-screen overflow-hidden" style={{ background: "#F6F7FA" }}>
          {/* Left: 220px navy sidebar (compact rail in the md→lg band) */}
          <div className="hidden md:block">
            <BridgeSidebar collapsible collapseBelowLg />
          </div>

          {sidebarOpen && (
            <div
              ref={drawerRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-0 z-50 md:hidden outline-none"
              style={{ background: "#0B1A2F" }}
            >
              <BridgeSidebar
                fullWidth
                showClose
                onClose={closeSidebar}
                onNavigate={closeSidebar}
              />
            </div>
          )}

          {/* Right: topbar + scrollable main content */}
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <BridgeTopbar onMenuClick={openSidebar} />
            <main className="flex-1 overflow-auto">
              <ErrorBoundary context="App">
                {children}
              </ErrorBoundary>
            </main>
          </div>
        </div>

        <Toaster />
        <Sonner />
      </TooltipProvider>
    </QueryClientProvider>
    </MSWProvider>
  );
}
