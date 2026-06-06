import * as React from "react";

/* =====================================================================
   Card — the ONE canonical surface.

   Replaces inline `background/border/radius/shadow` card divs. Optional
   3px cross-section accent edge (Bridge Layer signature) in buyer-blue,
   supplier-green, or the link-spine bridge gradient. Optional title/sub
   header row.

   Source of truth: docs/design-system/11-unified-page-rules.md

   Usage:
     <Card>…</Card>
     <Card edge="blue" title="Source" sub="From your ERP">…</Card>
     <Card edge="bridge" dense>…</Card>

   Server-component safe (no hooks / handlers).
   ===================================================================== */

type CardEdge = "blue" | "green" | "bridge" | "none";

type CardProps = {
  /** Optional 3px accent edge on the left. 'bridge' = blue→green link-spine gradient. */
  edge?: CardEdge;
  title?: string;
  sub?: string;
  /** Tighter padding (12px) for dense operational surfaces. */
  dense?: boolean;
  children: React.ReactNode;
  className?: string;
};

const EDGE_COLOR: Record<Exclude<CardEdge, "none">, string> = {
  blue: "var(--brand-blue)",
  green: "var(--brand-green)",
  bridge: "var(--gradient-link-spine)",
};

export function Card({
  edge = "none",
  title,
  sub,
  dense = false,
  children,
  className,
}: CardProps) {
  const pad = dense ? 12 : 18;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-card)",
        padding: pad,
        // Reserve room for the accent strip so content never sits under it.
        paddingLeft: edge === "none" ? pad : pad + 3,
        overflow: "hidden",
      }}
    >
      {/* Cross-section accent edge — Bridge Layer signature. Rendered as an
          absolutely-positioned strip so a gradient ('bridge') works the same
          way as a solid color and never affects content padding. */}
      {edge !== "none" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: EDGE_COLOR[edge],
          }}
        />
      )}

      {(title || sub) && (
        <div style={{ marginBottom: 12 }}>
          {title && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                lineHeight: 1.3,
              }}
            >
              {title}
            </div>
          )}
          {sub && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-muted)",
                marginTop: 3,
                lineHeight: 1.45,
              }}
            >
              {sub}
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

export default Card;
