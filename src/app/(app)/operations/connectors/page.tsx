"use client";

// §5.9 Connectors — wire-topology overview for connectors (email inboxes, SFTP, API, cXML PunchOut, webhooks)
import { EmptyState } from "@/components/bridge/EmptyState";

const CONNECTORS = [
  { id: "c1", type: "cXML PunchOut", name: "Acme Components",     status: "ok",   lastPoll: "30s",  errors24h: 0,  direction: "out" },
  { id: "c2", type: "API (REST)",    name: "Nordix Distribution",  status: "ok",   lastPoll: "1m",   errors24h: 0,  direction: "out" },
  { id: "c3", type: "EDI (SFTP)",    name: "MedicaSupply OY",      status: "risk", lastPoll: "12m",  errors24h: 3,  direction: "out" },
  { id: "c4", type: "Email inbox",   name: "orders@company.com",   status: "ok",   lastPoll: "5m",   errors24h: 0,  direction: "in"  },
  { id: "c5", type: "Email inbox",   name: "po@nordic.example",    status: "ok",   lastPoll: "5m",   errors24h: 0,  direction: "in"  },
  { id: "c6", type: "API (REST)",    name: "BoltWorks BV",         status: "down", lastPoll: "1h",   errors24h: 11, direction: "out" },
  { id: "c7", type: "cXML PunchOut", name: "VanDerBerg Metaal",    status: "ok",   lastPoll: "2m",   errors24h: 0,  direction: "out" },
];

const STATUS_COLOR: Record<string,string> = { ok: "#2E8E3A", risk: "#C97A14", down: "#C53A3A" };
const STATUS_BG:    Record<string,string> = { ok: "#E2F1E2", risk: "#FAEFD6", down: "#FBE3E3" };
const DIR_COLOR: Record<string,string>    = { in: "#1E66C9", out: "#2E8E3A" };

export default function ConnectorsPage() {
  const ok   = CONNECTORS.filter((c) => c.status === "ok").length;
  const risk = CONNECTORS.filter((c) => c.status === "risk").length;
  const down = CONNECTORS.filter((c) => c.status === "down").length;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex items-end gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Connectors</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {ok} healthy · {risk > 0 && <span style={{ color: "#C97A14" }}>{risk} at risk · </span>}{down > 0 && <span style={{ color: "#C53A3A" }}>{down} down</span>}
          </p>
        </div>
        <button className="ml-auto rounded-[6px] px-3 text-[12.5px] font-medium" style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>+ Add connector</button>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Healthy",  value: ok,   color: "#2E8E3A", bg: "#E2F1E2" },
            { label: "At risk",  value: risk,  color: "#C97A14", bg: "#FAEFD6" },
            { label: "Down",     value: down,  color: "#C53A3A", bg: "#FBE3E3" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderLeft: `3px solid ${s.color}` }}>
              <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, color: s.value > 0 ? s.color : "#C6CDDA", lineHeight: 1 }}>{s.value}</span>
              <span style={{ fontSize: 13, color: "#56627A" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Connector list */}
        {CONNECTORS.length === 0 ? (
          <EmptyState
            icon="⇄"
            title="No connectors configured"
            sub="Add a connector to start receiving orders from email inboxes, SFTP drops, APIs, or cXML PunchOut."
            action={{ label: "+ Add connector", onClick: () => {} }}
          />
        ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
          <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                {["Status","Type","Name / Endpoint","Direction","Last poll","Errors 24h",""].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONNECTORS.map((c) => (
                <tr key={c.id} className="group" style={{ borderBottom: "1px solid #F0F2F6", cursor: "pointer" }} onMouseEnter={(e)=>((e.currentTarget as HTMLElement).style.background="#F6F7FA")} onMouseLeave={(e)=>((e.currentTarget as HTMLElement).style.background="transparent")}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_BG[c.status], color: STATUS_COLOR[c.status] }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[c.status], flexShrink: 0, display: "inline-block" }} />
                      {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: "#56627A" }}>{c.type}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: "#0B1A2F" }}>{c.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${DIR_COLOR[c.direction]}18`, color: DIR_COLOR[c.direction] }}>
                      {c.direction === "in" ? "← In" : "Out →"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: "#8A93A5" }}>{c.lastPoll} ago</td>
                  <td className="px-4 py-3 font-mono text-[12px]" style={{ color: c.errors24h > 0 ? "#C53A3A" : "#8A93A5" }}>{c.errors24h}</td>
                  <td className="px-4 py-3">
                    <button className="opacity-0 group-hover:opacity-100 rounded px-2 py-1 text-[11.5px] font-medium transition-opacity" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Configure</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
