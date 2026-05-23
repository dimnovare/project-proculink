"use client";

// EmptyState — shared empty state component following Bridge Layer vocabulary.
// Illustration-free: mark animation + headline + sub + CTA.

import { MarkSystem } from "./MarkSystem";

interface EmptyStateProps {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
  icon?: string;
}

export function EmptyState({ title, sub, action, icon }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 32px",
        textAlign: "center",
        gap: 12,
      }}
    >
      {/* Mark / icon */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "#F0F2F7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        {icon ? (
          <span style={{ fontSize: 26, color: "#8A93A5" }}>{icon}</span>
        ) : (
          <MarkSystem size={28} />
        )}
      </div>

      <h3
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "#0B1A2F",
          margin: 0,
        }}
      >
        {title}
      </h3>

      {sub && (
        <p
          style={{
            fontSize: 13,
            color: "#56627A",
            maxWidth: 320,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {sub}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 7,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            background: "#0B1A2F",
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
