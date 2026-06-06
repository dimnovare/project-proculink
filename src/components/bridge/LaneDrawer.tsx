"use client";

// LaneDrawer — slides in from right when a wire is clicked in WireTopology.
// Shows lane overview: buyer + supplier, health, recent crossings on this wire.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isApiMockMode } from "@/lib/api-client";
import { useOrderDirection } from "@/hooks/useOrderDirection";

export type Lane = {
  buyerName: string;
  buyerCode: string;
  supplierName: string;
  supplierCode: string;
  health: "ok" | "risk" | "down";
  volume: string;
  alert?: number;
};

const HEALTH_COLOR: Record<string, string> = {
  ok:   "#2E8E3A",
  risk: "#C97A14",
  down: "#C53A3A",
};

const HEALTH_LABEL: Record<string, string> = {
  ok:   "Healthy",
  risk: "At risk",
  down: "Down",
};

// Mock recent crossings for the selected lane
const MOCK_CROSSINGS = [
  { po: "PO-DEMO-001", orderId: "demo-001", age: "2m",  status: "review",     lines: 14, value: "€24,180" },
  { po: "PO-2026-008411", orderId: "008411", age: "1h",  status: "sent",       lines: 11, value: "€5,612"  },
  { po: "PO-2026-008399", orderId: "008399", age: "3h",  status: "sent",       lines: 8,  value: "€9,140"  },
  { po: "PO-2026-008381", orderId: "008381", age: "1d",  status: "failed",     lines: 22, value: "€31,800" },
  { po: "PO-2026-008360", orderId: "008360", age: "2d",  status: "sent",       lines: 6,  value: "€3,402"  },
];

const STATUS_DOT: Record<string, string> = {
  review: "#C97A14",
  sent:   "#2E8E3A",
  failed: "#C53A3A",
  new:    "#1E66C9",
};

interface LaneDrawerProps {
  lane: Lane;
  onClose: () => void;
}

export function LaneDrawer({ lane, onClose }: LaneDrawerProps) {
  const hc     = HEALTH_COLOR[lane.health];
  const router = useRouter();
  // Direction-aware party labels (avoids a split-brain "Supplier" UI for inbound
  // orgs). railHeader is "Buyer → Supplier" (outbound) / "Customer → You"
  // (inbound); split it into the two side labels.
  const { labels } = useOrderDirection();
  const [leftPartyLabel, rightPartyLabel] = (() => {
    const parts = labels.railHeader.split("→").map(s => s.trim());
    return [parts[0] || "Buyer", parts[1] || "Supplier"];
  })();

  // esc closes
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onClose]);

  return (
    <>
      {/* Dim overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,26,47,0.3)",
          zIndex: 8998,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          background: "#FFFFFF",
          boxShadow: "-8px 0 32px rgba(11,26,47,0.14)",
          zIndex: 8999,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid #E2E6EE",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                fontSize: 17,
                fontWeight: 700,
                color: "#0B1A2F",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Connection detail
            </h2>
            <button
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 18,
                color: "#8A93A5",
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Buyer → Supplier */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "#F6F7FA",
              borderRadius: 8,
              border: "1px solid #E2E6EE",
            }}
          >
            {/* Buyer */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#1E66C9",
                  marginBottom: 2,
                }}
              >
                {leftPartyLabel}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lane.buyerName}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  color: "#1E66C9",
                  fontWeight: 600,
                }}
              >
                {lane.buyerCode}
              </div>
            </div>

            {/* Wire arrow */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 2,
                  background: `linear-gradient(90deg, #1E66C9, ${hc})`,
                  borderRadius: 99,
                }}
              />
              <div
                style={{
                  fontSize: 9,
                  color: hc,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                {HEALTH_LABEL[lane.health]}
              </div>
            </div>

            {/* Supplier */}
            <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#2E8E3A",
                  marginBottom: 2,
                }}
              >
                {rightPartyLabel}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lane.supplierName}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  color: "#2E8E3A",
                  fontWeight: 600,
                }}
              >
                {lane.supplierCode}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 0,
              marginTop: 12,
              border: "1px solid #E2E6EE",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {[
              { label: "Volume",  value: lane.volume },
              { label: "Health",  value: HEALTH_LABEL[lane.health], color: hc },
              { label: "Alerts",  value: lane.alert ? `${lane.alert}` : "—", color: lane.alert ? "#C97A14" : undefined },
            ].map(({ label, value, color }, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  textAlign: "center",
                  borderRight: i < 2 ? "1px solid #E2E6EE" : undefined,
                  background: "#FAFBFC",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: color ?? "#0B1A2F",
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 10.5, color: "#8A93A5", marginTop: 1 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent crossings */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <div
            style={{
              padding: "12px 20px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#8A93A5",
            }}
          >
            Recent deliveries
          </div>

          {!isApiMockMode && (
            <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "#8A93A5" }}>
              No recent deliveries on this connection.
            </div>
          )}

          {isApiMockMode && MOCK_CROSSINGS.map((c, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                borderBottom: "1px solid #F0F2F6",
                cursor: "pointer",
              }}
              onClick={() => { onClose(); router.push(`/inbox/${c.orderId}`); }}
              onKeyDown={(e) => { if (e.key === "Enter") { onClose(); router.push(`/inbox/${c.orderId}`); }}}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "transparent")
              }
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: STATUS_DOT[c.status] ?? "#8A93A5",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#0F4FA8",
                  flex: 1,
                }}
              >
                {c.po}
              </span>
              <span style={{ fontSize: 11.5, color: "#8A93A5" }}>{c.lines}L</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  color: "#56627A",
                }}
              >
                {c.value}
              </span>
              <span style={{ fontSize: 11, color: "#8A93A5" }}>{c.age}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #E2E6EE",
            display: "flex",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => { onClose(); router.push("/inbox"); }}
            style={{
              flex: 1,
              borderRadius: 7,
              padding: "9px 0",
              fontSize: 13,
              fontWeight: 600,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: "none",
              cursor: "pointer",
            }}
          >
            View all deliveries →
          </button>
          <button
            style={{
              borderRadius: 7,
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "#FFFFFF",
              color: "#56627A",
              border: "1px solid #E2E6EE",
              cursor: "pointer",
            }}
          >
            Connection settings
          </button>
        </div>
      </div>
    </>
  );
}
