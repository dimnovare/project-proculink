"use client";

import { useEffect } from "react";
import { syncWorker, workerWanted } from "@/lib/pwa/worker";
// Attaches the beforeinstallprompt catcher with the first client chunk, so the offer is kept for Settings.
import "@/lib/pwa/install";

/** Adds the service worker on production builds and removes it everywhere else (the kill switch). Renders nothing. */
export function PwaBoot(): null {
  useEffect(() => {
    void syncWorker(
      workerWanted({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_PWA_WORKER: process.env.NEXT_PUBLIC_PWA_WORKER }),
      () => navigator.serviceWorker,
      () => globalThis.caches,
    );
  }, []);
  return null;
}
