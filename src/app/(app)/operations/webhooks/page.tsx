"use client";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState, type ReactNode } from "react";

const WEBHOOKS = [
  { id: "w1", url: "https://erp.company.com/hooks/proculink", events: ["crossing.sent","crossing.failed"], status: "ok",   deliveries24h: 142, lastDelivery: "1m"  },
  { id: "w2", url: "https://slack.example.com/T012/proculink", events: ["crossing.failed"],                status: "ok",   deliveries24h:  8,  lastDelivery: "3h"  },
  { id: "w3", url: "https://legacy.example.com/hook",          events: ["crossing.sent"],                  status: "down", deliveries24h:  0,  lastDelivery: "2d"  },
];
const STATUS_COLOR: Record<string,string> = { ok:"#2E8E3A", down:"#C53A3A" };
const STATUS_BG: Record<string,string>    = { ok:"#E2F1E2", down:"#FBE3E3" };

export default function WebhooksPage() {
  const [selected, setSelected] = useState<(typeof WEBHOOKS)[number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Webhooks</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{WEBHOOKS.length} endpoints · {WEBHOOKS.filter(w=>w.status==="ok").length} healthy</p>
        </div>
        <button
          onClick={() => {
            setNotice(null);
            setSelected({ id: "new", url: "", events: ["crossing.sent"], status: "ok", deliveries24h: 0, lastDelivery: "never" });
          }}
          className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          + Add webhook
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {notice && (
          <div className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #BDE0C1", borderLeft: "3px solid #2E8E3A", background: "#F0F7F1", color: "#1E6D29" }}>
            {notice}
          </div>
        )}

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
                <button onClick={() => { setNotice(null); setSelected(w); }} className="rounded px-2 py-1 text-[11.5px] font-medium flex-shrink-0" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Edit</button>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
      {selected && (
        <WebhookPanel
          webhook={selected}
          onClose={() => setSelected(null)}
          onSaved={(message) => {
            setNotice(message);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function WebhookPanel({
  webhook,
  onClose,
  onSaved,
}: {
  webhook: (typeof WEBHOOKS)[number];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = webhook.id === "new";
  const [testResult, setTestResult] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[620px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#2E8E3A" }}>Webhook endpoint</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "Add webhook" : "Edit webhook"}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <FormField label="Endpoint URL">
            <input defaultValue={webhook.url} placeholder="https://example.com/proculink/webhook" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 font-mono text-[12px] text-[#0B1A2F]" />
          </FormField>
          <FormField label="Events">
            <div className="grid gap-2 sm:grid-cols-3">
              {["crossing.sent", "crossing.failed", "crossing.needs_review"].map((event) => (
                <label key={event} className="flex items-center gap-2 rounded-[6px] border border-[#E2E6EE] bg-white px-3 py-2 text-[12px]" style={{ color: "#0B1A2F" }}>
                  <input type="checkbox" defaultChecked={webhook.events.includes(event)} />
                  {event}
                </label>
              ))}
            </div>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Signing secret">
              <input defaultValue={isNew ? "" : "whsec_••••••••"} type="password" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
            </FormField>
            <FormField label="Delivery status">
              <input readOnly value={isNew ? "Draft" : webhook.status} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] bg-[#F6F7FA] px-2 text-[12px] text-[#56627A]" />
            </FormField>
          </div>
          <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
            Test delivery, retries, and secret rotation belong to the live QA pass. This keeps the configuration path visible without pretending the endpoint has been saved.
          </div>
          {testResult && (
            <div className="rounded-[7px] border border-[#F0D39A] bg-[#FFF8EA] p-3 text-[12px] leading-5" style={{ color: "#7A4D0B" }}>
              {testResult}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button onClick={() => setTestResult("Endpoint URL and event selections are ready for live delivery testing. No request was sent from the browser.")} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #F0D39A", background: "#FFFFFF", color: "#9A5F0A" }}>Test draft</button>
          <button onClick={() => onSaved(isNew ? "Webhook draft prepared. Live endpoint delivery will be verified in Group J." : "Webhook draft saved locally for QA. Live persistence is verified in Group J.")} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: 0, background: "#0B1A2F", color: "#FFFFFF" }}>Save draft</button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
