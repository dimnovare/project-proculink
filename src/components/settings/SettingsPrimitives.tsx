import type { CSSProperties, ReactNode } from "react";

/**
 * Shared Settings primitives. Extracted from the Settings page so both
 * `settings/page.tsx` and `PullIngressSettings.tsx` can use the canonical card
 * shell + primary button WITHOUT a page<->component import cycle — and without
 * illegally exporting non-default symbols from a Next App Router page module
 * (which `next build` rejects).
 */

/** Canonical Settings card: title/sub header + padded body. */
export function SettingsGroup({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 0, marginBottom: 16, overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em", color: "var(--ink)" }}>{title}</div>
        {sub && <div style={{ fontSize: 12, marginTop: 2, color: "var(--ink-muted)", lineHeight: 1.45 }}>{sub}</div>}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

/** Brand-green primary "Save" button style, shared across Settings sections. */
export const primaryGreenButton: CSSProperties = {
  height: 38,
  padding: "0 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--brand-green)",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  boxShadow: "0 1px 2px rgba(11,26,47,0.06)",
};
