"use client";
import { useState } from "react";

type SettingsTab = "workspace" | "billing" | "email" | "team" | "api";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "workspace", label: "Workspace"   },
  { id: "billing",   label: "Billing"     },
  { id: "email",     label: "Email polling"},
  { id: "team",      label: "Team"        },
  { id: "api",       label: "API keys"    },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("workspace");

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Settings</h1>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav className="flex-shrink-0 py-4" style={{ width: 200, background: "#FFFFFF", borderRight: "1px solid #E2E6EE" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="w-full flex items-center px-4 py-2 text-[13px] font-medium text-left transition-colors" style={{ color: tab === t.id ? "#0B1A2F" : "#56627A", background: tab === t.id ? "#F0F2F7" : "transparent", borderLeft: `2px solid ${tab === t.id ? "#1E66C9" : "transparent"}`, border: "none", cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {tab === "workspace" && (
            <div style={{ maxWidth: 520 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0B1A2F", marginBottom: 20 }}>Workspace settings</h2>
              {[
                { label: "Organisation name", value: "Nordic Distribution", type: "text" },
                { label: "Workspace ID",       value: "nd-4f91a2",          type: "text", mono: true, readOnly: true },
                { label: "Default currency",   value: "EUR",                type: "text" },
              ].map((f) => (
                <div key={f.label} style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#56627A", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</label>
                  <input defaultValue={f.value} readOnly={f.readOnly} type={f.type} style={{ width: "100%", border: "1px solid #E2E6EE", borderRadius: 7, padding: "9px 12px", fontSize: 13, fontFamily: f.mono ? "'JetBrains Mono', monospace" : undefined, color: f.readOnly ? "#8A93A5" : "#0B1A2F", background: f.readOnly ? "#F6F7FA" : "#FFFFFF", outline: "none" }} />
                </div>
              ))}
              <button style={{ borderRadius: 7, padding: "9px 20px", fontSize: 13, fontWeight: 600, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: "pointer" }}>Save changes</button>
            </div>
          )}

          {tab === "billing" && (
            <div style={{ maxWidth: 520 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0B1A2F", marginBottom: 20 }}>Billing</h2>
              <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20, marginBottom: 16, borderLeft: "3px solid #1E66C9" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1E66C9", marginBottom: 4 }}>Current plan</div>
                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 24, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>Starter · Free</div>
                <p style={{ fontSize: 13, color: "#56627A" }}>72 crossings used this month · 100 limit</p>
                <div style={{ height: 5, background: "#E2E6EE", borderRadius: 99, overflow: "hidden", marginTop: 12 }}>
                  <div style={{ width: "72%", height: "100%", background: "#1E66C9", borderRadius: 99 }} />
                </div>
              </div>
              <button style={{ borderRadius: 7, padding: "10px 24px", fontSize: 13, fontWeight: 600, background: "linear-gradient(90deg,#1E66C9,#2E8E3A)", color: "#FFFFFF", border: "none", cursor: "pointer" }}>Upgrade to Growth — €49/mo</button>
            </div>
          )}

          {(tab === "email" || tab === "team" || tab === "api") && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 32px", textAlign: "center", color: "#8A93A5" }}>
              <span style={{ fontSize: 32, marginBottom: 12 }}>⊘</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>{TABS.find(t=>t.id===tab)?.label} settings</p>
              <p style={{ fontSize: 13 }}>Coming in Phase 4 Groups E–H.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
