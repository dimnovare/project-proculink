"use client";

// Validation Rules — card-grid/list of active crossing rules.
// Severity: error | warning | info. Each card shows trigger count + toggle.

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = "error" | "warning" | "info";
type Entity   = "Line item" | "Header" | "Supplier" | "Buyer" | "Amount";

type Rule = {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  entity: Entity;
  triggers: number;
  enabled: boolean;
  autoBlock: boolean;
  lastTriggered: string;
};

// ─── Mock data ────────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  {
    id: "r1",
    name: "Missing unit price",
    description: "Line item has no unit price set. Order cannot be crossed without valid pricing.",
    severity: "error",
    entity: "Line item",
    triggers: 14,
    enabled: true,
    autoBlock: true,
    lastTriggered: "2m",
  },
  {
    id: "r2",
    name: "Unknown buyer code",
    description: "Buyer product code not found in mapping table. Manual mapping required.",
    severity: "error",
    entity: "Line item",
    triggers: 31,
    enabled: true,
    autoBlock: true,
    lastTriggered: "6m",
  },
  {
    id: "r3",
    name: "Order total mismatch",
    description: "Sum of line amounts does not match the header total. Tolerance: ±€0.01.",
    severity: "error",
    entity: "Amount",
    triggers: 7,
    enabled: true,
    autoBlock: true,
    lastTriggered: "1h",
  },
  {
    id: "r4",
    name: "Delivery date in the past",
    description: "Requested delivery date is earlier than today. Buyer should confirm.",
    severity: "warning",
    entity: "Header",
    triggers: 22,
    enabled: true,
    autoBlock: false,
    lastTriggered: "14m",
  },
  {
    id: "r5",
    name: "Low confidence extraction",
    description: "AI extraction confidence below 70% for one or more fields. Requires manual sign-off.",
    severity: "warning",
    entity: "Line item",
    triggers: 41,
    enabled: true,
    autoBlock: false,
    lastTriggered: "2m",
  },
  {
    id: "r6",
    name: "Supplier dock inactive",
    description: "The assigned supplier dock has been deactivated. Route will be blocked.",
    severity: "error",
    entity: "Supplier",
    triggers: 3,
    enabled: true,
    autoBlock: true,
    lastTriggered: "3d",
  },
  {
    id: "r7",
    name: "Currency mismatch",
    description: "Order currency does not match the supplier's preferred currency setting.",
    severity: "warning",
    entity: "Header",
    triggers: 9,
    enabled: true,
    autoBlock: false,
    lastTriggered: "4h",
  },
  {
    id: "r8",
    name: "Duplicate PO number",
    description: "A crossing with this PO number was already processed in the last 30 days.",
    severity: "error",
    entity: "Header",
    triggers: 2,
    enabled: true,
    autoBlock: true,
    lastTriggered: "2d",
  },
  {
    id: "r9",
    name: "Missing GTIN",
    description: "Line item is missing a GTIN/EAN barcode. Informational only for reporting.",
    severity: "info",
    entity: "Line item",
    triggers: 88,
    enabled: false,
    autoBlock: false,
    lastTriggered: "—",
  },
  {
    id: "r10",
    name: "Line quantity is zero",
    description: "Ordered quantity is 0. Likely a cancellation line — flag for review.",
    severity: "warning",
    entity: "Line item",
    triggers: 5,
    enabled: true,
    autoBlock: false,
    lastTriggered: "1d",
  },
  {
    id: "r11",
    name: "Buyer not recognised",
    description: "Buyer identifier not present in any buyer dock configuration.",
    severity: "error",
    entity: "Buyer",
    triggers: 1,
    enabled: true,
    autoBlock: true,
    lastTriggered: "1w",
  },
  {
    id: "r12",
    name: "Large order threshold",
    description: "Order value exceeds €50,000. Requires approval from a manager before crossing.",
    severity: "info",
    entity: "Amount",
    triggers: 17,
    enabled: true,
    autoBlock: false,
    lastTriggered: "3h",
  },
];

// ─── Visual maps ─────────────────────────────────────────────────────────────

const SEV: Record<Severity, { bg: string; color: string; border: string; label: string; icon: string }> = {
  error:   { bg: "#FBE3E3", color: "#C53A3A", border: "#F5C0C0", label: "Error",   icon: "✕" },
  warning: { bg: "#FAEFD6", color: "#C97A14", border: "#F0D98A", label: "Warning", icon: "⚠" },
  info:    { bg: "#E3EDFB", color: "#1E66C9", border: "#B8CFF5", label: "Info",    icon: "ℹ" },
};

const ENTITY_COLOR: Record<Entity, string> = {
  "Line item": "#6F4FCE",
  "Header":    "#0F4FA8",
  "Supplier":  "#2E8E3A",
  "Buyer":     "#1E66C9",
  "Amount":    "#C97A14",
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 99,
        background: on ? "#1E66C9" : "#C6CDDA",
        border: "none",
        padding: 0,
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#FFFFFF",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ValidationRules() {
  const [rules, setRules] = useState(RULES);
  const [sevFilter, setSev] = useState<Severity | "All">("All");
  const [entityFilter, setEntity] = useState<Entity | "All">("All");
  const [view, setView]   = useState<"grid" | "list">("grid");

  const filtered = rules.filter((r) => {
    const ms = sevFilter === "All" || r.severity === sevFilter;
    const me = entityFilter === "All" || r.entity === entityFilter;
    return ms && me;
  });

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }

  const counts = {
    error:   rules.filter((r) => r.severity === "error").length,
    warning: rules.filter((r) => r.severity === "warning").length,
    info:    rules.filter((r) => r.severity === "info").length,
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background: "#F6F7FA" }}
    >
      {/* Page header */}
      <div
        className="flex items-end gap-4 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: "#0B1A2F",
            }}
          >
            Validation Rules
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {rules.filter((r) => r.enabled).length} active rules ·{" "}
            {counts.error} errors · {counts.warning} warnings · {counts.info} info
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {/* View toggle */}
          <div
            className="flex rounded-[6px] overflow-hidden text-[12px]"
            style={{ border: "1px solid #E2E6EE" }}
          >
            <button
              className="px-3 py-1.5 font-medium"
              style={{
                background: view === "grid" ? "#0B1A2F" : "#FFFFFF",
                color: view === "grid" ? "#FFFFFF" : "#56627A",
                borderRight: "1px solid #E2E6EE",
              }}
              onClick={() => setView("grid")}
            >
              ▦ Grid
            </button>
            <button
              className="px-3 py-1.5 font-medium"
              style={{
                background: view === "list" ? "#0B1A2F" : "#FFFFFF",
                color: view === "list" ? "#FFFFFF" : "#56627A",
              }}
              onClick={() => setView("list")}
            >
              ≡ List
            </button>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: 0,
            }}
          >
            + New rule
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div
        className="flex items-center gap-2 px-5 flex-shrink-0"
        style={{
          height: 44,
          borderBottom: "1px solid #E2E6EE",
          background: "#FFFFFF",
        }}
      >
        {(["All", "error", "warning", "info"] as const).map((s) => {
          const active = sevFilter === s;
          const sev = s !== "All" ? SEV[s] : null;
          return (
            <button
              key={s}
              onClick={() => setSev(s)}
              className="flex items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors"
              style={{
                height: 26,
                border: `1px solid ${active && sev ? sev.border : active ? "#1E66C933" : "#E2E6EE"}`,
                background: active && sev ? sev.bg : active ? "#E3EDFB" : "#FFFFFF",
                color: active && sev ? sev.color : active ? "#0F4FA8" : "#0B1A2F",
              }}
            >
              {sev && <span>{sev.icon}</span>}
              <span className="capitalize">{s === "All" ? `All (${rules.length})` : sev!.label}</span>
            </button>
          );
        })}

        <div className="w-px h-5 mx-1" style={{ background: "#E2E6EE" }} />

        {/* Entity filter */}
        <select
          value={entityFilter}
          onChange={(e) => setEntity(e.target.value as Entity | "All")}
          className="rounded-[5px] px-2.5 text-[12px] appearance-none"
          style={{
            height: 26,
            border: "1px solid #E2E6EE",
            background: "#FFFFFF",
            color: "#0B1A2F",
            outline: "none",
          }}
        >
          <option value="All">All entities</option>
          {(["Line item", "Header", "Supplier", "Buyer", "Amount"] as Entity[]).map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {view === "grid" ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}
          >
            {filtered.map((rule) => {
              const sev = SEV[rule.severity];
              const ec  = ENTITY_COLOR[rule.entity];
              return (
                <div
                  key={rule.id}
                  className="rounded-[8px] overflow-hidden"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                    opacity: rule.enabled ? 1 : 0.55,
                    transition: "opacity 0.2s",
                    borderLeft: `3px solid ${sev.color}`,
                  }}
                >
                  <div className="p-4">
                    {/* Top row */}
                    <div className="flex items-start gap-2 mb-2">
                      <span
                        className="inline-flex items-center justify-center rounded-full text-[11px] font-bold flex-shrink-0"
                        style={{
                          width: 22,
                          height: 22,
                          background: sev.bg,
                          color: sev.color,
                        }}
                      >
                        {sev.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-[13px] font-semibold truncate"
                          style={{ color: "#0B1A2F" }}
                        >
                          {rule.name}
                        </p>
                        <p
                          className="text-[11.5px] mt-0.5 leading-snug"
                          style={{ color: "#56627A" }}
                        >
                          {rule.description}
                        </p>
                      </div>
                      <Toggle on={rule.enabled} onChange={() => toggleRule(rule.id)} />
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-3">
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: `${ec}18`, color: ec }}
                      >
                        {rule.entity}
                      </span>
                      {rule.autoBlock && (
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ background: "#FBE3E3", color: "#C53A3A" }}
                        >
                          Auto-block
                        </span>
                      )}
                      <span className="flex-1" />
                      <span
                        className="text-[11px] font-mono font-semibold"
                        style={{ color: sev.color }}
                      >
                        {rule.triggers} triggers
                      </span>
                      <span className="text-[11px]" style={{ color: "#8A93A5" }}>
                        · {rule.lastTriggered === "—" ? "never" : `${rule.lastTriggered} ago`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view */
          <div
            className="rounded-[8px] overflow-hidden"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
            }}
          >
            <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                  {["", "Rule", "Entity", "Severity", "Triggers", "Last triggered", "Auto-block", "Enabled"].map(
                    (h, i) => (
                      <th
                        key={i}
                        className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                        style={{ color: "#8A93A5" }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => {
                  const sev = SEV[rule.severity];
                  const ec  = ENTITY_COLOR[rule.entity];
                  return (
                    <tr
                      key={rule.id}
                      style={{
                        borderBottom: "1px solid #F0F2F6",
                        opacity: rule.enabled ? 1 : 0.55,
                      }}
                    >
                      <td className="pl-4 py-3" style={{ width: 6 }}>
                        <div
                          style={{
                            width: 3,
                            height: 24,
                            borderRadius: 99,
                            background: sev.color,
                          }}
                        />
                      </td>
                      <td className="px-4 py-3" style={{ maxWidth: 280 }}>
                        <p className="font-medium text-[13px]" style={{ color: "#0B1A2F" }}>
                          {rule.name}
                        </p>
                        <p className="text-[11.5px] text-[#8A93A5] truncate">{rule.description}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ background: `${ec}18`, color: ec }}
                        >
                          {rule.entity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ background: sev.bg, color: sev.color }}
                        >
                          {sev.icon} {sev.label}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 font-mono text-[12px] font-semibold"
                        style={{ color: sev.color }}
                      >
                        {rule.triggers}
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: "#8A93A5" }}>
                        {rule.lastTriggered === "—" ? "Never" : `${rule.lastTriggered} ago`}
                      </td>
                      <td className="px-4 py-3">
                        {rule.autoBlock ? (
                          <span
                            className="text-[10.5px] font-semibold"
                            style={{ color: "#C53A3A" }}
                          >
                            Yes
                          </span>
                        ) : (
                          <span style={{ color: "#8A93A5" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Toggle on={rule.enabled} onChange={() => toggleRule(rule.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
