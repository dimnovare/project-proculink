"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BridgeSidebar } from "@/components/bridge/BridgeSidebar";
import { BridgeTopbar } from "@/components/bridge/BridgeTopbar";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Bridge shell — full viewport, no scroll on the wrapper */}
        <div className="flex h-screen overflow-hidden" style={{ background: "#F6F7FA" }}>
          {/* Left: 220px navy sidebar */}
          <BridgeSidebar />

          {/* Right: topbar + scrollable main content */}
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <BridgeTopbar />
            <main className="flex-1 overflow-auto">
              {children}
            </main>
          </div>
        </div>

        <Toaster />
        <Sonner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
