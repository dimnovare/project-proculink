"use client";

// Rule catalog — canonical split-detail: rules table (left) + a sticky
// inline rule editor (right). KEEP live API wiring (list / toggle / save /
// delete). Scope column maps to the real `entity` field. RuleDto currently has
// no per-rule supplier binding, so live rules are labelled "Global" instead of
// pretending every rule has the same supplier-specific configuration.
//
// HONESTY (offer↔works): the backend ValidationRule has no executable condition,
// and IValidationRuleService is never called by the transform/delivery pipeline —
// so this screen documents/classifies rules but does NOT gate or block delivery.
// The ONLY validation that actually runs is the per-supplier Acceptance tab
// (SupplierAcceptanceService). This screen is therefore presented as a descriptive
// catalog, with gating affordances (Block/Auto-block) removed and a link out to
// where enforcement is really configured (the supplier Acceptance tab).

import Link from "next/link";
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
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useConfirm } from "@/components/ui/confirm";
import { PageShell } from "./layout/PageShell";
import { PageHeader } from "./layout/PageHeader";
import { HubTabs } from "./layout/HubTabs";
import { tv2HeaderCell, tv2RowDivider } from "./layout/listTableV2";

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

// Exact ported tokens: danger #B43838 / danger-soft #FBE3E3 (Critical),
// amber #B36D14 / amber-soft #FAF1DD (Warning), blue #1E66C9 / blue-soft #EAF0F8 (Info).
// `label` is a DESCRIPTIVE severity classification, not a gating action — this
// catalog does not block delivery (see header note). `banner` documents what the
// rule represents; enforcement happens in the supplier Acceptance tab.
const SEV: Record<Severity, { bg: string; color: string; bannerBg: string; bannerText: string; label: string; banner: string }> = {
  error:   { bg: "#FBE3E3", color: "#B43838", bannerBg: "#FBE3E3", bannerText: "#B43838", label: "Critical", banner: "Critical — recommended to enforce as a blocking acceptance rule per supplier" },
  warning: { bg: "#FAF1DD", color: "#B36D14", bannerBg: "#FAF1DD", bannerText: "#B36D14", label: "Warning",  banner: "Warning — recommended to enforce as a review/notify rule per supplier" },
  info:    { bg: "#EAF0F8", color: "#1E66C9", bannerBg: "#EAF0F8", bannerText: "#0F4FA8", label: "Info",      banner: "Informational — for reporting and classification" },
};

const ENTITIES: Entity[] = ["Line item", "Header", "Supplier", "Buyer", "Amount"];

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  // Ported design `.toggle` class (38×22, green-when-on knob). role/aria kept
  // for accessibility + any switch-based selectors. The switch is icon-only, so
  // an aria-label (built from the row's rule name) gives a screen reader a name
  // to announce — otherwise it reads only "switch, checked" with no context.
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label ? `${on ? "Disable" : "Enable"} rule ${label}` : undefined}
      className={`toggle${on ? " on" : ""}`}
      style={{ cursor: "pointer" }}
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ValidationRules() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  // Direction-aware copy: "Supplier" → "Customer" in inbound mode (route/types unchanged).
  const { labels } = useOrderDirection();
  const partyNoun = labels.counterpartyNoun;             // "Supplier" | "Customer"
  const partyNounLower = partyNoun.toLowerCase();         // "supplier" | "customer"

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
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setNotice(args.id ? "Rule saved." : "Rule created.");
    },
    onError: () => setNotice("Couldn't save the rule — try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setNotice("Rule deleted.");
    },
    onError: () => setNotice("Couldn't delete the rule — try again."),
  });

  const rules: Rule[] = isApiMockMode ? mockRules : (liveData ?? []).map(dtoToRule);

  const [selId, setSelId]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Mobile-only: the editor renders as a dismissible bottom-sheet. Desktop keeps
  // the always-visible inline split-detail panel (this flag is ignored there).
  const [editorOpen, setEditorOpen] = useState(false);

  // Keep a valid selection.
  useEffect(() => {
    if (selId === "new") return;
    if (rules.length === 0) { setSelId(null); return; }
    if (!selId || !rules.some((r) => r.id === selId)) setSelId(rules[0].id);
  }, [rules, selId]);

  const selected = selId === "new" ? NEW_RULE : rules.find((r) => r.id === selId) ?? null;
  const activeCount = rules.filter((r) => r.enabled).length;

  // Mobile bottom-sheet: lock body scroll + close on Escape while it is open.
  // Self-contained (mirrors the app-layout drawer behaviour) — desktop is unaffected
  // because the sheet is only ever rendered/opened under `lg:hidden`.
  const mobileSheetOpen = !!selected && editorOpen;
  useEffect(() => {
    if (!mobileSheetOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditorOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileSheetOpen]);

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
      // Notice is set in saveMutation's onSuccess/onError — not synchronously here,
      // so a failed API call no longer shows a false success.
      saveMutation.mutate({ id: rule.id === "new" ? null : rule.id, payload });
    }
    // Dismiss the mobile bottom-sheet on save; no-op on desktop (flag unused there).
    setEditorOpen(false);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete validation rule",
      description: "Delete this validation rule? This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    if (isApiMockMode) {
      setMockRules((prev) => prev.filter((r) => r.id !== id));
      setNotice("Rule deleted.");
    } else {
      // Notice is set in deleteMutation's onSuccess/onError — not synchronously here,
      // so a failed API call no longer shows a false success.
      deleteMutation.mutate(id);
    }
    setSelId(null);
    // Dismiss the mobile bottom-sheet on delete; no-op on desktop (flag unused there).
    setEditorOpen(false);
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (!isApiMockMode && isLoading) {
    return (
      <PageShell variant="wide" className="flex flex-col">
        <div className="mb-5 flex-shrink-0">
          <div style={{ height: 28, width: 200, borderRadius: 6, background: "#E5E8EE" }} className="animate-pulse" />
        </div>
        <HubTabs hub="rules-formats" />
        <div className="flex-1 overflow-auto">
          <div className="rounded-[12px] animate-pulse" style={{ height: 360, background: "#FFFFFF", border: "1px solid #E5E8EE" }} />
        </div>
      </PageShell>
    );
  }

  if (!isApiMockMode && isError) {
    return (
      <PageShell variant="wide" className="flex flex-col">
        <HubTabs hub="rules-formats" />
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="rounded-[12px] p-8 text-center max-w-sm" style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>
            <p className="text-[14px] font-semibold mb-1" style={{ color: "#B43838" }}>Could not load validation rules</p>
            <p className="text-[12px] mb-4" style={{ color: "#5E6779" }}>Check your connection and try again.</p>
            <button onClick={() => refetch()} className="rounded-[8px] px-4 py-2 text-[12px] font-semibold" style={{ background: "#0B1A2F", color: "#FFFFFF", border: 0 }}>Retry</button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" className="flex flex-col">
      {/* Header — canonical PageHeader on the grey canvas */}
      <PageHeader
        title="Rule catalog"
        sub={
          <>
            A catalog of the checks you want to run · {activeCount} active. Enforcement is configured per {partyNounLower} — set up blocking checks on each{" "}
            <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "#1E66C9" }}>{partyNounLower}&apos;s Validation rules tab</Link>.
          </>
        }
        actions={
          <button
            onClick={() => { setNotice(null); setSelId("new"); setEditorOpen(true); }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[9px] px-4 text-[13px] font-semibold transition-colors sm:w-auto h-[44px] sm:h-[38px]"
            style={{ background: "#1E66C9", color: "#FFFFFF", border: 0, boxShadow: "0 1px 2px rgba(16,24,40,0.10)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1A5BB5")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1E66C9")}
          >
            <span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span> New rule
          </button>
        }
      />

      {/* Hub tab bar — Rules & formats hub (Mappings | Rules | Output templates | Standards) */}
      <HubTabs hub="rules-formats" counts={{ Rules: rules.length }} />

      {/* Enforcement-location callout — this catalog documents checks; it does not
          gate delivery. Real blocking/validation runs per supplier. Hidden on mobile:
          the header subtitle already conveys "catalog, not a gate" and this would push
          the rule list below the fold. */}
      <div className="hidden sm:block pb-3 flex-shrink-0">
        <div className="flex flex-col items-start gap-1.5 rounded-[8px] px-3.5 py-2.5 text-[12px] sm:flex-row sm:items-center sm:gap-2.5" style={{ border: "1px solid #D6E2F4", background: "#F2F7FE", color: "#37425A" }}>
          <span className="font-semibold" style={{ color: "#0F4FA8" }}>This is a catalog, not a gate.</span>
          <span style={{ color: "#5E6779" }}>
            Rules here describe and classify the checks you care about. They are not enforced automatically — set up the checks that actually hold or block an order on each{" "}
            <Link href="/library/suppliers" className="font-semibold underline" style={{ color: "#1E66C9" }}>{partyNounLower}&apos;s Validation rules tab</Link>.
          </span>
        </div>
      </div>

      {notice && (
        <div className="pb-3 flex-shrink-0">
          <div className="inline-flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px] font-medium" style={{ border: "1px solid #B9E4C3", background: "#ECFBF0", color: "#1B7A33" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B7A33" }} />
            {notice}
          </div>
        </div>
      )}

      {/* Split-detail */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          {/* Rules table — desktop */}
          <div className="hidden rounded-[12px] overflow-hidden self-start lg:block" style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 3px rgba(16,24,40,0.05)" }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {/* v2 tinted header band (shared listTableV2), toggle leads the
                        row per the design's toggle-list; numeric column right-aligned. */}
                    {["Active", "Rule", "Scope", partyNoun, "Severity", "Triggered 30d"].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          ...tv2HeaderCell(i === 5 ? "right" : "left", i === 0),
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                          boxShadow: "inset 0 -1px 0 #E5E8EE",
                        }}
                      >
                        {h}
                      </th>
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
                        style={{ borderBottom: tv2RowDivider, background: active ? "#EAF0F8" : "transparent", opacity: r.enabled ? 1 : 0.62 }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#F6F8FB"; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                      >
                        {/* Leading toggle — the design's toggle-list affordance */}
                        <td
                          className="py-3.5 pl-[18px] pr-3"
                          style={{ borderLeft: active ? "2px solid #1E66C9" : "2px solid transparent", whiteSpace: "nowrap" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Toggle on={r.enabled} onChange={() => handleToggle(r.id)} label={r.name} />
                        </td>
                        <td className="px-3 py-3.5" style={{ maxWidth: 280 }}>
                          <div className="font-semibold text-[13px] leading-tight" style={{ color: "#0B1A2F" }}>{r.name || <span style={{ color: "#9AA3B5", fontStyle: "italic" }}>Untitled rule</span>}</div>
                          <div className="text-[11px] mt-0.5 tracking-[0.02em]" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{r.code}</div>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11.5px] font-medium" style={{ background: "#F1F3F7", color: "#5B6577" }}>{r.entity}</span>
                        </td>
                        <td className="px-3 py-3.5 text-[12.5px]" style={{ color: "#3C4658" }}>{r.supplier}</td>
                        <td className="px-3 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 h-[22px] text-[11.5px] font-semibold" style={{ background: sev.bg, color: sev.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.color }} />
                            {sev.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-[13px] font-semibold" style={{ fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace", fontVariantNumeric: "tabular-nums", textAlign: "right", color: r.triggers > 0 ? "#0B1A2F" : "#CBD0DA" }}>{r.triggers}</td>
                      </tr>
                    );
                  })}
                  {rules.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-[12.5px]" style={{ color: "#647089" }}>No rules in your catalog yet. Create one to document a check you want to run.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rules list — mobile (stacked row-cards) */}
          <div className="grid gap-2.5 self-start lg:hidden">
            {rules.map((r) => {
              const sev = SEV[r.severity];
              const active = selId === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => { setNotice(null); setSelId(r.id); setEditorOpen(true); }}
                  className="cursor-pointer rounded-[12px] p-3.5 transition-colors"
                  style={{
                    background: "#FFFFFF",
                    border: active ? "1px solid #1E66C9" : "1px solid #E5E8EE",
                    boxShadow: active ? "0 0 0 3px rgba(30,102,201,0.12)" : "0 1px 2px rgba(16,24,40,0.04)",
                    opacity: r.enabled ? 1 : 0.62,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-[14px] leading-snug" style={{ color: "#0B1A2F" }}>{r.name || <span style={{ color: "#9AA3B5", fontStyle: "italic" }}>Untitled rule</span>}</div>
                      <div className="text-[11px] mt-0.5 tracking-[0.02em]" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{r.code}</div>
                    </div>
                    {/* 44×44 hit area around the 38×22 toggle so a tap on/near it
                        toggles the rule (and does NOT open the editor sheet). */}
                    <div
                      className="-m-1 inline-flex flex-shrink-0 items-center justify-center"
                      style={{ minWidth: 44, minHeight: 44 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Toggle on={r.enabled} onChange={() => handleToggle(r.id)} label={r.name} />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 h-[22px] text-[11.5px] font-semibold" style={{ background: sev.bg, color: sev.color }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.color }} />
                      {sev.label}
                    </span>
                    <span className="inline-flex items-center rounded-[6px] px-2 h-[22px] text-[11.5px] font-medium" style={{ background: "#F1F3F7", color: "#5B6577" }}>{r.entity}</span>
                    <span
                      className="text-[12px]"
                      style={{
                        color: r.supplier === "All suppliers" ? "#0F4FA8" : "#647089",
                        fontWeight: r.supplier === "All suppliers" ? 600 : 400,
                      }}
                    >
                      {r.supplier}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug" style={{ color: "#5E6779" }}>
                    {r.description}
                  </p>
                  <div className="mt-2.5 pt-2.5 text-[12px]" style={{ borderTop: "1px solid #F1F3F7", color: "#9AA3B5" }}>
                    Triggered <span className="font-semibold" style={{ color: r.triggers > 0 ? "#0B1A2F" : "#CBD0DA", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{r.triggers}</span>
                    <span> in the last 30 days</span>
                  </div>
                </div>
              );
            })}
            {rules.length === 0 && (
              <div className="rounded-[12px] px-5 py-12 text-center text-[12.5px]" style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", color: "#647089" }}>
                No rules in your catalog yet. Create one to document a check you want to run.
              </div>
            )}
          </div>

          {/* Inline editor — desktop only. Stays a direct grid child so it keeps
              its column placement + `lg:sticky`; `hidden lg:block` hides it below lg
              where the mobile bottom-sheet (below) takes over. */}
          {selected && (
            <RuleEditor
              key={selected.id}
              rule={selected}
              isSaving={saveMutation.isPending}
              onSave={(payload) => handleSave(selected, payload)}
              onDelete={selected.id !== "new" ? () => handleDelete(selected.id) : undefined}
              className="hidden lg:block"
            />
          )}
        </div>
      </div>

      {/* Mobile editor — dismissible bottom-sheet. Only rendered <lg and only when a
          rule is selected AND the sheet was explicitly opened (card tap / New rule). */}
      {mobileSheetOpen && selected && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={selected.id === "new" ? "New rule" : "Edit rule"}
        >
          {/* Dim backdrop — closes the sheet on tap. */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(11,26,47,0.45)" }}
            onClick={() => setEditorOpen(false)}
          />
          {/* Sheet */}
          <div className="absolute inset-x-0 bottom-0 top-12 rounded-t-[18px] bg-white flex flex-col overflow-hidden" style={{ boxShadow: "0 -8px 30px rgba(16,24,40,0.20)" }}>
            {/* Sticky sheet header */}
            <div className="flex items-center gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid #EEF0F4", background: "#FFFFFF" }}>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-tight" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>{selected.id === "new" ? "New rule" : "Edit rule"}</div>
                <div className="text-[11px] mt-0.5 tracking-[0.02em] truncate" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{selected.id === "new" ? "Document a check for your catalog" : selected.code}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                aria-label="Close"
                className="inline-flex items-center justify-center flex-shrink-0 rounded-[10px] transition-colors"
                style={{ width: 44, height: 44, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F8FB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#FFFFFF")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            {/* Scrollable body */}
            <div className="flex-1 overflow-auto">
              <RuleEditor
                key={`sheet-${selected.id}`}
                rule={selected}
                isSaving={saveMutation.isPending}
                onSave={(payload) => handleSave(selected, payload)}
                onDelete={selected.id !== "new" ? () => handleDelete(selected.id) : undefined}
                variant="sheet"
              />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ─── Inline rule editor (sticky right panel) ────────────────────────────────

function RuleEditor({
  rule,
  isSaving,
  onSave,
  onDelete,
  className,
  variant = "panel",
}: {
  rule: Rule;
  isSaving?: boolean;
  onSave: (payload: Omit<RuleDto, "id"|"triggerCount"|"lastTriggered"|"createdAt">) => void;
  onDelete?: () => void;
  /** Extra classes on the root (e.g. `hidden lg:block` for the desktop instance). */
  className?: string;
  /** `panel` = sticky bordered card (desktop split-detail); `sheet` = chromeless
      body inside the mobile bottom-sheet, which already supplies header + border. */
  variant?: "panel" | "sheet";
}) {
  const isNew = rule.id === "new";
  const isSheet = variant === "sheet";
  const nameRef      = useRef<HTMLInputElement>(null);
  const descRef      = useRef<HTMLTextAreaElement>(null);
  const entityRef    = useRef<HTMLSelectElement>(null);
  const enabledRef   = useRef<HTMLInputElement>(null);

  // Severity is edited via a segmented Warning/Critical control. `info` rules are
  // preserved: the segment shows their nearest visual (Warning) but the stored
  // value is only overwritten once the user actively picks Warning or Critical.
  const [severity, setSeverity] = useState<Severity>(rule.severity);
  const sev = SEV[severity];

  function save() {
    onSave({
      name:        nameRef.current?.value ?? rule.name,
      description: descRef.current?.value ?? rule.description,
      severity,
      entity:      entityRef.current?.value ?? rule.entity,
      enabled:     enabledRef.current?.checked ?? rule.enabled,
      // autoBlock affordance removed — preserve the rule's existing value.
      autoBlock:   rule.autoBlock,
    });
  }

  return (
    <div
      className={`${isSheet ? "" : "rounded-[12px] border self-start lg:sticky lg:top-0"} overflow-hidden${className ? ` ${className}` : ""}`}
      style={isSheet ? { background: "#FFFFFF" } : { background: "#FFFFFF", borderColor: "#E5E8EE", boxShadow: "0 1px 3px rgba(16,24,40,0.05)" }}
    >
      {/* Panel header — desktop card only; the mobile sheet supplies its own header. */}
      {!isSheet && (
        <div className="flex items-start gap-2.5 px-5 py-4" style={{ borderBottom: "1px solid #EEF0F4" }}>
          <span aria-hidden className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 22, height: 22, color: "#5C6280", marginTop: 1 }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m8 12 3 3 5-6" /></svg>
          </span>
          <div className="min-w-0">
            <div className="text-[14.5px] font-bold leading-tight" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>{isNew ? "New rule" : "Rule definition"}</div>
            <div className="text-[11px] mt-0.5 tracking-[0.02em] truncate" style={{ color: "#9AA3B5", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{isNew ? "Document a check for your catalog" : rule.code}</div>
          </div>
        </div>
      )}

      <div className="p-5 grid gap-4">
        <Field label="Rule name">
          <input ref={nameRef} defaultValue={rule.name} placeholder="e.g. Currency must be EUR" className="h-[44px] sm:h-[38px] w-full rounded-[8px] px-3 text-[15px] sm:text-[13px] text-[#0B1A2F] outline-none transition-colors" style={{ border: "1px solid #CBD0DA", background: "#FFFFFF" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand-green)")} onBlur={(e) => (e.currentTarget.style.borderColor = "#CBD0DA")} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <div className="relative">
              <select ref={entityRef} defaultValue={rule.entity} className="h-[44px] sm:h-[38px] w-full appearance-none rounded-[8px] pl-3 pr-8 text-[15px] sm:text-[13px] text-[#0B1A2F] outline-none cursor-pointer" style={{ border: "1px solid #CBD0DA", background: "#FFFFFF" }}>
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
          <div className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]" style={{ background: "#F1F3F7", border: "1px solid #E5E8EE", color: "#37425A", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>
            {rule.condition || rule.description || <span style={{ color: "#9AA3B5" }}>Describe when this rule triggers below.</span>}
          </div>
        </div>

        {/* Recommended enforcement — descriptive only. This catalog does not act on
            orders; the recommendation tells you how to set the matching check up on
            the supplier Acceptance tab, where enforcement really runs. */}
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold tracking-[0]" style={{ color: "#5C6280" }}>Recommended enforcement <span style={{ color: "#9AA3B5", fontWeight: 500 }}>(per supplier)</span></span>
          <div className="rounded-[8px] px-3.5 py-2.5 text-[12.5px] font-medium" style={{ background: sev.bannerBg, color: sev.bannerText }}>
            {sev.banner}
          </div>
        </div>

        {/* Description (editable detail) */}
        <Field label="Description">
          <textarea ref={descRef} defaultValue={rule.description} placeholder="Explain when this rule should trigger" className="min-h-[64px] w-full rounded-[8px] px-3 py-2 text-[12.5px] text-[#0B1A2F] outline-none transition-colors" style={{ border: "1px solid #CBD0DA", background: "#FFFFFF" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand-green)")} onBlur={(e) => (e.currentTarget.style.borderColor = "#CBD0DA")} />
        </Field>

        <div className="grid gap-2">
          {/* Auto-block affordance removed (offer↔works): this catalog cannot block
              delivery — enforcement is configured per supplier. The autoBlock field
              is preserved on save (defaults to the rule's existing value). */}
          <CheckRow inputRef={enabledRef} defaultChecked={rule.enabled} label="In catalog (active)" />
        </div>

        {!isNew && (
          <div className="text-[11.5px]" style={{ color: "#9AA3B5" }}>
            Triggered <span className="font-semibold" style={{ color: "#0B1A2F", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }}>{rule.triggers}</span> times in the last 30 days
            {rule.lastTriggered !== "—" && <> · last {rule.lastTriggered} ago</>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5" style={{ borderTop: "1px solid #EEF0F4", background: "#FAFBFC" }}>
        <button
          onClick={save}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-1.5 rounded-[8px] px-4 h-[44px] sm:h-[36px] w-full sm:w-auto text-[13px] font-semibold transition-colors order-first"
          style={{ border: 0, background: "var(--brand-green)", color: "#FFFFFF", opacity: isSaving ? 0.6 : 1, boxShadow: "0 1px 2px rgba(16,24,40,0.10)" }}
          onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = "var(--brand-green-deep)"; }}
          onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = "var(--brand-green)"; }}
        >
          {!isSaving && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
          {isSaving ? "Saving…" : isNew ? "Create rule" : "Save rule"}
        </button>
        {/* "View triggers" button removed (offer↔works): there is no trigger-history
            view, so the control had no onClick and did nothing. Reinstate it once a
            real flagged-orders view exists. */}
        {onDelete && (
          <button onClick={onDelete} aria-label="Delete rule" className="inline-flex items-center justify-center rounded-[8px] h-[44px] w-[44px] sm:h-[36px] sm:w-[36px] ml-auto transition-colors" style={{ border: "1px solid #EFD4D4", background: "#FFFFFF", color: "#B43838" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#FCF1F1")} onMouseLeave={(e) => (e.currentTarget.style.background = "#FFFFFF")} title="Delete rule">
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
    <div className="grid grid-cols-2 rounded-[8px] p-0.5 h-[44px] sm:h-[38px]" style={{ background: "#F1F3F7", border: "1px solid #E5E8EE" }}>
      <button
        type="button"
        onClick={() => onChange("warning")}
        className="rounded-[6px] text-[15px] sm:text-[12.5px] font-semibold transition-colors"
        style={{ background: isWarn ? "#FFFFFF" : "transparent", color: isWarn ? "#B36D14" : "#7B8597", boxShadow: isWarn ? "0 1px 2px rgba(16,24,40,0.10)" : "none" }}
      >
        Warning
      </button>
      <button
        type="button"
        onClick={() => onChange("error")}
        className="rounded-[6px] text-[15px] sm:text-[12.5px] font-semibold transition-colors"
        style={{ background: isBlock ? "#FFFFFF" : "transparent", color: isBlock ? "#B43838" : "#7B8597", boxShadow: isBlock ? "0 1px 2px rgba(16,24,40,0.10)" : "none" }}
      >
        Critical
      </button>
    </div>
  );
}

function CheckRow({ inputRef, defaultChecked, label, title }: { inputRef: React.RefObject<HTMLInputElement | null>; defaultChecked: boolean; label: string; title?: string }) {
  return (
    <label className="flex items-center gap-2.5 rounded-[8px] px-3 h-[42px] sm:h-[38px] text-[12.5px] cursor-pointer transition-colors" style={{ border: "1px solid #CBD0DA", background: "#FFFFFF", color: "#0B1A2F" }} title={title}>
      <input ref={inputRef} type="checkbox" defaultChecked={defaultChecked} className="h-[16px] w-[16px] cursor-pointer" style={{ accentColor: "var(--brand-green)" }} />
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
