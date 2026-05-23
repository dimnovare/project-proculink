"use client";

// Supplier Dock Profile — /library/suppliers/[id]
// §5.8 — Header + tabs: Overview · Mappings · Rules · Output templates · Connectors · History

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "overview" | "mappings" | "rules" | "templates" | "connectors" | "history";

// Mock data for supplier with id param
const MOCK = {
  id:            "s1",
  name:          "Acme Components",
  code:          "ACM",
  health:        97,
  totalOrders:   3218,
  avgCycle:      "1m 38s",
  exceptionRate: "2.1%",
  volume:        "610/wk",
  formats:       ["cXML", "EDI", "API"],
  connectors:    [
    { type: "cXML PunchOut", endpoint: "https://acme.example.com/cxml/orders", status: "ok",   lastPoll: "1m" },
    { type: "API (REST)",    endpoint: "https://api.acme.example.com/v2/po",   status: "ok",   lastPoll: "30s" },
  ],
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview",    label: "Overview"          },
  { id: "mappings",    label: "Mappings"          },
  { id: "rules",       label: "Rules"             },
  { id: "templates",   label: "Output templates"  },
  { id: "connectors",  label: "Connectors"        },
  { id: "history",     label: "History"           },
];

export function SupplierDockProfile({ id }: { id: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const s = MOCK; // In real app: fetch by id
  const hc = "#2E8E3A";

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex items-start gap-4 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <button
          onClick={() => router.push("/library/suppliers")}
          className="text-[12.5px] font-medium mt-1 flex-shrink-0"
          style={{ color: "#56627A", background: "none", border: "none", cursor: "pointer" }}
        >
          ← Supplier docks
        </button>

        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 11,
            background: `${hc}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            fontWeight: 800,
            color: hc,
            flexShrink: 0,
          }}
        >
          {s.code}
        </div>

        <div className="flex-1 min-w-0">
          <h1
            className="text-[22px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            {s.name}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            {s.formats.map((f) => (
              <span key={f} className="text-[10.5px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EFF2F7", color: "#56627A" }}>
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div className="flex items-center gap-6 ml-auto flex-shrink-0">
          {[
            { label: "Total orders",    value: s.totalOrders.toLocaleString() },
            { label: "Avg cycle",       value: s.avgCycle                     },
            { label: "Exception rate",  value: s.exceptionRate                },
            { label: "Health",          value: `${s.health}%`, color: hc      },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-right">
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 20,
                  fontWeight: 700,
                  color: color ?? "#0B1A2F",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {value}
              </div>
              <div style={{ fontSize: 11, color: "#8A93A5", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-0 px-6 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF", height: 40 }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 h-full text-[12.5px] font-medium transition-colors relative"
            style={{
              color: tab === t.id ? "#0B1A2F" : "#56627A",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid #1E66C9" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-auto p-5">
        {tab === "overview" && (
          <div className="grid grid-cols-2 gap-4">
            {/* Connectors summary */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20, borderLeft: "3px solid #2E8E3A" }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>Active connectors</h3>
              {s.connectors.map((c, i) => (
                <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: i < s.connectors.length - 1 ? "1px solid #F0F2F6" : undefined }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2E8E3A", flexShrink: 0, display: "inline-block" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium" style={{ color: "#0B1A2F" }}>{c.type}</p>
                    <p className="text-[11px] truncate" style={{ color: "#8A93A5", fontFamily: "'JetBrains Mono', monospace" }}>{c.endpoint}</p>
                  </div>
                  <span className="text-[11px]" style={{ color: "#8A93A5" }}>{c.lastPoll} ago</span>
                </div>
              ))}
            </div>

            {/* Volume chart placeholder */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20 }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>Crossing volume · last 7 days</h3>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
                {[42, 58, 71, 63, 88, 74, 95].map((v, i) => (
                  <div
                    key={i}
                    style={{ flex: 1, borderRadius: "3px 3px 0 0", background: i === 6 ? "#2E8E3A" : "#E2F1E2", height: `${v}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i} style={{ fontSize: 10, color: "#8A93A5", flex: 1, textAlign: "center" }}>{d}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "mappings" && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20 }}>
            <p style={{ fontSize: 13, color: "#56627A" }}>
              Showing mappings for {s.name}. See full{" "}
              <a href="/library/mappings" style={{ color: "#1E66C9" }}>Mapping Editor</a>{" "}
              for all supplier pairs.
            </p>
          </div>
        )}

        {(tab === "rules" || tab === "templates" || tab === "connectors" || tab === "history") && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "64px 32px",
              textAlign: "center",
              color: "#8A93A5",
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 32, marginBottom: 12 }}>⊘</span>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)} for {s.name}
            </p>
            <p style={{ fontSize: 13 }}>Coming soon in Phase 4 Group C.</p>
          </div>
        )}
      </div>
    </div>
  );
}
