"use client";

// AC4 — React error boundary for Bridge Layer screens
// Catches client-side render errors and shows a recovery UI

import { Component, type ReactNode, type ErrorInfo } from "react";

import Link from "next/link";

import { CouldNotLoad } from "@/components/flows/states";
import { captureException } from "@/lib/sentry-context";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Receives the error and a reset fn. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Context label for the error log and Sentry tag (e.g. "Inbox") */
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

    return <DefaultErrorPanel reset={this.reset} />;
  }
}

// ─── Default fallback panel ───────────────────────────────────────────────────

function DefaultErrorPanel({ reset }: { reset: () => void }) {
  return (
    // See src/app/(app)/error.tsx for why this marker exists.
    <div data-plk-error-boundary="component" className="p-4 sm:p-6">
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
