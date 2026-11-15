"use client";

// Next.js route error boundary for the (app) segment. Catches errors the nested
// component <ErrorBoundary> can't — Server Component render, data fetching, and
// the route tree — and shows the SAME branded recovery panel instead of Next's
// unstyled default screen. It renders INSIDE (app)/layout.tsx, so the topbar and
// shell stay put; only the content region is replaced.
//
// Sentry auto-captures from the error boundary; we also call our explicit helper
// so the digest reaches Sentry with a boundary tag (no-op outside production).

import { useEffect } from "react";
import Link from "next/link";

import { CouldNotLoad } from "@/components/flows/states";
import { captureException } from "@/lib/sentry-context";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: "app-route" },
      extra: { digest: error.digest ?? "" },
    });
  }, [error]);

  return (
    <div
      // Machine-readable marker that this route is showing an error, not content.
      // It exists because the comment at the top of this file is load-bearing: this
      // boundary renders INSIDE (app)/layout.tsx, so the sidebar and topbar
      // are still there and the response is still HTTP 200. A test
      // that checks "did the page return 2xx and render some text and some
      // controls" is satisfied by the shell alone — verified, /upload passed an axe
      // scan while its page component threw. src/test/errorBoundaryMarker.test.ts
      // keeps this attribute from being removed by accident.
      data-plk-error-boundary="app-route"
      className="p-4 sm:p-6"
    >
      <CouldNotLoad
        page
        title="We couldn't load this page."
        line="Nothing is lost. Try again, and if it keeps happening, contact support."
        retry={reset}
        extra={<Link href="/support" className="inline-flex items-center min-h-10 font-semibold">Contact support</Link>}
      />
    </div>
  );
}
