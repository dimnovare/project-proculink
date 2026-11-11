"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDocumentEngine } from "@/hooks/useDocumentEngine";
import { engineRouteMove } from "@/lib/engineRouteMoves";

/** Moves an engine-on org off the old screens. Only on "on": "unknown" (loading, mock, a failed request) never bounces. */
export function EngineRouteRedirect() {
  const engine = useDocumentEngine();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const target = engine === "on" ? engineRouteMove(pathname) : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  return null;
}
