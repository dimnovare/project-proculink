"use client";

// Supplier Docks — /library/suppliers
// List of all supplier dock configurations with health bars + quick actions.

import { useRouter } from "next/navigation";

const SUPPLIERS = [
  { id: "s1", name: "Acme Components",    code: "ACM", health: 97, volume: "610/wk", formats: ["cXML", "EDI"],   contacts: 2, lastCrossing: "2m"  },
  { id: "s2", name: "BoltWorks BV",       code: "BWK", health: 91, volume: "382/wk", formats: ["EDI", "CSV"],    contacts: 1, lastCrossing: "14m" },
  { id: "s3", name: "VanDerBerg Metaal",  code: "VDB", health: 88, volume: "245/wk", formats: ["XLSX", "CSV"],   contacts: 3, lastCrossing: "1h"  },
  { id: "s4", name: "Nordix Distribution",code: "NDX", health: 73, volume: "178/wk", formats: ["API", "JSON"],   contacts: 1, lastCrossing: "3h"  },
  { id: "s5", name: "MedicaSupply OY",    code: "MDS", health: 96, volume: "99/wk",  formats: ["cXML", "PDF"],   contacts: 2, lastCrossing: "4m"  },
];

export function SupplierDockList() {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Supplier docks
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {SUPPLIERS.length} active docks · all connected
          </p>
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium sm:w-auto"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
          >
            + Add supplier dock
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="flex flex-col gap-3">
          {SUPPLIERS.map((s) => {
            const hc = s.health >= 95 ? "#2E8E3A" : s.health >= 85 ? "#C97A14" : "#C53A3A";
            const hb = s.health >= 95 ? "#E2F1E2" : s.health >= 85 ? "#FAEFD6" : "#FBE3E3";
            return (
              <div
                key={s.id}
                onClick={() => router.push(`/library/suppliers/${s.id}`)}
                className="group cursor-pointer rounded-[8px] overflow-hidden"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                  borderLeft: `3px solid ${hc}`,
                }}
              >
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-[44px_minmax(0,1fr)_64px_120px_70px_auto] sm:items-center sm:gap-4">
                  {/* Code badge */}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: `${hc}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      color: hc,
                      flexShrink: 0,
                    }}
                  >
                    {s.code}
                  </div>

                  {/* Name + formats */}
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>
                      {s.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {s.formats.map((f) => (
                        <span
                          key={f}
                          className="text-[10.5px] font-semibold rounded px-1.5 py-0.5"
                          style={{ background: "#EFF2F7", color: "#56627A" }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="text-left sm:text-right" style={{ minWidth: 64 }}>
                    <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F", fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                      {s.volume}
                    </p>
                    <p className="text-[11px]" style={{ color: "#8A93A5" }}>volume</p>
                  </div>

                  {/* Health bar */}
                  <div className="w-full sm:w-[120px]">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10.5px]" style={{ color: "#8A93A5" }}>Health</span>
                      <span className="text-[11.5px] font-bold" style={{ color: hc, fontFamily: "'JetBrains Mono', monospace" }}>
                        {s.health}%
                      </span>
                    </div>
                    <div style={{ height: 4, background: hb, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${s.health}%`, height: "100%", background: hc, borderRadius: 99 }} />
                    </div>
                  </div>

                  {/* Last crossing */}
                  <div className="text-left sm:text-right" style={{ minWidth: 60 }}>
                    <p className="text-[11px]" style={{ color: "#8A93A5" }}>last crossing</p>
                    <p className="text-[12px] font-medium" style={{ color: "#56627A" }}>{s.lastCrossing} ago</p>
                  </div>

                  {/* Arrow */}
                  <span
                    className="hidden opacity-0 group-hover:opacity-100 transition-opacity text-[14px] sm:inline"
                    style={{ color: "#C6CDDA" }}
                  >
                    →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
