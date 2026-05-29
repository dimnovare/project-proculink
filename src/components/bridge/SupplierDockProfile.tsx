"use client";

// Supplier Dock Profile — /library/suppliers/[id]
// §5.8 — Header + tabs: Overview · Mappings · Rules · Output templates · Connectors · History

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PoMappingEditor } from "./PoMappingEditor";
import { DeliveryConfigEditor } from "./DeliveryConfigEditor";
import { upsertPoMapping, deletePoMapping } from "@/lib/api/mapping";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { PoMappingConfig } from "@/lib/api/types";

type Tab = "overview" | "mappings" | "po-mapping" | "delivery" | "rules" | "templates" | "connectors" | "history";

// Demo data — only rendered when isApiMockMode is true (dev, never production)
const DEMO_MOCK = {
  id:            "s1",
  name:          "Acme Components",
  code:          "ACM",
  health:        97,
  totalOrders:   3218,
  avgCycle:      "1m 38s",
  exceptionRate: "2.1%",
  formats:       ["cXML", "EDI", "API"] as string[],
  connectors: [
    { type: "cXML PunchOut", endpoint: "https://acme.example.com/cxml/orders", lastPoll: "1m" },
    { type: "API (REST)",    endpoint: "https://api.acme.example.com/v2/po",   lastPoll: "30s" },
  ],
};

function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview",    label: "Overview"          },
  { id: "mappings",    label: "Mappings"          },
  { id: "po-mapping",  label: "PO Mapping"        },
  { id: "delivery",    label: "Delivery"          },
  { id: "rules",       label: "Rules"             },
  { id: "templates",   label: "Output templates"  },
  { id: "connectors",  label: "Connectors"        },
  { id: "history",     label: "History"           },
];

export function SupplierDockProfile({ id }: { id: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [poMappingConfig, setPoMappingConfig] = useState<PoMappingConfig | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const hc = "#2E8E3A";

  const { data: supplierList, isLoading, error } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: !isApiMockMode,
  });

  // In mock mode: all fields come from DEMO_MOCK.
  // In real mode: only name comes from the API; metrics show honest placeholders.
  const realSupplier = !isApiMockMode
    ? (supplierList?.find(s => s.id === id) ?? null)
    : null;

  const name = isApiMockMode ? DEMO_MOCK.name : (realSupplier?.name ?? "");
  const code = isApiMockMode ? DEMO_MOCK.code : (realSupplier ? deriveCode(realSupplier.name) : "—");

  if (!isApiMockMode && isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 13, color: "#8A93A5" }}>Loading supplier…</span>
      </div>
    );
  }

  if (!isApiMockMode && error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 13, color: "#C53A3A" }}>Failed to load supplier</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: "#1E66C9", background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to suppliers
        </button>
      </div>
    );
  }

  if (!isApiMockMode && !isLoading && realSupplier === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F" }}>Supplier not found</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: "#1E66C9", background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to suppliers
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <button
          onClick={() => router.push("/library/suppliers")}
          className="text-[12.5px] font-medium mt-1 flex-shrink-0"
          style={{ color: "#56627A", background: "none", border: "none", cursor: "pointer" }}
        >
          ← Suppliers
        </button>

        <div className="flex min-w-0 items-center gap-3">
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
            {code}
          </div>

          <div className="min-w-0">
            <h1
              className="text-[22px] font-semibold tracking-[-0.02em]"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
            >
              {name}
            </h1>
            {isApiMockMode && DEMO_MOCK.formats.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {DEMO_MOCK.formats.map((f) => (
                  <span key={f} className="text-[10.5px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EFF2F7", color: "#56627A" }}>
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid w-full grid-cols-2 gap-3 lg:ml-auto lg:w-auto lg:flex lg:items-center lg:gap-6 lg:flex-shrink-0">
          {(isApiMockMode
            ? [
                { label: "Total orders",   value: DEMO_MOCK.totalOrders.toLocaleString(), color: undefined },
                { label: "Avg cycle",      value: DEMO_MOCK.avgCycle,                     color: undefined },
                { label: "Exception rate", value: DEMO_MOCK.exceptionRate,                color: undefined },
                { label: "Health",         value: `${DEMO_MOCK.health}%`,                 color: hc        },
              ]
            : [
                { label: "Total orders",   value: "—", color: undefined },
                { label: "Avg cycle",      value: "—", color: undefined },
                { label: "Exception rate", value: "—", color: undefined },
                { label: "Health",         value: "—", color: undefined },
              ]
          ).map(({ label, value, color }) => (
            <div key={label} className="rounded-[7px] bg-[#F6F7FA] px-3 py-2 text-left lg:bg-transparent lg:p-0 lg:text-right">
              <div
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 20,
                  fontWeight: 700,
                  color: color ?? (isApiMockMode ? "#0B1A2F" : "#C6CDDA"),
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
        className="flex items-center gap-0 overflow-x-auto px-4 sm:px-6 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF", height: 40 }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="h-full shrink-0 px-4 text-[12.5px] font-medium transition-colors relative"
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
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Connectors summary */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20, borderLeft: "3px solid #2E8E3A" }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>Active connectors</h3>
              {isApiMockMode ? (
                DEMO_MOCK.connectors.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: i < DEMO_MOCK.connectors.length - 1 ? "1px solid #F0F2F6" : undefined }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2E8E3A", flexShrink: 0, display: "inline-block" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium" style={{ color: "#0B1A2F" }}>{c.type}</p>
                      <p className="text-[11px] truncate" style={{ color: "#8A93A5", fontFamily: "'JetBrains Mono', monospace" }}>{c.endpoint}</p>
                    </div>
                    <span className="text-[11px]" style={{ color: "#8A93A5" }}>{c.lastPoll} ago</span>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, color: "#8A93A5" }}>
                  No connectors configured. Set one up in the{" "}
                  <button
                    onClick={() => setTab("delivery")}
                    style={{ color: "#1E66C9", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                  >
                    Delivery
                  </button>{" "}
                  tab.
                </p>
              )}
            </div>

            {/* Volume chart */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20 }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>Crossing volume · last 7 days</h3>
              {isApiMockMode ? (
                <>
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
                </>
              ) : (
                <p style={{ fontSize: 13, color: "#8A93A5" }}>Volume data not available yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === "mappings" && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20 }}>
            <p style={{ fontSize: 13, color: "#56627A" }}>
              Showing mappings for {name}. See full{" "}
              <a href="/library/mappings" style={{ color: "#1E66C9" }}>Mapping Editor</a>{" "}
              for all supplier pairs.
            </p>
          </div>
        )}

        {tab === "po-mapping" && (
          <PoMappingEditor
            supplierId={id}
            initialConfig={poMappingConfig}
            saving={savingMapping}
            onSave={async (config) => {
              setSavingMapping(true);
              try {
                const saved = await upsertPoMapping(id, config);
                setPoMappingConfig(saved);
              } finally {
                setSavingMapping(false);
              }
            }}
            onDelete={
              poMappingConfig
                ? async () => {
                    await deletePoMapping(id);
                    setPoMappingConfig(null);
                  }
                : undefined
            }
          />
        )}

        {tab === "delivery" && <DeliveryConfigEditor supplierId={id} />}

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
              {tab.charAt(0).toUpperCase() + tab.slice(1)} for {name}
            </p>
            <p style={{ fontSize: 13 }}>Coming soon in Phase 4 Group C.</p>
          </div>
        )}
      </div>
    </div>
  );
}
