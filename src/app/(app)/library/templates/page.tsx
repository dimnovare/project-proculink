"use client";
const TEMPLATES = [
  { id: "t1", name: "Standard cXML PO",      fmt: "cXML",  suppliers: 3, lastUsed: "2m",  version: "v3.2"  },
  { id: "t2", name: "SAP IDoc ORDERS05",      fmt: "EDI",   suppliers: 2, lastUsed: "1h",  version: "v2.0"  },
  { id: "t3", name: "ERP Generic v2",         fmt: "JSON",  suppliers: 4, lastUsed: "3h",  version: "v2.1"  },
  { id: "t4", name: "Custom Nordmark",        fmt: "CSV",   suppliers: 1, lastUsed: "1d",  version: "v1.4"  },
  { id: "t5", name: "MedicaSupply OY cXML",   fmt: "cXML",  suppliers: 1, lastUsed: "4m",  version: "v1.0"  },
];
const FMT_COLOR: Record<string,string> = { cXML:"#6F4FCE", EDI:"#C97A14", JSON:"#A06200", CSV:"#56627A" };
const FMT_BG:    Record<string,string> = { cXML:"#EEE7FB", EDI:"#FAEFD6", JSON:"#FFF4D6", CSV:"#EFF2F7" };

export default function TemplatesPage() {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex items-end gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Output templates</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{TEMPLATES.length} templates · used across {TEMPLATES.reduce((a,t)=>a+t.suppliers,0)} supplier docks</p>
        </div>
        <button className="ml-auto rounded-[6px] px-3 text-[12.5px] font-medium" style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>+ New template</button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))" }}>
          {TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-[8px] cursor-pointer" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderTop: `3px solid ${FMT_COLOR[t.fmt] ?? "#56627A"}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: FMT_BG[t.fmt]??"#EFF2F7", color: FMT_COLOR[t.fmt]??"#56627A" }}>{t.fmt}</span>
                  <span className="text-[10.5px] font-mono" style={{ color: "#8A93A5" }}>{t.version}</span>
                </div>
                <h3 className="text-[13.5px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>{t.name}</h3>
                <div className="flex items-center gap-3 text-[11.5px]" style={{ color: "#56627A" }}>
                  <span>{t.suppliers} supplier{t.suppliers !== 1?"s":""}</span>
                  <span style={{ color: "#E2E6EE" }}>·</span>
                  <span>last used {t.lastUsed} ago</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
