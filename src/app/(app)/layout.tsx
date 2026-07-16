"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toaster";
import { BridgeSidebar } from "@/components/bridge/BridgeSidebar";
import { BridgeTopbar } from "@/components/bridge/BridgeTopbar";
import { ErrorBoundary } from "@/components/bridge/ErrorBoundary";
import { MSWProvider } from "@/mocks/MSWProvider";
import { WorkspaceNameNudge } from "@/components/onboarding/WorkspaceNameNudge";
import { SkipToContent } from "@/components/a11y/SkipToContent";

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

/**
 * The org gate forwards into the app with a one-shot `?org_set=1` flag (consumed
 * by middleware to skip one `!orgId` bounce during the cookie-lag window). Once
 * we've landed, that flag has done its job and should not linger in the address
 * bar. This strips ONLY `org_set` from the URL on mount, preserving the pathname
 * and every other query param. Reads from `window.location` (not
 * `useSearchParams`) so no extra Suspense boundary is needed.
 */
function StripOrgSetFlag() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("org_set")) return;
    url.searchParams.delete("org_set");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, []);

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
            // networkMode "always": run queryFns regardless of React Query's
            // onlineManager. Its navigator.onLine heuristic can latch "offline"
            // in production — observed live on /bridge: navigator.onLine === true,
            // yet every query was stuck fetchStatus:"paused" (status "pending",
            // data undefined, isLoading false), so the dashboard and every data
            // screen silently rendered their empty state ("No deliveries yet",
            // 0 connections/orders) even though the API had 206 orders. This app
            // has no offline mode; always attempt the fetch and surface real
            // fetch errors instead of trusting the heuristic.
            networkMode: "always",
          },
          mutations: {
            // Same rationale: otherwise a save/send mutation can pause
            // indefinitely instead of reaching the API.
            networkMode: "always",
          },
        },
      })
  );

  return (
    <MSWProvider>
    <QueryClientProvider client={queryClient}>
      <AutoActivateOrg />
      <StripOrgSetFlag />
      <TooltipProvider>
       <ConfirmProvider>
        {/* Bridge shell — full viewport, no scroll on the wrapper.
            Desktop nav now lives in the top navbar (BridgeTopbar row 1); the
            left sidebar was removed on md+. The mobile drawer below still
            reuses BridgeSidebar for the full navigation on < md. */}
        <div className="flex h-dvh overflow-hidden" style={{ background: "#F6F7FA" }}>
          {/* First focusable element — jumps keyboard users past the topbar nav
              straight to the page content (WCAG 2.4.1). */}
          <SkipToContent />
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
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto outline-none">
              <WorkspaceNameNudge />
              <ErrorBoundary context="App">
                {children}
              </ErrorBoundary>
            </main>
          </div>
        </div>

        <Toaster />
       </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </MSWProvider>
  );
}
