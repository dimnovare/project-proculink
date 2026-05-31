"use client";

// Validation rules — canonical split-detail: rules table (left) + a sticky
// inline rule editor (right). KEEP live API wiring (list / toggle / save /
// delete). Scope column maps to the real `entity` field. RuleDto carries no
// per-rule supplier binding, so the Supplier column is display-only and
// defaults to "All suppliers" for live rules (sensible, non-fabricated).

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
  /** Display-only — the supplier scope this rule applies to. */
  supplier: string;
  /** Display-only — short reference code shown under the rule name. */
  code: string;
  /** Display-only — human-readable condition shown in the WHEN box. */
  condition: string;
};

// ─── Mock data ────────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  { id: "r1",  name: "Payment terms must match supplier",  description: "Order payment terms must equal the supplier's agreed terms before delivery.", severity: "error",   entity: "Header",    triggers: 3,  enabled: true,  autoBlock: true,  lastTriggered: "2m", supplier: "Acme Components",  code: "ACME-PT-01",    condition: "payment_terms ≠ Net 30" },
  { id: "r2",  name: "Currency must be EUR",               description: "Block any order whose currency is not EUR.", severity: "error",   entity: "Header",    triggers: 0,  enabled: true,  autoBlock: true,  lastTriggered: "—",  supplier: "All suppliers",    code: "GLOBAL-CUR-01", condition: "currency ∉ {EUR}" },
  { id: "r3",  name: "All line items need supplier codes", description: "Every line must carry a resolved supplier item code. Hold for review and suggest via AI.", severity: "error",   entity: "Line item", triggers: 12, enabled: true,  autoBlock: true,  lastTriggered: "6m", supplier: "All suppliers",    code: "GLOBAL-CODE-03", condition: "line.supplier_code is empty" },
  { id: "r4",  name: "Quantity must be positive",          description: "Reject any line where the ordered quantity is zero or negative.", severity: "error",   entity: "Line item", triggers: 2,  enabled: true,  autoBlock: true,  lastTriggered: "2d", supplier: "All suppliers",    code: "GLOBAL-QTY-01", condition: "line.quantity ≤ 0" },
  { id: "r5",  name: "Warn on orders over €50k",           description: "Flag high-value orders for manual approval before they're sent.", severity: "warning", entity: "Amount",    triggers: 5,  enabled: true,  autoBlock: false, lastTriggered: "3h", supplier: "All suppliers",    code: "GLOBAL-VAL-02", condition: "order.total > 50000 EUR" },
  { id: "r6",  name: "Ship-to postal code required",       description: "Warn when the ship-to address has no postal code; AI completes from history.", severity: "warning", entity: "Buyer",     triggers: 0,  enabled: false, autoBlock: false, lastTriggered: "—",  supplier: "VanDerBerg Metaal", code: "VDB-SHIP-01",  condition: "ship_to.postal_code is empty" },
  { id: "r7",  name: "Order total mismatch",               description: "Sum of line amounts must match the header total within ±€0.01.", severity: "error",   entity: "Amount",    triggers: 7,  enabled: true,  autoBlock: true,  lastTriggered: "1h", supplier: "All suppliers",    code: "GLOBAL-SUM-01", condition: "|Σ lines − header.total| > 0.01" },
  { id: "r8",  name: "Low confidence extraction",          description: "AI extraction confidence below 70% on any field requires manual sign-off.", severity: "warning", entity: "Line item", triggers: 41, enabled: true,  autoBlock: false, lastTriggered: "2m", supplier: "All suppliers",    code: "GLOBAL-AI-01",  condition: "extraction.confidence < 0.70" },
  { id: "r9",  name: "Duplicate PO number",                description: "An order with this PO number was already processed in the last 30 days.", severity: "error",   entity: "Header",    triggers: 2,  enabled: true,  autoBlock: true,  lastTriggered: "2d", supplier: "All suppliers",    code: "GLOBAL-DUP-01", condition: "po_number seen in last 30d" },
  { id: "r10", name: "Missing GTIN",                       description: "Line item has no GTIN/EAN barcode. Informational only, for reporting.", severity: "info",    entity: "Line item", triggers: 88, enabled: false, autoBlock: false, lastTriggered: "—",  supplier: "All suppliers",    code: "GLOBAL-GTIN-01", condition: "line.gtin is empty" },
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
    supplier:      "All suppliers",
    code:          codeFor(dto.name, dto.entity),
    condition:     dto.description,
  };
}

// Derive a short, stable display code from the rule name + scope.
function codeFor(name: string, entity: string): string {
  const slug = (name || "rule")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join("-");
  const scope = (entity || "GEN").slice(0, 3).toUpperCase();
  return `${scope}-${slug || "RULE"}`;
}

const NEW_RULE: Rule = {
  id: "new", name: "", description: "", severity: "warning",
  entity: "Line item", triggers: 0, enabled: true, autoBlock: false, lastTriggered: "—",
  supplier: "All suppliers", code: "", condition: "",
};

// ─── Visual maps ─────────────────────────────────────────────────────────────

const SEV: Record<Severity, { bg: string; color: string; bannerBg: string; bannerText: string; label: string; banner: string }> = {
  error:   { bg: "#FCE4E4", color: "#C53A3A", bannerBg: "#F8DAD9", bannerText: "#C2453F", label: "Block", banner: "Block delivery · request buyer confirmation" },
  warning: { bg: "#FBEFD6", color: "#B7791F", bannerBg: "#FBEAC9", bannerText: "#A86A12", label: "Warn",  banner: "Hold for review · notify the buyer" },
  info:    { bg: "#E6EEFB", color: "#1E66C9", bannerBg: "#E2EAFB", bannerText: "#1A5DBF", label: "Info",  banner: "Flag for reporting · let the order through" },
};

const ENTITIES: Entity[] = ["Line item", "Header", "Supplier", "Buyer", "Amount"];

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 34, height: 20, borderRadius: 99,
        background: on ? "var(--brand-green, #28C55E)" : "#CBD2DE",
        border: "none", padding: 0, position: "relative", cursor: "pointer",
        transition: "background 0.18s", flexShrink: 0,
      }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#FFFFFF", transition: "left 0.18s", boxShadow: "0 1px 2px rgba(16,24,40,0.28)" }} />
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
        setMockRules((prev) => [...prev, { ...NEW_RULE, ...payload, id, severity: payload.severity, entity: payload.entity as Entity, code: codeFor(payload.name, payload.entity), condition: payload.description }]);
        setSelId(id);
      } else {
        setMockRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...payload, severity: payload.severity, entity: payload.entity as Entity, condition: payload.description || r.condition } : r)));
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
        <div className="px-5 py-5 sm:px-7 flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E8EBF1" }}>
          <div style={{ height: 28, width: 200, borderRadius: 6, background: "#E2E6EE" }} className="animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto p-5 sm:p-7">
          <div className="rounded-[12px] animate-pulse" style={{ height: 360, background: "#FFFFFF", border: "1px solid #E8EBF1" }} />
        </div>
      </div>
    );
  }

  if (!isApiMockMode && isError) {
    return (
      <div className="flex flex-col h-full min-h-0 items-center justify-center" style={{ background: "#F6F7FA" }}>
        <div className="rounded-[12px] p-8 text-center max-w-sm" style={{ background: "#FFFFFF", border: "1px solid #E8EBF1", boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>
          <p className="text-[14px] font-semibold mb-1" style={{ color: "#C53A3A" }}>Could not load validation rules</p>
          <p className="text-[12px] mb-4" style={{ color: "#56627A" }}>Check your connection and try again.</p>
          <button onClick={() => refetch()} className="rounded-[8px] px-4 py-2 text-[12px] font-semibold" style={{ background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col items-start gap-3 px-5 py-5 sm:px-7 sm:flex-row sm:items-center sm:gap-4 flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E8EBF1" }}>
        <div>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Validation rules</h1>
          <p className="text-[13px] mt-1.5" style={{ color: "#647089" }}>
            Block bad orders before they reach a supplier · {activeCount} active
          </p>
        </div>
        <button
          onClick={() => { setNotice(null); setSelId("new"); }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-[9px] px-4 text-[13px] font-semibold transition-colors sm:ml-auto sm:w-auto"
          style={{ height: 38, background: "var(--brand-green, #28C55E)", color: "#FFFFFF", border: 0, boxShadow: "0 1px 2px rgba(16,24,40,0.10)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-green-deep, #1DAF50)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--brand-green, #28C55E)")}
        >
          <span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span> New rule
        </button>
      </div>

      {notice && (
        <div className="px-5 py-2.5 sm:px-7 flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E8EBF1" }}>
          <div className="inline-flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px] font-medium" style={{ border: "1px solid #B9E4C3", background: "#ECFBF0", color: "#1B7A33" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B7A33" }} />
            {notice}
          </div>
        </div>
      )}

      {/* Split-detail */}
      <div className="flex-1 overflow-auto p-5 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          {/* Rules table */}
          <div className="rounded-[12px] overflow-hidden self-start" style={{ background: "#FFFFFF", border: "1px solid #E8EBF1", boxShadow: "0 1px 3px rgba(16,24,40,0.05)" }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E8EBF1" }}>
                    {["Rule", "Scope", "Supplier", "Severity", "Triggered 30d", "Active"].map((h, i) => (
                      <th key={h} className="px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: "#9AA3B5", textAlign: i === 5 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
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
                        className="cursor-pointer transition-colors"
                        style={{ borderBottom: "1px solid #F1F3F7", background: active ? "#EDF8F1" : "transparent", opacity: r.enabled ? 1 : 0.62 }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#F8FAFC"; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                      >
                        <td className="px-5 py-3.5" style={{ maxWidth: 280, borderLeft: active ? "2px solid var(--brand-green, #28C55E)" : "2px solid transparent" }}>
                          <div className="font-semibold text-[13px] leading-tight" style={{ color: "#0B1A2F" }}>{r.name || <span style={{ color: "#9AA3B5", fontStyle: "italic" }}>Untitled rule</span>}</div>
                          <div className="text-[11px] mt-0.5 tracking-[0.02em]" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{r.code}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11.5px] font-medium" style={{ background: "#F1F3F8", color: "#5B6577" }}>{r.entity}</span>
                        </td>
                        <td className="px-5 py-3.5 text-[12.5px]" style={{ color: "#3C4658" }}>{r.supplier}</td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 h-[22px] text-[11.5px] font-semibold" style={{ background: sev.bg, color: sev.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.color }} />
                            {sev.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace", color: r.triggers > 0 ? "#0B1A2F" : "#C6CDDA" }}>{r.triggers}</td>
                        <td className="px-5 py-3.5" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <Toggle on={r.enabled} onChange={() => handleToggle(r.id)} />
                        </td>
                      </tr>
                    );
                  })}
                  {rules.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-[12.5px]" style={{ color: "#647089" }}>No validation rules yet. Create one to start blocking bad orders.</td></tr>
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
  const entityRef    = useRef<HTMLSelectElement>(null);
  const autoBlockRef = useRef<HTMLInputElement>(null);
  const enabledRef   = useRef<HTMLInputElement>(null);

  // Severity is edited via a segmented Warn/Block control. `info` rules are
  // preserved: the segment shows their nearest visual (Warn) but the stored
  // value is only overwritten once the user actively picks Warn or Block.
  const [severity, setSeverity] = useState<Severity>(rule.severity);
  const sev = SEV[severity];

  function save() {
    onSave({
      name:        nameRef.current?.value ?? rule.name,
      description: descRef.current?.value ?? rule.description,
      severity,
      entity:      entityRef.current?.value ?? rule.entity,
      enabled:     enabledRef.current?.checked ?? rule.enabled,
      autoBlock:   autoBlockRef.current?.checked ?? rule.autoBlock,
    });
  }

  return (
    <div className="rounded-[12px] overflow-hidden self-start lg:sticky lg:top-0" style={{ background: "#FFFFFF", border: "1px solid #E8EBF1", boxShadow: "0 1px 3px rgba(16,24,40,0.05)" }}>
      {/* Panel header */}
      <div className="flex items-start gap-2.5 px-5 py-4" style={{ borderBottom: "1px solid #EEF0F4" }}>
        <span aria-hidden className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 22, height: 22, color: "#5C6280", marginTop: 1 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m8 12 3 3 5-6" /></svg>
        </span>
        <div className="min-w-0">
          <div className="text-[14.5px] font-bold leading-tight" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>{isNew ? "New rule" : "Rule definition"}</div>
          <div className="text-[11px] mt-0.5 tracking-[0.02em] truncate" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{isNew ? "Define a condition to hold or block orders" : rule.code}</div>
        </div>
      </div>

      <div className="p-5 grid gap-4">
        <Field label="Rule name">
          <input ref={nameRef} defaultValue={rule.name} placeholder="e.g. Currency must be EUR" className="h-[38px] w-full rounded-[8px] px-3 text-[13px] text-[#0B1A2F] outline-none transition-colors" style={{ border: "1px solid #DCE0EA", background: "#FFFFFF" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand-green, #28C55E)")} onBlur={(e) => (e.currentTarget.style.borderColor = "#DCE0EA")} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <div className="relative">
              <select ref={entityRef} defaultValue={rule.entity} className="h-[38px] w-full appearance-none rounded-[8px] pl-3 pr-8 text-[13px] text-[#0B1A2F] outline-none cursor-pointer" style={{ border: "1px solid #DCE0EA", background: "#FFFFFF" }}>
                {ENTITIES.map((e) => <option key={e}>{e}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9AA3B5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </div>
          </Field>
          <Field label="Severity">
            <SeveritySegment value={severity} onChange={setSeverity} />
          </Field>
        </div>

        {/* Condition (WHEN) */}
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold tracking-[0]" style={{ color: "#5C6280" }}>Condition <span style={{ color: "#9AA3B5", fontWeight: 500 }}>(WHEN)</span></span>
          <div className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]" style={{ background: "#EDF0F5", border: "1px solid #E2E6EE", color: "#37425A", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>
            {rule.condition || rule.description || <span style={{ color: "#9AA3B5" }}>Describe when this rule triggers below.</span>}
          </div>
        </div>

        {/* Action (THEN) */}
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold tracking-[0]" style={{ color: "#5C6280" }}>Action <span style={{ color: "#9AA3B5", fontWeight: 500 }}>(THEN)</span></span>
          <div className="rounded-[8px] px-3.5 py-2.5 text-[12.5px] font-medium" style={{ background: sev.bannerBg, color: sev.bannerText }}>
            {sev.banner}
          </div>
        </div>

        {/* Description (editable detail) */}
        <Field label="Description">
          <textarea ref={descRef} defaultValue={rule.description} placeholder="Explain when this rule should trigger" className="min-h-[64px] w-full rounded-[8px] px-3 py-2 text-[12.5px] text-[#0B1A2F] outline-none transition-colors" style={{ border: "1px solid #DCE0EA", background: "#FFFFFF" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand-green, #28C55E)")} onBlur={(e) => (e.currentTarget.style.borderColor = "#DCE0EA")} />
        </Field>

        <div className="grid gap-2">
          <CheckRow inputRef={autoBlockRef} defaultChecked={rule.autoBlock} label="Auto-block delivery on trigger" title="Automatically block orders that trigger this rule" />
          <CheckRow inputRef={enabledRef} defaultChecked={rule.enabled} label="Active" />
        </div>

        {!isNew && (
          <div className="text-[11.5px]" style={{ color: "#9AA3B5" }}>
            Triggered <span className="font-semibold" style={{ color: "#0B1A2F", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{rule.triggers}</span> times in the last 30 days
            {rule.lastTriggered !== "—" && <> · last {rule.lastTriggered} ago</>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderTop: "1px solid #EEF0F4", background: "#FAFBFC" }}>
        <button
          onClick={save}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-4 h-[36px] text-[13px] font-semibold transition-colors"
          style={{ border: 0, background: "var(--brand-green, #28C55E)", color: "#FFFFFF", opacity: isSaving ? 0.6 : 1, boxShadow: "0 1px 2px rgba(16,24,40,0.10)" }}
          onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = "var(--brand-green-deep, #1DAF50)"; }}
          onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = "var(--brand-green, #28C55E)"; }}
        >
          {!isSaving && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
          {isSaving ? "Saving…" : isNew ? "Create rule" : "Save rule"}
        </button>
        {!isNew && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3 h-[36px] text-[13px] font-semibold transition-colors"
            style={{ border: 0, background: "transparent", color: "#56627A" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#0B1A2F")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#56627A")}
            title="See orders this rule has flagged"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            View triggers
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} aria-label="Delete rule" className="inline-flex items-center justify-center rounded-[8px] h-[36px] w-[36px] ml-auto transition-colors" style={{ border: "1px solid #EFD4D4", background: "#FFFFFF", color: "#C53A3A" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#FCF1F1")} onMouseLeave={(e) => (e.currentTarget.style.background = "#FFFFFF")} title="Delete rule">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// Segmented Warn / Block severity control (mirrors the design).
function SeveritySegment({ value, onChange }: { value: Severity; onChange: (s: Severity) => void }) {
  const isBlock = value === "error";
  const isWarn  = value === "warning" || value === "info";
  return (
    <div className="grid grid-cols-2 rounded-[8px] p-0.5" style={{ background: "#F1F3F8", border: "1px solid #E5E9F0", height: 38 }}>
      <button
        type="button"
        onClick={() => onChange("warning")}
        className="rounded-[6px] text-[12.5px] font-semibold transition-colors"
        style={{ background: isWarn ? "#FFFFFF" : "transparent", color: isWarn ? "#B7791F" : "#7B8597", boxShadow: isWarn ? "0 1px 2px rgba(16,24,40,0.10)" : "none" }}
      >
        Warn
      </button>
      <button
        type="button"
        onClick={() => onChange("error")}
        className="rounded-[6px] text-[12.5px] font-semibold transition-colors"
        style={{ background: isBlock ? "#FFFFFF" : "transparent", color: isBlock ? "#C53A3A" : "#7B8597", boxShadow: isBlock ? "0 1px 2px rgba(16,24,40,0.10)" : "none" }}
      >
        Block
      </button>
    </div>
  );
}

function CheckRow({ inputRef, defaultChecked, label, title }: { inputRef: React.RefObject<HTMLInputElement | null>; defaultChecked: boolean; label: string; title?: string }) {
  return (
    <label className="flex items-center gap-2.5 rounded-[8px] px-3 h-[38px] text-[12.5px] cursor-pointer transition-colors" style={{ border: "1px solid #DCE0EA", background: "#FFFFFF", color: "#0B1A2F" }} title={title}>
      <input ref={inputRef} type="checkbox" defaultChecked={defaultChecked} className="h-[15px] w-[15px] cursor-pointer" style={{ accentColor: "var(--brand-green, #28C55E)" }} />
      {label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-semibold tracking-[0]" style={{ color: "#5C6280" }}>{label}</span>
      {children}
    </label>
  );
}
