"use client";

// Output templates — canonical split-list: template cards (left) + the
// envelope each supplier receives, previewed as code with {token} highlighting
// (right). KEEP live CRUD (create / update / delete) + the editor modal.

import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { EmptyState } from "@/components/bridge/EmptyState";
import { SrcChip, Button } from "@/components/bridge/DSPrimitives";
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
// Sampled from the 2026-05-30 design render: cXML=violet, UBL=buyer-blue,
// EDI/EDIFACT/X12=amber. (UBL is blue, NOT green, in the reference.)
const FMT_COLOR: Record<string, string> = {
  cXML: "#6F4FCE", EDI: "var(--amber)", EDIFACT: "var(--amber)", X12: "var(--amber)",
  UBL: "var(--brand-blue)", JSON: "#A06200", CSV: "var(--ink-muted)",
};

// Selection + primary-action accent for this screen is buyer-blue.
// Was const SELECT_BLUE = "#1E66C9" → now var(--brand-blue) everywhere.
const SELECT_BLUE = "var(--brand-blue)";

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

  // Real export — downloads the previewed envelope as a file so the success
  // notice is truthful (was a no-op setNotice before).
  const exportTemplate = (t: CardTemplate) => {
    const ext = (
      { CXML: "xml", UBL: "xml", EDI: "edi", EDIFACT: "edi", X12: "x12", JSON: "json", CSV: "csv" } as Record<string, string>
    )[t.fmt.toUpperCase()] ?? "txt";
    const body = previewFor(t.fmt).join("\n");
    const safeName = t.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "template";
    const blob = new Blob([body], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice({ text: `Exported ${t.name}.`, kind: "ok" });
  };

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Output templates"
        sub={`The envelope each supplier receives · ${templates.length} template${templates.length !== 1 ? "s" : ""}`}
        actions={
          // In-app primary CTA = brand-green per the unified design system.
          <button
            onClick={newTemplate}
            className="inline-flex h-[44px] sm:h-[27px] w-full sm:w-auto items-center justify-center gap-[7px] rounded-[6px] px-3.5 text-[13px] font-semibold tracking-[-0.005em] transition-colors sm:px-[14px] sm:text-[12.5px]"
            style={{ background: "var(--brand-green)", color: "var(--surface)", border: "1px solid transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-green-deep)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--brand-green)")}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span> New template
          </button>
        }
      />

        {notice && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={
              notice.kind === "ok"
                ? { border: "1px solid var(--brand-green-soft)", borderLeft: "3px solid var(--brand-green)", background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" }
                : { border: "1px solid #F5C6CB", borderLeft: "3px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" }
            }
          >
            {notice.text}
          </div>
        )}

        {!isApiMockMode && isLoading && (
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-[8px] animate-pulse" style={{ height: 104, background: "var(--border)", border: "1px solid var(--border)" }} />
              ))}
            </div>
            <div className="hidden rounded-[8px] animate-pulse lg:block" style={{ height: 340, background: "var(--border)", border: "1px solid var(--border)" }} />
          </div>
        )}

        {!isApiMockMode && isError && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="rounded-[8px] px-5 py-4 text-center" style={{ border: "1px solid var(--danger-soft)", background: "var(--danger-soft)" }}>
              <p className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>Could not load templates</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>Check the API connection and try again.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-3">Retry</Button>
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
            <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
              {/* Left: template cards (.split-list left column · .col.gap-2) */}
              <div className="flex flex-col gap-2">
                {templates.map((t) => {
                  const active = selId === t.id;
                  const accent = FMT_COLOR[t.fmt] ?? "var(--ink-muted)";
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setNotice(null); setSelId(t.id); }}
                      className="relative rounded-[8px] text-left overflow-hidden transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[2px]"
                      style={{
                        background: "var(--surface)",
                        border: `1px solid ${active ? SELECT_BLUE : "var(--border)"}`,
                        boxShadow: active ? `0 0 0 1px ${SELECT_BLUE}` : "none",
                        padding: "13px 15px 13px 17px",
                      }}
                    >
                      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
                      <div className="flex items-center justify-between gap-2">
                        <SrcChip type={t.fmt} />
                        {t.isDefault && (
                          <span className="inline-flex items-center rounded-[4px] text-[11px] font-semibold" style={{ height: 22, padding: "0 8px", background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" }}>Default</span>
                        )}
                      </div>
                      <div className="text-[13px] font-semibold tracking-[-0.005em]" style={{ color: "var(--ink)", marginTop: 8 }}>{t.name}</div>
                      <div className="text-[11.5px] leading-[1.45]" style={{ color: "var(--ink-muted)", marginTop: 3 }}>{FMT_DESC[t.fmt] ?? `${t.fmt} output envelope.`}</div>
                      <div className="text-[11px]" style={{ color: "var(--ink-faint)", marginTop: 9 }}>
                        {t.suppliers > 0 ? (
                          <>
                            <span style={{ fontWeight: 600, color: "var(--ink-muted)" }}>
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

              {/* Right: code preview panel — plain div because Card applies 18px
                  internal padding and does not accept a style prop for override. */}
              {selected && (
                <div className="overflow-hidden self-start" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-card)" }}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex-shrink-0" style={{ color: "var(--ink-muted)", fontSize: 14 }}>{"</>"}</span>
                      <span className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{selected.name}</span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <span className="hidden text-[11px] font-mono sm:inline" style={{ color: "var(--ink-faint)" }}>v{selected.version}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => exportTemplate(selected)}
                      >
                        ↓ Export
                      </Button>
                    </div>
                  </div>
                  <pre
                    className="m-0 overflow-x-auto"
                    style={{ padding: "14px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.7, background: "#FCFCFD", color: "#345470" }}
                  >
                    {previewFor(selected.fmt).map((line, i) => <PreviewLine key={i} line={line} />)}
                  </pre>
                  <div className="flex flex-col items-stretch gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                    <span className="text-[12px] leading-[1.45] sm:text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      <span style={{ color: "#6F4FCE", fontWeight: 600 }}>{"{tokens}"}</span> are filled from the canonical order at delivery time.
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setNotice(null); setEditing(selected); }}
                      className="w-full sm:w-auto"
                    >
                      ✎ Edit template
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

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
    </PageShell>
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
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[680px] sm:rounded-[10px]" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] text-[16px]"
              style={{ background: "var(--brand-blue-soft)", color: "var(--brand-blue)" }}
              aria-hidden
            >
              ▤
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold leading-tight truncate" style={{ color: "var(--ink)" }}>{isNew ? "New output template" : template.name}</h2>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>The envelope a supplier receives</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 flex-shrink-0 rounded-[6px] text-[16px] transition-colors" style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-muted)" }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--ink-muted)" }}>
            Choose the standard and starting point. You&rsquo;ll map canonical order fields into the envelope after creating.
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px_110px]">
            <Field label="Template name">
              <input ref={nameRef} defaultValue={template.name} placeholder="cXML 1.2.045 — OrderRequest" className="h-10 w-full rounded-[6px] border border-[#C6CDDA] px-2.5 text-[13px] text-[#0B1A2F] outline-none focus:border-[var(--brand-blue)]" />
            </Field>
            <Field label="Standard">
              <select ref={fmtRef} defaultValue={template.fmt} className="h-10 w-full rounded-[6px] border border-[#C6CDDA] px-2.5 text-[13px] text-[#0B1A2F] outline-none focus:border-[var(--brand-blue)]">
                <option>cXML</option>
                <option>UBL</option>
                <option>EDI</option>
                <option>X12</option>
                <option>JSON</option>
                <option>CSV</option>
              </select>
            </Field>
            <Field label="Version">
              <input ref={versionRef} defaultValue={template.version} className="h-10 w-full rounded-[6px] border border-[#C6CDDA] px-2.5 font-mono text-[13px] text-[#0B1A2F] outline-none focus:border-[var(--brand-blue)]" />
            </Field>
          </div>
          <Field label="Template body">
            <textarea
              ref={bodyRef}
              defaultValue={'<OrderRequest orderID="{po}">\n  <ItemOut sku="{item}" quantity="{qty}" />\n</OrderRequest>'}
              className="min-h-[180px] w-full rounded-[5px] border border-[#D5DAEA] bg-[#0B1A2F] px-3 py-3 font-mono text-[11.5px] leading-5 text-[#C5D2E4]"
            />
          </Field>
          <div className="rounded-[7px] p-3 text-[13px] leading-5 sm:text-[12px]" style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink-muted)" }}>
            Canonical {"{tokens}"} are filled from the order at delivery time. Keep placeholders explicit and supplier-scoped before assigning a supplier.
          </div>
          {validation && (
            <div className="rounded-[7px] p-3 text-[13px] leading-5 sm:text-[12px]" style={{ border: "1px solid var(--brand-blue-soft)", background: "var(--brand-blue-soft)", color: "var(--brand-blue-deep)" }}>
              {validation}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end" style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          {onDelete && (
            <Button variant="danger" size="md" onClick={onDelete} className="sm:mr-auto">Delete</Button>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={saving}
            loading={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>{label}</span>
      {children}
    </label>
  );
}
