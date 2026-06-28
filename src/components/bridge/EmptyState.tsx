"use client";

// EmptyState — shared empty state component following Bridge Layer vocabulary.
// Canonical shape: bare Mark (no box), hover opacity 0.7→1, Bricolage title, muted sub.
// Matches primitives.jsx EmptyState exactly.

import React from "react";
import { MarkSystem } from "./MarkSystem";

interface EmptyStateProps {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
  /** Deprecated: icon prop is accepted but ignored — Mark is always shown */
  icon?: string;
  compact?: boolean;
}

export function EmptyState({ title, sub, action, compact = false }: EmptyStateProps) {
  const [hover, setHover] = React.useState(false);
  const markSize = compact ? 40 : 52;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? "32px 20px" : "56px 24px",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Bare mark — no grey box; hover opacity 0.7→1 per primitives.jsx */}
      <div
        style={{
          marginBottom: 16,
          opacity: hover ? 1 : 0.7,
          transition: "opacity 400ms",
        }}
      >
        <MarkSystem size={markSize} />
      </div>

      {/* Title — Bricolage Grotesque, same as primitives.jsx */}
      <div
        style={{
          fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
          fontWeight: 600,
          fontSize: compact ? 16 : 19,
          letterSpacing: "-0.02em",
          color: "var(--ink, #0B1A2F)",
        }}
      >
        {title}
      </div>

      {sub && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-muted, #5E6779)",
            maxWidth: 360,
            lineHeight: 1.6,
            marginTop: 6,
          }}
        >
          {sub}
        </div>
      )}

      {action && (
        <div style={{ marginTop: 18 }}>
          <button
            onClick={action.onClick}
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 6,
              height: 32,
              padding: "0 14px",
              fontSize: 12.5,
              fontWeight: 600,
              background: "var(--navy, #0B1A2F)",
              color: "#FFFFFF",
              border: "none",
              cursor: "pointer",
              transition: "background 150ms",
            }}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
