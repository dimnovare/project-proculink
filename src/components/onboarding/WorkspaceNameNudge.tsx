"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOrganization } from "@clerk/nextjs";

/**
 * Slim, dismissible bar shown after the onboarding gate auto-creates a
 * workspace. It surfaces the auto-derived workspace name and points the user at
 * Settings → Organization to rename it. Purely informational — display-only.
 *
 * Signals it reads from localStorage:
 *   - `ws-autonamed`             → the org id that was auto-named at create time
 *   - `ws-nudge-dismissed:<id>`  → "1" once the user has dismissed the bar
 *
 * SSR-safe: localStorage is NEVER touched during render. The visibility decision
 * is made in an effect (guarded by `typeof window`) and stored in state, so the
 * server render and first client render agree (both hidden) — no hydration flash.
 */
export function WorkspaceNameNudge() {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const orgName = organization?.name;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !orgId) {
      setShow(false);
      return;
    }
    let autonamed: string | null = null;
    let dismissed: string | null = null;
    try {
      autonamed = localStorage.getItem("ws-autonamed");
      dismissed = localStorage.getItem("ws-nudge-dismissed:" + orgId);
    } catch {
      // storage may be blocked — stay hidden
    }
    setShow(autonamed === orgId && dismissed !== "1");
  }, [orgId, orgName]);

  if (!show || !orgId) return null;

  function dismiss() {
    try {
      localStorage.setItem("ws-nudge-dismissed:" + orgId, "1");
    } catch {
      // storage may be blocked — hide anyway
    }
    setShow(false);
  }

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-2)",
        fontSize: 12.5,
        lineHeight: 1.4,
        color: "var(--ink-muted)",
      }}
    >
      <span style={{ minWidth: 0 }}>
        We set up your workspace as{" "}
        <strong style={{ fontWeight: 600, color: "var(--ink)" }}>&ldquo;{orgName}&rdquo;</strong>. You can rename it anytime.
      </span>
      <Link
        href="/settings?tab=org"
        style={{ fontWeight: 600, color: "var(--brand-blue)", textDecoration: "none", whiteSpace: "nowrap" }}
      >
        Rename in Settings
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss workspace name notice"
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 5,
          border: "none",
          background: "transparent",
          color: "var(--ink-faint)",
          fontSize: 16,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
