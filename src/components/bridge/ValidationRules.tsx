"use client";

// Validation Rules — card-grid/list of active crossing rules.
// Severity: error | warning | info. Each card shows trigger count + toggle.

import { useState, type ReactNode } from "react";

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
  const [selected, setSelected] = useState<Rule | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = rules.filter((r) => {
    const ms = sevFilter === "All" || r.severity === sevFilter;
    const me = entityFilter === "All" || r.entity === entityFilter;
    return ms && me;
  });

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
    setNotice("Rule toggle updated locally for QA. Backend persistence remains for Group J.");
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
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:gap-4 flex-shrink-0"
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
        <div className="flex w-full gap-2 lg:ml-auto lg:w-auto">
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
            onClick={() => {
              setNotice(null);
              setSelected({
              id: "new",
              name: "",
              description: "",
              severity: "warning",
              entity: "Line item",
              triggers: 0,
              enabled: true,
              autoBlock: false,
              lastTriggered: "—",
            });
            }}
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
        className="flex items-center gap-2 overflow-x-auto px-4 sm:px-5 flex-shrink-0"
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

      {notice && (
        <div className="px-4 py-2 sm:px-5" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div className="rounded-[7px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #BDE0C1", background: "#F0F7F1", color: "#1E6D29" }}>
            {notice}
          </div>
        </div>
      )}

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
                      <button
                        onClick={() => { setNotice(null); setSelected(rule); }}
                        className="rounded px-2 py-1 text-[11.5px] font-medium"
                        style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
                      >
                        Edit
                      </button>
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
          <>
          <div className="grid gap-3 md:hidden">
            {filtered.map((rule) => {
              const sev = SEV[rule.severity];
              const ec = ENTITY_COLOR[rule.entity];
              return (
                <button
                  key={rule.id}
                  onClick={() => { setNotice(null); setSelected(rule); }}
                  className="rounded-[8px] bg-white p-4 text-left"
                  style={{ border: "1px solid #E2E6EE", borderLeft: `3px solid ${sev.color}`, opacity: rule.enabled ? 1 : 0.6 }}
                >
                  <div className="mb-2 flex items-start gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: sev.bg, color: sev.color }}>
                      {sev.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>{rule.name}</div>
                      <p className="mt-0.5 text-[11.5px] leading-5" style={{ color: "#56627A" }}>{rule.description}</p>
                    </div>
                    <span className="rounded px-2 py-1 text-[11px] font-semibold" style={{ background: rule.enabled ? "#E3EDFB" : "#EFF2F7", color: rule.enabled ? "#0F4FA8" : "#8A93A5" }}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${ec}18`, color: ec }}>{rule.entity}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
                    {rule.autoBlock && <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#C53A3A" }}>Auto-block</span>}
                    <span className="ml-auto font-mono text-[11px] font-semibold" style={{ color: sev.color }}>{rule.triggers} triggers</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div
            className="hidden rounded-[8px] overflow-hidden md:block"
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
                        <div className="flex items-center gap-2">
                          <Toggle on={rule.enabled} onChange={() => toggleRule(rule.id)} />
                          <button onClick={() => { setNotice(null); setSelected(rule); }} className="rounded px-2 py-1 text-[11.5px] font-medium" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Edit</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      {selected && (
        <RulePanel
          rule={selected}
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

function RulePanel({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = rule.id === "new";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[640px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: SEV[rule.severity].color }}>Validation rule</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "New rule" : rule.name}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <Field label="Rule name">
            <input defaultValue={rule.name} placeholder="Missing supplier item code" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
          </Field>
          <Field label="Description">
            <textarea defaultValue={rule.description} placeholder="Explain when this rule should trigger" className="min-h-[88px] w-full rounded-[5px] border border-[#D5DAEA] px-2 py-2 text-[12px] text-[#0B1A2F]" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Severity">
              <select defaultValue={rule.severity} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </Field>
            <Field label="Entity">
              <select defaultValue={rule.entity} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                {(["Line item", "Header", "Supplier", "Buyer", "Amount"] as Entity[]).map((entity) => <option key={entity}>{entity}</option>)}
              </select>
            </Field>
            <Field label="Auto-block">
              <label className="flex h-9 items-center gap-2 rounded-[5px] border border-[#D5DAEA] px-2 text-[12px]" style={{ color: "#0B1A2F" }}>
                <input type="checkbox" defaultChecked={rule.autoBlock} />
                Block crossing
              </label>
            </Field>
          </div>
          <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
            Rule execution belongs to the backend validation engine. This panel is for editing operator intent and keeping the UI flow testable.
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button onClick={() => onSaved(isNew ? "Rule draft saved locally for QA. Live validation-engine persistence remains for Group J." : "Rule edit draft saved locally for QA. Live validation-engine persistence remains for Group J.")} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: 0, background: "#0B1A2F", color: "#FFFFFF" }}>Save draft</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
