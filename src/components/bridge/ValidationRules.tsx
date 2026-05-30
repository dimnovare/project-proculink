"use client";

// Validation rules — canonical split-detail: rules table (left) + a sticky
// inline rule editor (right). KEEP live API wiring (list / toggle / save /
// delete). Scope column maps to the real `entity` field; there is no per-rule
// supplier binding in RuleDto, so no Supplier column is fabricated.

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRules,
  toggleRule as toggleRuleApi,
  createRule,
  updateRule,
  deleteRule,
  isApiMockMode,
  type RuleDto,
} from "@/lib/api-client";

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
  { id: "r1",  name: "Payment terms must match dock",        description: "Order payment terms must equal the supplier dock's agreed terms before crossing.", severity: "error",   entity: "Header",    triggers: 3,  enabled: true,  autoBlock: true,  lastTriggered: "2m" },
  { id: "r2",  name: "Currency must be EUR",                 description: "Block any order whose currency is not EUR.", severity: "error",   entity: "Header",    triggers: 0,  enabled: true,  autoBlock: true,  lastTriggered: "—" },
  { id: "r3",  name: "All line items need supplier codes",   description: "Every line must carry a resolved supplier item code. Hold for review and suggest via AI.", severity: "error",   entity: "Line item", triggers: 12, enabled: true,  autoBlock: true,  lastTriggered: "6m" },
  { id: "r4",  name: "Quantity must be positive",            description: "Reject any line where the ordered quantity is zero or negative.", severity: "error",   entity: "Line item", triggers: 2,  enabled: true,  autoBlock: true,  lastTriggered: "2d" },
  { id: "r5",  name: "Warn on orders over €50k",             description: "Flag high-value orders for manual approval before they cross.", severity: "warning", entity: "Amount",    triggers: 5,  enabled: true,  autoBlock: false, lastTriggered: "3h" },
  { id: "r6",  name: "Ship-to postal code required",         description: "Warn when the ship-to address has no postal code; AI completes from history.", severity: "warning", entity: "Buyer",     triggers: 0,  enabled: false, autoBlock: false, lastTriggered: "—" },
  { id: "r7",  name: "Order total mismatch",                 description: "Sum of line amounts must match the header total within ±€0.01.", severity: "error",   entity: "Amount",    triggers: 7,  enabled: true,  autoBlock: true,  lastTriggered: "1h" },
  { id: "r8",  name: "Low confidence extraction",            description: "AI extraction confidence below 70% on any field requires manual sign-off.", severity: "warning", entity: "Line item", triggers: 41, enabled: true,  autoBlock: false, lastTriggered: "2m" },
  { id: "r9",  name: "Duplicate PO number",                  description: "A crossing with this PO number was already processed in the last 30 days.", severity: "error",   entity: "Header",    triggers: 2,  enabled: true,  autoBlock: true,  lastTriggered: "2d" },
  { id: "r10", name: "Missing GTIN",                         description: "Line item has no GTIN/EAN barcode. Informational only, for reporting.", severity: "info",    entity: "Line item", triggers: 88, enabled: false, autoBlock: false, lastTriggered: "—" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dtoToRule(dto: RuleDto): Rule {
  return {
    id:            dto.id,
    name:          dto.name,
    description:   dto.description,
    severity:      dto.severity as Severity,
    entity:        dto.entity as Entity,
    triggers:      dto.triggerCount,
    enabled:       dto.enabled,
    autoBlock:     dto.autoBlock,
    lastTriggered: dto.lastTriggered ?? "—",
  };
}

const NEW_RULE: Rule = {
  id: "new", name: "", description: "", severity: "warning",
  entity: "Line item", triggers: 0, enabled: true, autoBlock: false, lastTriggered: "—",
};

// ─── Visual maps ─────────────────────────────────────────────────────────────

const SEV: Record<Severity, { bg: string; color: string; label: string }> = {
  error:   { bg: "#FBE3E3", color: "#C53A3A", label: "Block" },
  warning: { bg: "#FAEFD6", color: "#C97A14", label: "Warn" },
  info:    { bg: "#E3EDFB", color: "#1E66C9", label: "Info" },
};

const ENTITIES: Entity[] = ["Line item", "Header", "Supplier", "Buyer", "Amount"];

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 99,
        background: on ? "#1E66C9" : "#C6CDDA",
        border: "none", padding: 0, position: "relative", cursor: "pointer",
        transition: "background 0.2s", flexShrink: 0,
      }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#FFFFFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ValidationRules() {
  const queryClient = useQueryClient();

  const [mockRules, setMockRules] = useState(RULES);

  const { data: liveData, isLoading, isError, refetch } = useQuery({
    queryKey: ["rules"],
    queryFn:  getRules,
    enabled:  !isApiMockMode,
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleRuleApi(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  const saveMutation = useMutation({
    mutationFn: (args: { id: string | null; payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt"> }) =>
      args.id ? updateRule(args.id, args.payload) : createRule(args.payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["rules"] }); },
  });

  const rules: Rule[] = isApiMockMode ? mockRules : (liveData ?? []).map(dtoToRule);

  const [selId, setSelId]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Keep a valid selection.
  useEffect(() => {
    if (selId === "new") return;
    if (rules.length === 0) { setSelId(null); return; }
    if (!selId || !rules.some((r) => r.id === selId)) setSelId(rules[0].id);
  }, [rules, selId]);

  const selected = selId === "new" ? NEW_RULE : rules.find((r) => r.id === selId) ?? null;
  const activeCount = rules.filter((r) => r.enabled).length;

  function handleToggle(id: string) {
    if (isApiMockMode) {
      setMockRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    } else {
      toggleMutation.mutate(id);
    }
  }

  function handleSave(rule: Rule, payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt">) {
    if (isApiMockMode) {
      if (rule.id === "new") {
        const id = `r${Date.now()}`;
        setMockRules((prev) => [...prev, { ...NEW_RULE, ...payload, id, severity: payload.severity, entity: payload.entity as Entity }]);
        setSelId(id);
      } else {
        setMockRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...payload, severity: payload.severity, entity: payload.entity as Entity } : r)));
      }
      setNotice(rule.id === "new" ? "Rule created." : "Rule saved.");
    } else {
      saveMutation.mutate({ id: rule.id === "new" ? null : rule.id, payload });
      setNotice(rule.id === "new" ? "Rule created." : "Rule saved.");
    }
  }

  function handleDelete(id: string) {
    if (isApiMockMode) {
      setMockRules((prev) => prev.filter((r) => r.id !== id));
    } else {
      deleteMutation.mutate(id);
    }
    setSelId(null);
    setNotice("Rule deleted.");
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (!isApiMockMode && isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
        <div className="px-4 py-4 sm:px-6 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div style={{ height: 26, width: 180, borderRadius: 5, background: "#E2E6EE" }} className="animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto p-5">
          <div className="rounded-[8px] animate-pulse" style={{ height: 320, background: "#FFFFFF", border: "1px solid #E2E6EE" }} />
        </div>
      </div>
    );
  }

  if (!isApiMockMode && isError) {
    return (
      <div className="flex flex-col h-full min-h-0 items-center justify-center" style={{ background: "#F6F7FA" }}>
        <div className="rounded-[10px] p-8 text-center max-w-sm" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
          <p className="text-[14px] font-semibold mb-1" style={{ color: "#C53A3A" }}>Could not load validation rules</p>
          <p className="text-[12px] mb-4" style={{ color: "#56627A" }}>Check your connection and try again.</p>
          <button onClick={() => refetch()} className="rounded-[6px] px-4 py-2 text-[12px] font-semibold" style={{ background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Validation rules</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Block bad orders before they reach a supplier · {activeCount} active
          </p>
        </div>
        <button
          onClick={() => { setNotice(null); setSelId("new"); }}
          className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#1E66C9", color: "#FFFFFF", border: 0 }}
        >
          + New rule
        </button>
      </div>

      {notice && (
        <div className="px-4 py-2 sm:px-5 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div className="rounded-[7px] px-3 py-2 text-[12px]" style={{ border: "1px solid #BDE0C1", background: "#F0F7F1", color: "#1E6D29" }}>{notice}</div>
        </div>
      )}

      {/* Split-detail */}
      <div className="flex-1 overflow-auto p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          {/* Rules table */}
          <div className="rounded-[8px] overflow-hidden self-start" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)" }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["Rule", "Scope", "Severity", "Triggered 30d", "Active"].map((h, i) => (
                      <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5", textAlign: i === 4 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => {
                    const sev = SEV[r.severity];
                    const active = selId === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => { setNotice(null); setSelId(r.id); }}
                        className="cursor-pointer"
                        style={{ borderBottom: "1px solid #F0F2F6", background: active ? "#F2F6FC" : "transparent", opacity: r.enabled ? 1 : 0.6 }}
                      >
                        <td className="px-4 py-3" style={{ maxWidth: 260 }}>
                          <div className="font-semibold text-[12.5px]" style={{ color: "#0B1A2F" }}>{r.name || <span style={{ color: "#8A93A5", fontStyle: "italic" }}>Untitled rule</span>}</div>
                          <div className="text-[11px] truncate" style={{ color: "#8A93A5" }}>{r.description}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#EFF2F7", color: "#56627A" }}>{r.entity}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 h-5 text-[11px] font-semibold" style={{ background: sev.bg, color: sev.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.color }} />
                            {sev.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold" style={{ color: r.triggers > 0 ? "#0B1A2F" : "#C6CDDA" }}>{r.triggers}</td>
                        <td className="px-4 py-3" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <Toggle on={r.enabled} onChange={() => handleToggle(r.id)} />
                        </td>
                      </tr>
                    );
                  })}
                  {rules.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-[12.5px]" style={{ color: "#56627A" }}>No validation rules yet. Create one to start blocking bad orders.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Inline editor */}
          {selected && (
            <RuleEditor
              key={selected.id}
              rule={selected}
              isSaving={saveMutation.isPending}
              onSave={(payload) => handleSave(selected, payload)}
              onDelete={selected.id !== "new" ? () => handleDelete(selected.id) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline rule editor (sticky right panel) ────────────────────────────────

function RuleEditor({
  rule,
  isSaving,
  onSave,
  onDelete,
}: {
  rule: Rule;
  isSaving?: boolean;
  onSave: (payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt">) => void;
  onDelete?: () => void;
}) {
  const isNew = rule.id === "new";
  const nameRef      = useRef<HTMLInputElement>(null);
  const descRef      = useRef<HTMLTextAreaElement>(null);
  const severityRef  = useRef<HTMLSelectElement>(null);
  const entityRef    = useRef<HTMLSelectElement>(null);
  const autoBlockRef = useRef<HTMLInputElement>(null);
  const enabledRef   = useRef<HTMLInputElement>(null);

  function save() {
    onSave({
      name:        nameRef.current?.value ?? rule.name,
      description: descRef.current?.value ?? rule.description,
      severity:    (severityRef.current?.value ?? rule.severity) as Severity,
      entity:      entityRef.current?.value ?? rule.entity,
      enabled:     enabledRef.current?.checked ?? rule.enabled,
      autoBlock:   autoBlockRef.current?.checked ?? rule.autoBlock,
    });
  }

  return (
    <div className="rounded-[8px] overflow-hidden self-start lg:sticky lg:top-0" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)" }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
        <span style={{ color: SEV[rule.severity].color, fontSize: 13 }}>◈</span>
        <span className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "New rule" : "Rule definition"}</span>
      </div>

      <div className="p-4 grid gap-3.5">
        <Field label="Rule name">
          <input ref={nameRef} defaultValue={rule.name} placeholder="e.g. Currency must be EUR" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
        </Field>
        <Field label="Description">
          <textarea ref={descRef} defaultValue={rule.description} placeholder="Explain when this rule should trigger" className="min-h-[72px] w-full rounded-[5px] border border-[#D5DAEA] px-2 py-2 text-[12px] text-[#0B1A2F]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope">
            <select ref={entityRef} defaultValue={rule.entity} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
              {ENTITIES.map((e) => <option key={e}>{e}</option>)}
            </select>
          </Field>
          <Field label="Severity">
            <select ref={severityRef} defaultValue={rule.severity} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
              <option value="error">Block</option>
              <option value="warning">Warn</option>
              <option value="info">Info</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 rounded-[5px] border border-[#D5DAEA] px-2.5 h-9 text-[12px]" style={{ color: "#0B1A2F" }} title="Automatically block orders that trigger this rule">
          <input ref={autoBlockRef} type="checkbox" defaultChecked={rule.autoBlock} />
          Auto-block crossing on trigger
        </label>
        <label className="flex items-center gap-2 rounded-[5px] border border-[#D5DAEA] px-2.5 h-9 text-[12px]" style={{ color: "#0B1A2F" }}>
          <input ref={enabledRef} type="checkbox" defaultChecked={rule.enabled} />
          Active
        </label>

        {!isNew && (
          <div className="text-[11px]" style={{ color: "#8A93A5" }}>
            Triggered <span className="font-mono font-semibold" style={{ color: "#0B1A2F" }}>{rule.triggers}</span> times in the last 30 days
            {rule.lastTriggered !== "—" && <> · last {rule.lastTriggered} ago</>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}>
        {onDelete && (
          <button onClick={onDelete} className="rounded-[6px] px-3 h-8 text-[12px] font-semibold mr-auto" style={{ border: "1px solid #F5C0C0", background: "#FFFFFF", color: "#C53A3A" }}>Delete</button>
        )}
        <button
          onClick={save}
          disabled={isSaving}
          className="rounded-[6px] px-4 h-8 text-[12px] font-semibold ml-auto"
          style={{ border: 0, background: "#2E8E3A", color: "#FFFFFF", opacity: isSaving ? 0.6 : 1 }}
        >
          {isSaving ? "Saving…" : isNew ? "Create rule" : "Save rule"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
