"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { AuditEvent } from "@/types/procurement";

interface Props {
  orderId: string;
}

// ─── Design tokens (mirrors OrderDetailPage) ──────────────────────────────────
const T = {
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E2E6EE",
  borderFaint: "#EEF0F4",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  blue:        "#1E66C9",
  blueSoft:    "#EBF3FF",
  green:       "#2E8E3A",
  greenSoft:   "#DCFCE7",
  amber:       "#C97A14",
  amberSoft:   "#FEF3C7",
  danger:      "#C53A3A",
  dangerSoft:  "#FEE2E2",
  violet:      "#6F4FCE",
  violetSoft:  "#EDE9FE",
  ui:          '"Inter", system-ui, sans-serif',
  mono:        '"JetBrains Mono", ui-monospace, monospace',
};

// ─── Action metadata ──────────────────────────────────────────────────────────

interface ActionMeta { color: string; soft: string; label: string }

const ACTION_META: Record<string, ActionMeta> = {
  Created:           { color: T.blue,   soft: T.blueSoft,   label: "Order created"      },
  Parsed:            { color: T.green,  soft: T.greenSoft,  label: "File parsed"         },
  Resolved:          { color: T.green,  soft: T.greenSoft,  label: "Lines resolved"      },
  Transformed:       { color: T.violet, soft: T.violetSoft, label: "Output generated"    },
  ReadyToDeliver:    { color: T.violet, soft: T.violetSoft, label: "Ready to deliver"    },
  Delivered:         { color: T.green,  soft: T.greenSoft,  label: "Delivered"           },
  DeliveryAttempt:   { color: T.amber,  soft: T.amberSoft,  label: "Delivery attempted"  },
  DeliveryCompleted: { color: T.green,  soft: T.greenSoft,  label: "Delivered"           },
  Failed:            { color: T.danger, soft: T.dangerSoft, label: "Processing failed"   },
  ParseFailed:       { color: T.danger, soft: T.dangerSoft, label: "Parsing failed"      },
  TransformFailed:   { color: T.danger, soft: T.dangerSoft, label: "Transform failed"    },
  DeliveryFailed:    { color: T.danger, soft: T.dangerSoft, label: "Delivery failed"     },
};

function getMeta(action: string): ActionMeta {
  return ACTION_META[action] ?? { color: T.inkMuted, soft: T.surface2, label: action };
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s    = Math.floor(diff / 1_000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditTimeline({ orderId }: Props) {
  const { data: events, isLoading } = useQuery<AuditEvent[]>({
    queryKey: ["order-audit", orderId],
    queryFn:  () => apiClient.getOrderAudit(orderId),
    staleTime: 30_000,
  });

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, overflow: "hidden", fontFamily: T.ui,
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 20px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center",
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Activity</span>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[80, 60, 90].map((w, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#EDF0F5", flexShrink: 0 }} />
                <div style={{ width: w, height: 12, borderRadius: 3, background: "#EDF0F5" }} />
              </div>
            ))}
          </div>
        ) : !events || events.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.inkFaint, margin: 0 }}>No activity yet.</p>
        ) : (
          /* Vertical timeline */
          <ol style={{ margin: 0, padding: 0, listStyle: "none", position: "relative" }}>
            {/* Connecting vertical line */}
            <div style={{
              position: "absolute", left: 9, top: 10, bottom: 10,
              width: 1, background: T.border, zIndex: 0,
            }} />

            {events.map((ev, i) => {
              const meta = getMeta(ev.action);
              const isLast = i === events.length - 1;
              return (
                <li
                  key={i}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    position: "relative", zIndex: 1,
                    paddingBottom: isLast ? 0 : 14,
                  }}
                >
                  {/* Circle node */}
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                    background: meta.soft,
                    border: `2px solid ${meta.color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: meta.color, display: "block",
                    }} />
                  </div>

                  {/* Label + time */}
                  <div style={{ paddingTop: 1 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      height: 20, padding: "0 8px", borderRadius: 20,
                      fontSize: 11.5, fontWeight: 600,
                      background: meta.soft, color: meta.color,
                      border: `1px solid ${meta.color}30`,
                    }}>
                      {meta.label}
                    </span>
                    <div style={{
                      fontSize: 11, color: T.inkFaint,
                      marginTop: 3, fontFamily: T.mono,
                    }}>
                      {relTime(ev.createdAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
