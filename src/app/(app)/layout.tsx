"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BridgeSidebar } from "@/components/bridge/BridgeSidebar";
import { BridgeTopbar } from "@/components/bridge/BridgeTopbar";
import { ErrorBoundary } from "@/components/bridge/ErrorBoundary";
import { MSWProvider } from "@/mocks/MSWProvider";

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
