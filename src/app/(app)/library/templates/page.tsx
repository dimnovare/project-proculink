"use client";

// Output templates — canonical split-list: template cards (left) + the
// envelope each supplier receives, previewed as code with {token} highlighting
// (right). KEEP live CRUD (create / update / delete) + the editor modal.

import { EmptyState } from "@/components/bridge/EmptyState";
import { SrcChip } from "@/components/bridge/DSPrimitives";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  isApiMockMode,
  type TemplateDto,
} from "@/lib/api-client";

const MOCK_TEMPLATES = [
  { id: "t1", name: "cXML 1.2.045 — OrderRequest", fmt: "cXML", suppliers: 2, supplierNames: ["Acme Components", "MedicaSupply"], lastUsed: "2m",  version: "1.2.045", isDefault: true },
  { id: "t2", name: "UBL 2.1 — Order",             fmt: "UBL",  suppliers: 1, supplierNames: ["BoltWorks BV"],                    lastUsed: "1h",  version: "2.1" },
  { id: "t3", name: "EDIFACT D.96A — ORDERS",      fmt: "EDI",  suppliers: 1, supplierNames: ["VanderBerg Metaal"],              lastUsed: "3h",  version: "D.96A" },
  { id: "t4", name: "X12 850 — Purchase Order",    fmt: "X12",  suppliers: 0, supplierNames: [],                                 lastUsed: "1d",  version: "004010" },
];

type CardTemplate = {
  id: string;
  name: string;
  fmt: string;
  suppliers: number;
  /** Optional supplier names for the assignment line (mock/demo only — live DTO has count only). */
  supplierNames?: string[];
  lastUsed: string;
  version: string;
  isDefault?: boolean;
};

// Accent strip + chip routing per standard family.
const FMT_COLOR: Record<string, string> = {
  cXML: "#6F4FCE", EDI: "#C97A14", EDIFACT: "#C97A14", X12: "#C97A14",
  UBL: "#1E66C9", JSON: "#A06200", CSV: "#56627A",
};

// One-line plain-language description of what each standard envelope is.
const FMT_DESC: Record<string, string> = {
  cXML:    "Ariba-compatible punchout order request envelope.",
  UBL:     "Peppol BIS 3.0 compatible Order document.",
  EDI:     "Classic EDIFACT purchase order message.",
  EDIFACT: "Classic EDIFACT purchase order message.",
  X12:     "ANSI ASC X12 850 transaction set.",
  JSON:    "Generic JSON order payload for REST endpoints.",
  CSV:     "Flat CSV row export for tabular suppliers.",
};

// Illustrative envelope previews — {tokens} are filled from the canonical order
// at delivery time. Keyed by uppercased format.
const PREVIEW_BY_FORMAT: Record<string, string[]> = {
  CXML: ['<cXML payloadID="..." xml:lang="en-US">', "  <Request>", "    <OrderRequest>", '      <OrderRequestHeader orderID="{po}"', '          orderDate="{date}" type="new">', '        <Total><Money currency="{cur}">{total}</Money></Total>', "      </OrderRequestHeader>", '      <ItemOut quantity="{qty}">…</ItemOut>', "    </OrderRequest>", "  </Request>", "</cXML>"],
  UBL:  ['<Order xmlns="urn:oasis:...:Order-2">', "  <cbc:ID>{po}</cbc:ID>", "  <cbc:IssueDate>{date}</cbc:IssueDate>", "  <cac:OrderLine>", "    <cac:LineItem>", '      <cbc:Quantity unitCode="{uom}">{qty}</cbc:Quantity>', '      <cbc:LineExtensionAmount currencyID="{cur}">{amt}</cbc:LineExtensionAmount>', "    </cac:LineItem>", "  </cac:OrderLine>", "</Order>"],
  EDI:  ["UNH+1+ORDERS:D:96A:UN'", "BGM+220+{po}+9'", "DTM+137:{date}:102'", "NAD+BY+{buyer}'", "NAD+SU+{supplier}'", "LIN+1++{item}:VP'", "QTY+21:{qty}'", "UNS+S'", "UNT+12+1'"],
  EDIFACT: ["UNH+1+ORDERS:D:96A:UN'", "BGM+220+{po}+9'", "DTM+137:{date}:102'", "NAD+BY+{buyer}'", "NAD+SU+{supplier}'", "LIN+1++{item}:VP'", "QTY+21:{qty}'", "UNS+S'", "UNT+12+1'"],
  X12:  ["ST*850*0001~", "BEG*00*NE*{po}**{date}~", "REF*DP*DEPT~", "PO1*1*{qty}*EA*{price}**VP*{item}~", "CTT*1~", "SE*6*0001~"],
  JSON: ["{", '  "orderId": "{po}",', '  "orderDate": "{date}",', '  "currency": "{cur}",', '  "lines": [', '    { "item": "{item}", "qty": {qty}, "price": "{price}" }', "  ]", "}"],
  CSV:  ["po_number,order_date,supplier,currency", "{po},{date},{supplier},{cur}", "line,item,qty,unit_price", "1,{item},{qty},{price}"],
};

function previewFor(fmt: string): string[] {
  return PREVIEW_BY_FORMAT[fmt.toUpperCase()] ?? PREVIEW_BY_FORMAT.JSON;
}

function dtoToCard(t: TemplateDto): CardTemplate {
  return {
    id:        t.id,
    name:      t.name,
    fmt:       t.format,
    suppliers: t.suppliersCount,
    lastUsed:  t.lastUsed,
    version:   t.version,
  };
}

// Highlight {token} segments violet inside a preview line.
function PreviewLine({ line }: { line: string }) {
  return (
    <div>
      {line.split(/(\{[a-z]+\})/g).map((part, j) =>
        /\{[a-z]+\}/.test(part) ? (
          <span key={j} style={{ color: "#6F4FCE", fontWeight: 600 }}>{part}</span>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </div>
  );
}

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CardTemplate | null>(null);
  const [selId,   setSelId]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const { data: liveTemplates, isLoading, isError, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn:  getTemplates,
    enabled:  !isApiMockMode,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setEditing(null);
      setNotice({ text: "Template deleted.", kind: "ok" });
    },
    onError: () => setNotice({ text: "Delete failed — please retry.", kind: "err" }),
  });

  const templates: CardTemplate[] = isApiMockMode
    ? MOCK_TEMPLATES
    : (liveTemplates ?? []).map(dtoToCard);

  // Keep a valid selection for the preview panel.
  useEffect(() => {
    if (templates.length === 0) { setSelId(null); return; }
    if (!selId || !templates.some((t) => t.id === selId)) setSelId(templates[0].id);
  }, [templates, selId]);

  const selected = templates.find((t) => t.id === selId) ?? null;

  const newTemplate = () => {
    setNotice(null);
    setEditing({ id: "new", name: "", fmt: "cXML", suppliers: 0, lastUsed: "never", version: "1.0" });
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Output templates</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            The envelope each supplier receives · {templates.length} template{templates.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={newTemplate}
          className="w-full rounded-[6px] px-3.5 text-[12.5px] font-semibold sm:ml-auto sm:w-auto transition-colors"
          style={{ height: 32, background: "#28C55E", color: "#FFFFFF", border: 0, boxShadow: "0 1px 2px rgba(11,26,47,0.10)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#1DAF50")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#28C55E")}
        >
          + New template
        </button>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {notice && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={
              notice.kind === "ok"
                ? { border: "1px solid #BBE9CC", borderLeft: "3px solid #28C55E", background: "#F0FBF4", color: "#1DAF50" }
                : { border: "1px solid #F5C6CB", borderLeft: "3px solid #C62828", background: "#FFF5F5", color: "#B71C1C" }
            }
          >
            {notice.text}
          </div>
        )}

        {!isApiMockMode && isLoading && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))" }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-[8px] animate-pulse" style={{ height: 100, background: "#E2E6EE", border: "1px solid #E2E6EE" }} />
            ))}
          </div>
        )}

        {!isApiMockMode && isError && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="rounded-[8px] px-5 py-4 text-center" style={{ border: "1px solid #F5C6CB", background: "#FFF5F5" }}>
              <p className="text-[13px] font-semibold" style={{ color: "#C62828" }}>Could not load templates</p>
              <p className="text-[12px] mt-1" style={{ color: "#56627A" }}>Check the API connection and try again.</p>
              <button onClick={() => refetch()} className="mt-3 h-8 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}>Retry</button>
            </div>
          </div>
        )}

        {!isLoading && !isError && (
          templates.length === 0 ? (
            <EmptyState
              icon="⊟"
              title="No output templates"
              sub="Templates define the envelope each supplier receives when an order is sent to them."
              action={{ label: "+ New template", onClick: newTemplate }}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
              {/* Left: template cards */}
              <div className="flex flex-col gap-2.5">
                {templates.map((t) => {
                  const active = selId === t.id;
                  const accent = FMT_COLOR[t.fmt] ?? "#56627A";
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setNotice(null); setSelId(t.id); }}
                      className="relative rounded-[8px] text-left overflow-hidden transition-shadow"
                      style={{
                        background: "#FFFFFF",
                        border: `1px solid ${active ? "#28C55E" : "#E2E6EE"}`,
                        boxShadow: active ? "0 0 0 1px #28C55E" : "0 1px 3px rgba(11,26,47,0.04)",
                        padding: "14px 16px 14px 18px",
                      }}
                    >
                      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
                      <div className="flex items-center justify-between gap-2">
                        <SrcChip type={t.fmt} />
                        {t.isDefault && (
                          <span className="inline-flex items-center rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: "#DCFCE7", color: "#1DAF50" }}>Default</span>
                        )}
                      </div>
                      <div className="text-[13.5px] font-semibold mt-2.5 tracking-[-0.01em]" style={{ color: "#0B1A2F" }}>{t.name}</div>
                      <div className="text-[12px] mt-1 leading-[1.45]" style={{ color: "#56627A" }}>{FMT_DESC[t.fmt] ?? `${t.fmt} output envelope.`}</div>
                      <div className="mt-2.5 text-[11.5px]" style={{ color: "#8A93A5" }}>
                        {t.suppliers > 0 ? (
                          <>
                            <span style={{ fontWeight: 600, color: "#56627A" }}>
                              {t.suppliers} supplier{t.suppliers !== 1 ? "s" : ""}
                            </span>
                            {t.supplierNames && t.supplierNames.length > 0 && (
                              <span>: {t.supplierNames.join(", ")}</span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontStyle: "italic" }}>Not assigned to a supplier</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right: code preview panel */}
              {selected && (
                <div className="rounded-[8px] overflow-hidden self-start" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)" }}>
                  <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span style={{ color: "#56627A", fontSize: 14 }}>{"</>"}</span>
                      <span className="text-[13px] font-semibold truncate" style={{ color: "#0B1A2F" }}>{selected.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[11px] font-mono" style={{ color: "#8A93A5" }}>v{selected.version}</span>
                      <button
                        onClick={() => setNotice({ text: `Exported ${selected.name}.`, kind: "ok" })}
                        className="inline-flex items-center gap-1.5 rounded-[5px] px-1 text-[12.5px] font-semibold transition-colors"
                        style={{ height: 27, border: 0, background: "transparent", color: "#0B1A2F" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#1DAF50")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#0B1A2F")}
                      >
                        ↓ Export
                      </button>
                    </div>
                  </div>
                  <pre
                    className="m-0 overflow-x-auto"
                    style={{ padding: "14px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.7, background: "#FCFCFD", color: "#345470" }}
                  >
                    {previewFor(selected.fmt).map((line, i) => <PreviewLine key={i} line={line} />)}
                  </pre>
                  <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderTop: "1px solid #E2E6EE" }}>
                    <span className="text-[11px]" style={{ color: "#8A93A5" }}>
                      <span style={{ color: "#6F4FCE", fontWeight: 600 }}>{"{tokens}"}</span> are filled from the canonical order at delivery time.
                    </span>
                    <button
                      onClick={() => { setNotice(null); setEditing(selected); }}
                      className="inline-flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold transition-colors"
                      style={{ height: 30, border: "1px solid #D5DAEA", background: "#FFFFFF", color: "#0B1A2F" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F7FA"; e.currentTarget.style.borderColor = "#C6CDDA"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#D5DAEA"; }}
                    >
                      ✎ Edit template
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {editing && (
        <TemplatePanel
          template={editing}
          onClose={() => setEditing(null)}
          onDelete={editing.id !== "new" ? () => deleteMutation.mutate(editing.id) : undefined}
          onSaved={(message, kind) => {
            setNotice({ text: message, kind });
            setEditing(null);
            if (!isApiMockMode) queryClient.invalidateQueries({ queryKey: ["templates"] });
          }}
        />
      )}
    </div>
  );
}

function TemplatePanel({
  template,
  onClose,
  onDelete,
  onSaved,
}: {
  template: CardTemplate;
  onClose: () => void;
  onDelete?: () => void;
  onSaved: (message: string, kind: "ok" | "err") => void;
}) {
  const isNew = template.id === "new";
  const [validation, setValidation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameRef    = useRef<HTMLInputElement>(null);
  const fmtRef     = useRef<HTMLSelectElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const bodyRef    = useRef<HTMLTextAreaElement>(null);

  async function handleSave() {
    if (isApiMockMode) {
      onSaved(isNew ? "Template created." : "Template updated.", "ok");
      return;
    }

    const name    = nameRef.current?.value.trim()    ?? "";
    const format  = fmtRef.current?.value            ?? "cXML";
    const version = versionRef.current?.value.trim() ?? "1.0";

    if (!name) {
      setValidation("Template name is required.");
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await createTemplate({ name, format, version });
        onSaved("Template created.", "ok");
      } else {
        await updateTemplate(template.id, { name, format, version });
        onSaved("Template updated.", "ok");
      }
    } catch {
      onSaved("Save failed — please retry.", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[680px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: FMT_COLOR[template.fmt] ?? "#56627A" }}>Output template</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "New template" : template.name}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px_100px]">
            <Field label="Template name">
              <input ref={nameRef} defaultValue={template.name} placeholder="cXML 1.2.045 — OrderRequest" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
            </Field>
            <Field label="Standard">
              <select ref={fmtRef} defaultValue={template.fmt} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                <option>cXML</option>
                <option>UBL</option>
                <option>EDI</option>
                <option>X12</option>
                <option>JSON</option>
                <option>CSV</option>
              </select>
            </Field>
            <Field label="Version">
              <input ref={versionRef} defaultValue={template.version} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 font-mono text-[12px] text-[#0B1A2F]" />
            </Field>
          </div>
          <Field label="Template body">
            <textarea
              ref={bodyRef}
              defaultValue={'<OrderRequest orderID="{po}">\n  <ItemOut sku="{item}" quantity="{qty}" />\n</OrderRequest>'}
              className="min-h-[180px] w-full rounded-[5px] border border-[#D5DAEA] bg-[#0B1A2F] px-3 py-3 font-mono text-[11.5px] leading-5 text-[#C5D2E4]"
            />
          </Field>
          <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
            Canonical {"{tokens}"} are filled from the order at delivery time. Keep placeholders explicit and supplier-scoped before assigning a supplier.
          </div>
          {validation && (
            <div className="rounded-[7px] border border-[#B8CFF5] bg-[#F7FAFF] p-3 text-[12px] leading-5" style={{ color: "#0F4FA8" }}>
              {validation}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          {onDelete && (
            <button onClick={onDelete} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold sm:mr-auto" style={{ border: "1px solid #F5C6CB", background: "#FFFFFF", color: "#C62828" }}>Delete</button>
          )}
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: 0, background: "#0B1A2F", color: "#FFFFFF", opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
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
