"use client";

import { useState } from "react";
import type { PoMappingConfig, FieldMappingEntry } from "@/lib/api/types";

const CANONICAL_HEADER_FIELDS = ["PoNumber", "OrderDate", "BuyerName", "Currency"] as const;
const CANONICAL_LINE_FIELDS = [
  "LineNumber", "BuyerItemCode", "Description", "Quantity", "Unit", "UnitPrice"
] as const;

const EMPTY_CONFIG: PoMappingConfig = {
  hasHeaderRecord: true,
  separator: ",",
  header: {},
  lines: {},
};

interface PoMappingEditorProps {
  supplierId: string;
  initialConfig: PoMappingConfig | null;
  onSave: (config: PoMappingConfig) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving?: boolean;
}

export function PoMappingEditor({
  supplierId: _supplierId,
  initialConfig,
  onSave,
  onDelete,
  saving = false,
}: PoMappingEditorProps) {
  const [config, setConfig] = useState<PoMappingConfig>(initialConfig ?? EMPTY_CONFIG);
  const [activeSection, setActiveSection] = useState<"header" | "lines">("header");

  function updateEntry(
    section: "header" | "lines",
    field: string,
    patch: Partial<FieldMappingEntry>
  ) {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: { ...(prev[section][field] ?? {}), ...patch },
      },
    }));
  }

  const sectionFields =
    activeSection === "header" ? CANONICAL_HEADER_FIELDS : CANONICAL_LINE_FIELDS;

  return (
    <div className="rounded-[8px] overflow-hidden" style={{ border: "1px solid #E2E6EE" }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium" style={{ color: "#56627A" }}>Separator</span>
          <select
            value={config.separator}
            onChange={(e) => setConfig((p) => ({ ...p, separator: e.target.value }))}
            className="text-[12px] rounded-[5px] px-2 py-1"
            style={{ border: "1px solid #D5DAEA", background: "#FFF", color: "#0B1A2F" }}
          >
            <option value=",">, (comma)</option>
            <option value=";">; (semicolon)</option>
            <option value={"\t"}>tab</option>
            <option value="|">| (pipe)</option>
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "#56627A" }}>
          <input
            type="checkbox"
            checked={config.hasHeaderRecord}
            onChange={(e) => setConfig((p) => ({ ...p, hasHeaderRecord: e.target.checked }))}
          />
          Has header row
        </label>

        <div className="flex-1" />

        <div className="flex rounded-[6px] overflow-hidden" style={{ border: "1px solid #D5DAEA" }}>
          {(["header", "lines"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className="px-3 py-1 text-[12px] font-medium transition-colors"
              style={{
                background: activeSection === s ? "#0B1A2F" : "#FFF",
                color: activeSection === s ? "#FFF" : "#56627A",
              }}
            >
              {s === "header" ? "Order Header" : "Order Lines"}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ gridTemplateColumns: "160px 1fr 1fr", color: "#8A93A5" }}
      >
        <span>Canonical field</span>
        <span>Source column</span>
        <span>Fixed value</span>
      </div>

      {/* Mapping rows */}
      <div className="divide-y" style={{ borderColor: "#F0F2F7" }}>
        {sectionFields.map((field) => {
          const entry: FieldMappingEntry = config[activeSection][field] ?? {};
          return (
            <div
              key={field}
              className="grid items-center px-4 py-2.5"
              style={{ gridTemplateColumns: "160px 1fr 1fr" }}
            >
              <span
                className="text-[12.5px] font-medium"
                style={{ color: "#0B1A2F", fontFamily: "JetBrains Mono, monospace" }}
              >
                {field}
              </span>
              <input
                type="text"
                placeholder="CSV column name"
                value={entry.externalField ?? ""}
                onChange={(e) =>
                  updateEntry(activeSection, field, { externalField: e.target.value || undefined })
                }
                className="mr-4 rounded-[5px] px-2.5 py-1 text-[12px]"
                style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }}
              />
              <input
                type="text"
                placeholder="Fixed value (optional)"
                value={entry.fixedValue ?? ""}
                onChange={(e) =>
                  updateEntry(activeSection, field, { fixedValue: e.target.value || undefined })
                }
                className="rounded-[5px] px-2.5 py-1 text-[12px]"
                style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }}
              />
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-[12px] font-medium"
            style={{ color: "#C53A3A" }}
          >
            Delete mapping
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onSave(config)}
          disabled={saving}
          className="flex items-center rounded-[6px] px-4 text-[13px] font-semibold"
          style={{ height: 32, background: saving ? "#8A93A5" : "#0B1A2F", color: "#FFF", border: "none" }}
        >
          {saving ? "Saving..." : "Save mapping"}
        </button>
      </div>
    </div>
  );
}
