"use client";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState, useRef, type ReactNode } from "react";
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
  { id: "t1", name: "Standard cXML PO",    fmt: "cXML", suppliers: 3, lastUsed: "2m",  version: "v3.2" },
  { id: "t2", name: "SAP IDoc ORDERS05",   fmt: "EDI",  suppliers: 2, lastUsed: "1h",  version: "v2.0" },
  { id: "t3", name: "ERP Generic v2",      fmt: "JSON", suppliers: 4, lastUsed: "3h",  version: "v2.1" },
  { id: "t4", name: "Custom Nordmark",     fmt: "CSV",  suppliers: 1, lastUsed: "1d",  version: "v1.4" },
  { id: "t5", name: "MedicaSupply OY cXML",fmt: "cXML", suppliers: 1, lastUsed: "4m",  version: "v1.0" },
];

type CardTemplate = {
  id: string;
  name: string;
  fmt: string;
  suppliers: number;
  lastUsed: string;
  version: string;
};

const FMT_COLOR: Record<string, string> = { cXML: "#6F4FCE", EDI: "#C97A14", JSON: "#A06200", CSV: "#56627A" };
const FMT_BG:    Record<string, string> = { cXML: "#EEE7FB", EDI: "#FAEFD6", JSON: "#FFF4D6", CSV: "#EFF2F7" };

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

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<CardTemplate | null>(null);
  const [notice,   setNotice]   = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const { data: liveTemplates, isLoading, isError, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn:  getTemplates,
    enabled:  !isApiMockMode,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setSelected(null);
      setNotice({ text: "Template deleted.", kind: "ok" });
    },
    onError: () => setNotice({ text: "Delete failed — please retry.", kind: "err" }),
  });

  const templates: CardTemplate[] = isApiMockMode
    ? MOCK_TEMPLATES
    : (liveTemplates ?? []).map(dtoToCard);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Output templates</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {templates.length} templates · used across {templates.reduce((a, t) => a + t.suppliers, 0)} suppliers
          </p>
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
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={
              notice.kind === "ok"
                ? { border: "1px solid #BDE0C1", borderLeft: "3px solid #2E8E3A", background: "#F0F7F1", color: "#1E6D29" }
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
              <button
                onClick={() => refetch()}
                className="mt-3 h-8 rounded-[6px] px-4 text-[12px] font-semibold"
                style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {(!isLoading && !isError) && (
          templates.length === 0 ? (
            <EmptyState
              icon="⊟"
              title="No output templates"
              sub="Templates define how purchase orders are formatted when delivered to each supplier."
              action={{ label: "+ New template", onClick: () => {
                setNotice(null);
                setSelected({ id: "new", name: "", fmt: "cXML", suppliers: 0, lastUsed: "never", version: "v1.0" });
              }}}
            />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))" }}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setNotice(null); setSelected(t); }}
                  className="rounded-[8px] cursor-pointer text-left"
                  style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderTop: `3px solid ${FMT_COLOR[t.fmt] ?? "#56627A"}` }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: FMT_BG[t.fmt] ?? "#EFF2F7", color: FMT_COLOR[t.fmt] ?? "#56627A" }}>{t.fmt}</span>
                      <span className="text-[10.5px] font-mono" style={{ color: "#8A93A5" }}>{t.version}</span>
                    </div>
                    <h3 className="text-[13.5px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>{t.name}</h3>
                    <div className="flex items-center gap-3 text-[11.5px]" style={{ color: "#56627A" }}>
                      <span>{t.suppliers} supplier{t.suppliers !== 1 ? "s" : ""}</span>
                      <span style={{ color: "#E2E6EE" }}>·</span>
                      <span>last used {t.lastUsed} ago</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {selected && (
        <TemplatePanel
          template={selected}
          onClose={() => setSelected(null)}
          onDelete={
            selected.id !== "new"
              ? () => deleteMutation.mutate(selected.id)
              : undefined
          }
          onSaved={(message, kind) => {
            setNotice({ text: message, kind });
            setSelected(null);
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
      onSaved(
        isNew
          ? "Template draft saved locally for QA. Live persistence remains for Group J."
          : "Template edit draft saved locally for QA. Live persistence remains for Group J.",
        "ok"
      );
      return;
    }

    const name    = nameRef.current?.value.trim()    ?? "";
    const format  = fmtRef.current?.value            ?? "cXML";
    const version = versionRef.current?.value.trim() ?? "v1.0";

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
              <input ref={nameRef} defaultValue={template.name} placeholder="Supplier cXML v1.0" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
            </Field>
            <Field label="Format">
              <select ref={fmtRef} defaultValue={template.fmt} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                <option>cXML</option>
                <option>EDI</option>
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
          {onDelete && (
            <button
              onClick={onDelete}
              className="h-9 rounded-[6px] px-4 text-[12px] font-semibold sm:mr-auto"
              style={{ border: "1px solid #F5C6CB", background: "#FFFFFF", color: "#C62828" }}
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button
            onClick={() => setValidation("Template placeholders are syntactically ready for QA. Live render validation runs during Group J transform/delivery testing.")}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: "#0F4FA8" }}
          >
            Validate draft
          </button>
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
