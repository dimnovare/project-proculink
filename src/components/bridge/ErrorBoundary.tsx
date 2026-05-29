"use client";

// AC4 — React error boundary for Bridge Layer screens
// Catches client-side render errors and shows a recovery UI

import { Component, type ReactNode, type ErrorInfo } from "react";

import { captureException } from "@/lib/sentry-context";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Receives the error and a reset fn. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Context label for the error panel heading (e.g. "Inbox", "Spine Review") */
  context?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.context ?? "unknown"}]`, error, info.componentStack);
    captureException(error, {
      tags: { boundary: this.props.context ?? "unknown" },
      extra: { componentStack: info.componentStack ?? "" },
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return <DefaultErrorPanel error={error} reset={this.reset} context={this.props.context} />;
  }
}

// ─── Default fallback panel ───────────────────────────────────────────────────

function DefaultErrorPanel({
  error,
  reset,
  context,
}: {
  error: Error;
  reset: () => void;
  context?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "48px 32px",
        textAlign: "center",
        background: "#F6F7FA",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          background: "#FBE3E3",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          marginBottom: 16,
        }}
      >
        ⚠
      </div>

      {/* Heading */}
      <p
        style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "#0B1A2F",
          marginBottom: 6,
        }}
      >
        {context ? `${context} failed to load` : "Something went wrong"}
      </p>

      {/* Sub */}
      <p style={{ fontSize: 13, color: "#56627A", maxWidth: 360, marginBottom: 24 }}>
        An unexpected error occurred while rendering this screen. The error has been logged.
      </p>

      {/* Error detail (collapsed) */}
      <details
        style={{
          marginBottom: 24,
          textAlign: "left",
          maxWidth: 480,
          width: "100%",
          background: "#FFFFFF",
          border: "1px solid #E2E6EE",
          borderRadius: 8,
          padding: "8px 12px",
        }}
      >
        <summary
          style={{ fontSize: 11.5, fontWeight: 600, color: "#8A93A5", cursor: "pointer", userSelect: "none" }}
        >
          Error details
        </summary>
        <pre
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: "#C53A3A",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {error.message}
        </pre>
      </details>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={reset}
          style={{
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
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            borderRadius: 7,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            background: "#FFFFFF",
            color: "#0B1A2F",
            border: "1px solid #E2E6EE",
            cursor: "pointer",
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────
// Use <BridgeScreen context="Inbox"> around any page content that could fail

export function BridgeScreen({
  context,
  children,
}: {
  context: string;
  children: ReactNode;
}) {
  return <ErrorBoundary context={context}>{children}</ErrorBoundary>;
}
