"use client";
import { useRouter } from "next/navigation";

const BUYERS = [
  { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", volume: "412/wk", formats: ["PDF","XLSX"],  orders: 1820, lastCrossing: "2m"  },
  { id: "b2", name: "Nordmark Logistics A/S",    code: "NRD", volume: "287/wk", formats: ["cXML","EDI"], orders: 1104, lastCrossing: "14m" },
  { id: "b3", name: "Steelhouse Construction",   code: "SHC", volume: "198/wk", formats: ["XLSX","CSV"], orders:  812, lastCrossing: "1h"  },
  { id: "b4", name: "Centralis Pharma",          code: "CPH", volume: "94/wk",  formats: ["EDI"],        orders:  401, lastCrossing: "3h"  },
  { id: "b5", name: "Westmark Tools",            code: "WMT", volume: "76/wk",  formats: ["EMAIL","PDF"],orders:  310, lastCrossing: "22m" },
  { id: "b6", name: "Atlas Reseller AG",         code: "ARA", volume: "142/wk", formats: ["XLSX","API"], orders:  571, lastCrossing: "1h"  },
];

export default function BuyersPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex items-end gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Buyer docks</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{BUYERS.length} active buyers</p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium" style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>+ Add buyer dock</button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="flex flex-col gap-3">
          {BUYERS.map((b) => (
            <div key={b.id} onClick={() => router.push(`/inbox?buyer=${b.code}`)} className="group cursor-pointer rounded-[8px]" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderLeft: "3px solid #1E66C9" }}>
              <div className="flex items-center gap-4 px-4 py-4">
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#E3EDFB", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 800, color: "#1E66C9", flexShrink: 0 }}>{b.code}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>{b.name}</p>
                  <div className="flex items-center gap-1.5 mt-1">{b.formats.map((f) => <span key={f} className="text-[10.5px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EFF2F7", color: "#56627A" }}>{f}</span>)}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, color: "#0B1A2F", lineHeight: 1 }}>{b.volume}</p>
                  <p style={{ fontSize: 11, color: "#8A93A5", marginTop: 2 }}>volume</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, color: "#0B1A2F", lineHeight: 1 }}>{b.orders.toLocaleString()}</p>
                  <p style={{ fontSize: 11, color: "#8A93A5", marginTop: 2 }}>total crossings</p>
                </div>
                <div className="text-right flex-shrink-0" style={{ minWidth: 70 }}>
                  <p style={{ fontSize: 11, color: "#8A93A5" }}>last crossing</p>
                  <p style={{ fontSize: 12, fontWeight: 500, color: "#56627A" }}>{b.lastCrossing} ago</p>
                </div>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[14px]" style={{ color: "#C6CDDA" }}>→</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
