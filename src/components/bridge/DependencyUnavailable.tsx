"use client";

// DependencyUnavailable — the standard degraded state for a hard external
// dependency (WP-32).
//
// "Hard" means: without it the screen cannot do its job at all, so there is
// nothing honest to render underneath. This replaces the content rather than
// sitting on top of it — a failure card above a screen still claiming to load
// is worse than either one alone.
//
// Deliberately dependency-agnostic. It knows nothing about auth; the caller
// supplies the name, the explanation, the retry handler, and an optional
// machine detail (a host, an address) that an operator or their IT can act on.
// ClerkAvailabilityGate is its first caller.
//
// Visual: amber, not red. Red is reserved for terminal failures (see
// operations/health's tone() and DeliveryPausedCard's "Amber, never red"). An
// unreachable external script is recoverable and usually transient.
// No new colour — every value is an existing token.

import * as React from "react";
import { XCard } from "./XCard";
import { Button } from "./DSPrimitives";

export interface DependencyUnavailableProps {
  /** What could not be reached, phrased as a user would say it. */
  name: string;
  /** What it means and what to try. One or two sentences. */
  body: React.ReactNode;
  /** Optional machine detail — a host or address someone can allow. */
  detail?: string;
  /** Label above `detail`. */
  detailLabel?: string;
  onRetry: () => void;
  retryLabel?: string;
  /** A second way out that does NOT depend on the failed dependency. */
  help?: { href: string; label: string; external?: boolean };
}

export function DependencyUnavailable({
  name,
  body,
  detail,
  detailLabel,
  onRetry,
  retryLabel = "Try again",
  help,
}: DependencyUnavailableProps) {
  return (
    // role="alert": this appears seconds after navigation, with no user action,
    // and changes what the whole page is. It has to announce itself. No
    // auto-focus — there is no dialog here, and moving focus unprompted on a
    // non-modal view change is more disorienting than the announcement is worth.
    // The retry button is the first focusable element inside.
    <div
      role="alert"
      className="flex min-h-dvh w-full items-center justify-center px-4 py-10"
      style={{ background: "var(--bg, #F6F7FA)" }}
    >
      <div className="w-full" style={{ maxWidth: 520 }}>
        <XCard edge="left" color="amber">
          <h1
            style={{
              fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
              fontWeight: 600,
              fontSize: 21,
              letterSpacing: "-0.02em",
              color: "var(--ink, #0B1A2F)",
              margin: 0,
            }}
          >
            Can&rsquo;t reach the {name}
          </h1>

          <div
            style={{
              marginTop: 10,
              fontSize: 14,
              lineHeight: 1.65,
              color: "var(--ink-muted, #5E6779)",
            }}
          >
            {body}
          </div>

          {detail && (
            <div
              style={{
                marginTop: 16,
                borderRadius: 6,
                background: "var(--surface-2, #F1F3F7)",
                padding: "10px 12px",
              }}
            >
              {detailLabel && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--ink-muted, #5E6779)",
                  }}
                >
                  {detailLabel}
                </div>
              )}
              <div
                style={{
                  marginTop: detailLabel ? 4 : 0,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 12.5,
                  color: "var(--ink, #0B1A2F)",
                  wordBreak: "break-all",
                }}
              >
                {detail}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={onRetry}>
              {retryLabel}
            </Button>
            {help && (
              // A plain anchor, not next/link, on purpose: a client-side
              // transition would stay inside the shell that just failed to
              // start. This needs a fresh document.
              <a
                href={help.href}
                {...(help.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-flex min-h-[44px] items-center rounded"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--brand-blue, #1E66C9)",
                  textDecoration: "underline",
                }}
              >
                {help.label}
              </a>
            )}
          </div>
        </XCard>
      </div>
    </div>
  );
}
