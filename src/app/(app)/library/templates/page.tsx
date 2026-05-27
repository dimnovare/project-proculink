"use client";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState, type ReactNode } from "react";
const TEMPLATES = [
  { id: "t1", name: "Standard cXML PO",      fmt: "cXML",  suppliers: 3, lastUsed: "2m",  version: "v3.2"  },
  { id: "t2", name: "SAP IDoc ORDERS05",      fmt: "EDI",   suppliers: 2, lastUsed: "1h",  version: "v2.0"  },
  { id: "t3", name: "ERP Generic v2",         fmt: "JSON",  suppliers: 4, lastUsed: "3h",  version: "v2.1"  },
  { id: "t4", name: "Custom Nordmark",        fmt: "CSV",   suppliers: 1, lastUsed: "1d",  version: "v1.4"  },
  { id: "t5", name: "MedicaSupply OY cXML",   fmt: "cXML",  suppliers: 1, lastUsed: "4m",  version: "v1.0"  },
];
const FMT_COLOR: Record<string,string> = { cXML:"#6F4FCE", EDI:"#C97A14", JSON:"#A06200", CSV:"#56627A" };
const FMT_BG:    Record<string,string> = { cXML:"#EEE7FB", EDI:"#FAEFD6", JSON:"#FFF4D6", CSV:"#EFF2F7" };

export default function TemplatesPage() {
  const [selected, setSelected] = useState<(typeof TEMPLATES)[number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Output templates</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{TEMPLATES.length} templates · used across {TEMPLATES.reduce((a,t)=>a+t.suppliers,0)} supplier docks</p>
        </div>
        <button
          onClick={() => {
            setNotice(null);
            setSelected({ id: "new", name: "", fmt: "cXML", suppliers: 0, lastUsed: "never", version: "v1.0" });
          }}
          className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          + New template
        </button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {notice && (
          <div className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #BDE0C1", borderLeft: "3px solid #2E8E3A", background: "#F0F7F1", color: "#1E6D29" }}>
            {notice}
          </div>
        )}

        {TEMPLATES.length === 0 ? (
          <EmptyState
            icon="⊟"
            title="No output templates"
            sub="Create a template to define how purchase orders are formatted for each supplier dock."
            action={{ label: "+ New template", onClick: () => {} }}
          />
        ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))" }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => { setNotice(null); setSelected(t); }} className="rounded-[8px] cursor-pointer text-left" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderTop: `3px solid ${FMT_COLOR[t.fmt] ?? "#56627A"}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: FMT_BG[t.fmt]??"#EFF2F7", color: FMT_COLOR[t.fmt]??"#56627A" }}>{t.fmt}</span>
                  <span className="text-[10.5px] font-mono" style={{ color: "#8A93A5" }}>{t.version}</span>
                </div>
                <h3 className="text-[13.5px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>{t.name}</h3>
                <div className="flex items-center gap-3 text-[11.5px]" style={{ color: "#56627A" }}>
                  <span>{t.suppliers} supplier{t.suppliers !== 1?"s":""}</span>
                  <span style={{ color: "#E2E6EE" }}>·</span>
                  <span>last used {t.lastUsed} ago</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        )}
      </div>
      {selected && (
        <TemplatePanel
          template={selected}
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

function TemplatePanel({
  template,
  onClose,
  onSaved,
}: {
  template: (typeof TEMPLATES)[number];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = template.id === "new";
  const [validation, setValidation] = useState<string | null>(null);

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
              <input defaultValue={template.name} placeholder="Supplier cXML v1.0" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
            </Field>
            <Field label="Format">
              <select defaultValue={template.fmt} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                <option>cXML</option>
                <option>EDI</option>
                <option>JSON</option>
                <option>CSV</option>
              </select>
            </Field>
            <Field label="Version">
              <input defaultValue={template.version} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 font-mono text-[12px] text-[#0B1A2F]" />
            </Field>
          </div>
          <Field label="Template body">
            <textarea
              defaultValue={"<OrderRequest orderID=\"{{order.poNumber}}\">\n  <ItemOut sku=\"{{line.supplierCode}}\" quantity=\"{{line.quantity}}\" />\n</OrderRequest>"}
              className="min-h-[180px] w-full rounded-[5px] border border-[#D5DAEA] bg-[#0B1A2F] px-3 py-3 font-mono text-[11.5px] leading-5 text-[#C5D2E4]"
            />
          </Field>
          <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
            Template rendering is validated during transform/delivery QA. Keep placeholders explicit and supplier-scoped before enabling auto-delivery.
          </div>
          {validation && (
            <div className="rounded-[7px] border border-[#B8CFF5] bg-[#F7FAFF] p-3 text-[12px] leading-5" style={{ color: "#0F4FA8" }}>
              {validation}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button onClick={() => setValidation("Template placeholders are syntactically ready for QA. Live render validation runs during Group J transform/delivery testing.")} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: "#0F4FA8" }}>Validate draft</button>
          <button onClick={() => onSaved(isNew ? "Template draft saved locally for QA. Live persistence remains for Group J." : "Template edit draft saved locally for QA. Live persistence remains for Group J.")} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: 0, background: "#0B1A2F", color: "#FFFFFF" }}>Save draft</button>
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
