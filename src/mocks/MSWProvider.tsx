"use client";

/**
 * MSWProvider — bootstraps the MSW service worker in development.
 * Wrap the (app) layout with this; it's a no-op in production.
 *
 * Usage in (app)/layout.tsx:
 *   import { MSWProvider } from "@/mocks/MSWProvider";
 *   ...
 *   <MSWProvider>{children}</MSWProvider>
 */

import { useEffect, useState, type ReactNode } from "react";

export function MSWProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(
    process.env.NEXT_PUBLIC_MSW !== "true" // non-MSW mode — render immediately
  );

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MSW !== "true") return;

    import("./browser").then(({ worker }) => {
      worker.start({
        onUnhandledRequest: "bypass",
        serviceWorker: { url: "/mockServiceWorker.js" },
      }).then(() => setReady(true));
    });
  }, []);

  if (!ready) {
    // Tiny splash while service worker registers (<100ms on fast connections)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F6F7FA" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <svg width={20} height={20} viewBox="0 0 40 40" fill="none">
            <path d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8" stroke="#1E66C9" strokeWidth="3.6" strokeLinecap="round"/>
            <circle cx="8" cy="10" r="2.5" fill="#1E66C9"/>
            <circle cx="8" cy="30" r="2.5" fill="#2E8E3A"/>
          </svg>
          <span style={{ fontSize: 13, color: "#56627A" }}>Starting mock API…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
