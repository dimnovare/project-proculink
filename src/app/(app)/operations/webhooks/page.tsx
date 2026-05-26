"use client";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useRouter } from "next/navigation";

const WEBHOOKS = [
  { id: "w1", url: "https://erp.company.com/hooks/proculink", events: ["crossing.sent","crossing.failed"], status: "ok",   deliveries24h: 142, lastDelivery: "1m"  },
  { id: "w2", url: "https://slack.example.com/T012/proculink", events: ["crossing.failed"],                status: "ok",   deliveries24h:  8,  lastDelivery: "3h"  },
  { id: "w3", url: "https://legacy.example.com/hook",          events: ["crossing.sent"],                  status: "down", deliveries24h:  0,  lastDelivery: "2d"  },
];
const STATUS_COLOR: Record<string,string> = { ok:"#2E8E3A", down:"#C53A3A" };
const STATUS_BG: Record<string,string>    = { ok:"#E2F1E2", down:"#FBE3E3" };

export default function WebhooksPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Webhooks</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{WEBHOOKS.length} endpoints · {WEBHOOKS.filter(w=>w.status==="ok").length} healthy</p>
        </div>
        <button className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto" style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>+ Add webhook</button>
      </div>
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {WEBHOOKS.length === 0 ? (
          <EmptyState
            icon="⚡"
            title="No webhooks configured"
            sub="Register a webhook endpoint to receive real-time notifications for crossing events."
            action={{ label: "+ Add webhook", onClick: () => {} }}
          />
        ) : (
        <div className="flex flex-col gap-3">
          {WEBHOOKS.map((w) => (
            <div key={w.id} className="rounded-[8px]" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderLeft: `3px solid ${STATUS_COLOR[w.status]}` }}>
              <div className="grid gap-2 px-4 py-3.5 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] lg:items-center lg:gap-4">
                <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0" style={{ background: STATUS_BG[w.status], color: STATUS_COLOR[w.status] }}>
                  <span style={{ width: 5, height: 5, borderRadius:"50%", background: STATUS_COLOR[w.status], display:"inline-block" }} />
                  {w.status === "ok" ? "Active" : "Down"}
                </span>
                <span className="font-mono text-[11.5px] flex-1 truncate" style={{ color: "#0F4FA8" }}>{w.url}</span>
                <div className="flex flex-wrap gap-1.5 flex-shrink-0">
                  {w.events.map((e) => <span key={e} className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EFF2F7", color: "#56627A" }}>{e}</span>)}
                </div>
                <span style={{ fontSize: 11.5, color: "#56627A", flexShrink: 0 }}>{w.deliveries24h} deliveries</span>
                <span style={{ fontSize: 11, color: "#8A93A5", flexShrink: 0 }}>last: {w.lastDelivery} ago</span>
                <button className="rounded px-2 py-1 text-[11.5px] font-medium flex-shrink-0" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Edit</button>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
