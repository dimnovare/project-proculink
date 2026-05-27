"use client";

import { useState, useEffect } from "react";
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
          {/* Left: 220px navy sidebar */}
          <div className="hidden md:block">
            <BridgeSidebar />
          </div>

          {sidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-[#0B1A2F]/55"
                aria-label="Close navigation"
                onClick={() => setSidebarOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 shadow-2xl">
                <BridgeSidebar onNavigate={() => setSidebarOpen(false)} />
              </div>
            </div>
          )}

          {/* Right: topbar + scrollable main content */}
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <BridgeTopbar onMenuClick={() => setSidebarOpen(true)} />
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
