"use client";

// The in-app "page not found": inside the shell, one way back, help beside it.
// It never says whether an address names something in another workspace: an
// unknown address and someone else's read the same, with no id and no server words.

import Link from "next/link";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { buttonClass } from "@/components/bridge/DSPrimitives";

export function AppNotFound() {
  return (
    <PageShell>
      <Card as="section" flush aria-labelledby="app-not-found-title" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div data-plk-error-boundary="not-found" className="flex flex-col items-center px-7 pb-8 pt-11 text-center">
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true" className="mb-2 text-ink-faint">
            <path d="M13 5h15l9 9v26a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="2.2" strokeDasharray="4 4" strokeLinejoin="round" />
            <path d="M28 5v9h9" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
          <h1 id="app-not-found-title" className="m-0 font-display text-[30px] font-semibold text-ink">We can&apos;t find that page</h1>
          <p className="m-0 mt-2 max-w-[400px] text-[15px] text-ink-muted">
            The address may be mistyped, or the page may have moved. Your documents and flows are safe.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <Link href="/documents" className={buttonClass("primary", "lg")}>Go to Documents</Link>
            {/* Until the help panel can be opened from a page (plan 14.11 Task 4), help opens in a new tab. */}
            <Link href="/help" target="_blank" rel="noopener" className={buttonClass("secondary", "lg")}>Get help</Link>
          </div>
          <p className="m-0 mt-3 text-[13px] text-ink-muted">Error 404</p>
        </div>
      </Card>
    </PageShell>
  );
}
