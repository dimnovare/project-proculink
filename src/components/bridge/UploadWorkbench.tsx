"use client";

// Upload Workbench — XCard dropzone + pipeline picker + recent uploads.
// Translated from Bridge_Upload in v2-prototype.jsx.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileChip } from "./FileChip";

// Pipeline stages for the upload animation
const PIPELINE_STAGES = ["Parse", "Normalize", "Validate", "Transform"] as const;
const STAGE_MS = 600;

// ─── Types ────────────────────────────────────────────────────────────────────

type FormatKey = "PDF" | "XLSX" | "CSV" | "cXML" | "EDI" | "JSON" | "EMAIL";
type ModeKey   = "auto" | "manual";

// ─── Mock recent uploads ──────────────────────────────────────────────────────

const RECENT: Array<{
  name: string;
  fmt: FormatKey;
  buyer: string;
  supplier: string;
  size: string;
  age: string;
  status: "processing" | "done" | "failed" | "draft";
}> = [
  { name: "PO-2026-008412.pdf",   fmt: "PDF",   buyer: "Heinrich Industries",  supplier: "Acme Components",    size: "214 KB", age: "2m",  status: "processing" },
  { name: "NRD_orders_may.xlsx",  fmt: "XLSX",  buyer: "Nordmark Logistics",   supplier: "VanDerBerg Metaal",  size: "88 KB",  age: "18m", status: "done"       },
  { name: "850-99201.edi",        fmt: "EDI",   buyer: "Centralis Pharma",     supplier: "MedicaSupply OY",    size: "12 KB",  age: "1h",  status: "failed"     },
  { name: "westmark_q2.csv",      fmt: "CSV",   buyer: "Westmark Tools",       supplier: "Acme Components",    size: "44 KB",  age: "3h",  status: "done"       },
  { name: "AR-2026-1107.xlsx",    fmt: "XLSX",  buyer: "Atlas Reseller AG",    supplier: "Nordix Distribution",size: "132 KB", age: "3h",  status: "draft"      },
];

const FORMATS: FormatKey[] = ["PDF", "XLSX", "CSV", "cXML", "EDI", "JSON", "EMAIL"];

const BUYERS  = ["Heinrich Industries", "Nordmark Logistics", "Steelhouse Const.", "Centralis Pharma", "Westmark Tools", "Atlas Reseller AG"];
const SUPPLIERS = ["Acme Components", "BoltWorks BV", "VanDerBerg Metaal", "Nordix Distribution", "MedicaSupply OY"];
const TEMPLATES = ["Standard cXML PO", "SAP IDoc ORDERS05", "ERP Generic v2", "Custom Nordmark"];

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  processing: { bg: "#EEE7FB", color: "#6F4FCE", label: "Processing" },
  done:       { bg: "#E2F1E2", color: "#1E6D29", label: "Done"       },
  failed:     { bg: "#FBE3E3", color: "#C53A3A", label: "Failed"     },
  draft:      { bg: "#EFF2F7", color: "#56627A", label: "Draft"      },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function XCard({
  edge = "none",
  edgeColor = "#1E66C9",
  children,
  style,
}: {
  edge?: "top" | "left" | "none";
  edgeColor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const borderStyle: React.CSSProperties =
    edge === "top"
      ? { borderTop: `2px solid ${edgeColor}` }
      : edge === "left"
      ? { borderLeft: `2px solid ${edgeColor}` }
      : {};

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(11,26,47,0.05)",
        overflow: "hidden",
        ...borderStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UploadWorkbench() {
  const [dragging, setDragging]     = useState(false);
  const [buyer, setBuyer]           = useState(BUYERS[0]);
  const [supplier, setSupplier]     = useState(SUPPLIERS[0]);
  const [template, setTemplate]     = useState(TEMPLATES[0]);
  const [mode, setMode]             = useState<ModeKey>("auto");
  const [uploading, setUploading]   = useState(false);
  const [pipelineStage, setPipelineStage] = useState(-1);
  const [uploadError, setUploadError] = useState<{ code: string; message: string } | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const router = useRouter();

  async function getAuthHeader(): Promise<Record<string, string>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = await (window as any).Clerk?.session?.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function handleUpload() {
    if (uploading) return;
    setUploadError(null);
    setUploading(true);
    setPipelineStage(0);

    try {
      const headers = await getAuthHeader();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5223"}/api/orders/upload`,
        { method: "POST", headers }
      ).catch(() => null);

      if (res?.status === 429) {
        const body = await res.json().catch(() => ({}));
        const code = (body as Record<string, string>).error ?? "order_limit_reached";
        setUploadError({
          code,
          message:
            code === "pilot_expired"
              ? "Your Pilot has ended."
              : `You've reached your ${(body as Record<string, unknown>).limit ?? ""}-order monthly limit.`,
        });
        setUploading(false);
        setPipelineStage(-1);
        return;
      }
    } catch {
      // Network error — fall through to animation (demo mode)
    }

    // Animate pipeline stages
    PIPELINE_STAGES.forEach((_, i) => {
      const t = setTimeout(() => setPipelineStage(i), i * STAGE_MS);
      timerRefs.current.push(t);
    });
    const total = setTimeout(() => {
      router.push("/inbox/008412");
    }, PIPELINE_STAGES.length * STAGE_MS + 200);
    timerRefs.current.push(total);
  }

  // Cleanup timers on unmount
  useEffect(() => () => { timerRefs.current.forEach(clearTimeout); }, []);

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
            Upload Workbench
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Drop a source document, set the route, and bridge it across.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-5">
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 320px" }}>
          {/* Left column: dropzone + recent */}
          <div className="flex flex-col gap-4">
            {/* Drop zone — XCard edge="top" with link-spine gradient */}
            <XCard
              edge="top"
              edgeColor="transparent"
              style={{
                borderTop: dragging
                  ? "2px solid #1E66C9"
                  : "2px solid transparent",
                backgroundImage: dragging
                  ? undefined
                  : "none",
                position: "relative",
              }}
            >
              {/* Gradient top border trick */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: dragging
                    ? "#1E66C9"
                    : "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
                  borderRadius: "8px 8px 0 0",
                }}
              />

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); }}
                style={{
                  margin: 16,
                  marginTop: 18,
                  border: `2px dashed ${dragging ? "#1E66C9" : "#C6CDDA"}`,
                  borderRadius: 6,
                  padding: "40px 24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  background: dragging ? "#E3EDFB40" : "#F6F7FA",
                  transition: "all 0.15s",
                  cursor: "pointer",
                }}
              >
                {/* Upload icon */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#E3EDFB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path
                      d="M11 14V4M11 4L7 8M11 4l4 4"
                      stroke="#1E66C9"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
                      stroke="#1E66C9"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div className="text-center">
                  <p
                    className="text-[14px] font-semibold"
                    style={{ color: "#0B1A2F" }}
                  >
                    Drop your source document here
                  </p>
                  <p className="text-[12.5px] mt-1" style={{ color: "#56627A" }}>
                    or{" "}
                    <button
                      className="font-medium underline underline-offset-2"
                      style={{ color: "#1E66C9" }}
                    >
                      browse files
                    </button>
                  </p>
                </div>

                {/* Format chips */}
                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  {FORMATS.map((f) => (
                    <FileChip key={f} type={f} />
                  ))}
                </div>
              </div>
            </XCard>

            {/* Recent uploads */}
            <XCard edge="left" edgeColor="#E2E6EE">
              <div
                className="flex items-center px-4 py-3"
                style={{ borderBottom: "1px solid #E2E6EE" }}
              >
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "#0B1A2F" }}
                >
                  Recent uploads
                </span>
                <span className="ml-2 text-[11.5px]" style={{ color: "#8A93A5" }}>
                  · last 24 hours
                </span>
                <div className="flex-1" />
                <button
                  className="text-[12px] font-medium"
                  style={{ color: "#1E66C9" }}
                >
                  View all ↗
                </button>
              </div>

              <table
                className="w-full border-collapse"
                style={{ fontSize: 12.5 }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E6EE" }}>
                    {["File", "Format", "Route", "Size", "Age", "Status"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                          style={{ color: "#8A93A5" }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {RECENT.map((row, i) => {
                    const pill = STATUS_PILL[row.status];
                    return (
                      <tr
                        key={i}
                        className="transition-colors cursor-pointer"
                        style={{ borderBottom: "1px solid #F0F2F6" }}
                        onMouseEnter={(e) =>
                          ((e.currentTarget as HTMLElement).style.background =
                            "#F6F7FA")
                        }
                        onMouseLeave={(e) =>
                          ((e.currentTarget as HTMLElement).style.background =
                            "transparent")
                        }
                      >
                        <td className="px-4 py-2.5">
                          <span
                            className="font-mono text-[11.5px]"
                            style={{ color: "#0B1A2F" }}
                          >
                            {row.name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <FileChip type={row.fmt} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="text-[12px]"
                            style={{ color: "#1E66C9" }}
                          >
                            {row.buyer}
                          </span>
                          <span
                            className="mx-1 text-[11px]"
                            style={{ color: "#C6CDDA" }}
                          >
                            →
                          </span>
                          <span
                            className="text-[12px]"
                            style={{ color: "#2E8E3A" }}
                          >
                            {row.supplier}
                          </span>
                        </td>
                        <td
                          className="px-4 py-2.5 text-[12px]"
                          style={{ color: "#56627A" }}
                        >
                          {row.size}
                        </td>
                        <td
                          className="px-4 py-2.5 text-[12px]"
                          style={{ color: "#8A93A5" }}
                        >
                          {row.age}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: pill.bg, color: pill.color }}
                          >
                            {pill.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </XCard>
          </div>

          {/* Right column: pipeline picker */}
          <div className="flex flex-col gap-4">
            <XCard edge="left" edgeColor="#1E66C9">
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid #E2E6EE" }}
              >
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "#0B1A2F" }}
                >
                  Pipeline configuration
                </span>
              </div>

              <div className="px-4 py-4 flex flex-col gap-4">
                {/* Buyer */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#1E66C9" }}
                  >
                    Buyer dock
                  </label>
                  <select
                    value={buyer}
                    onChange={(e) => setBuyer(e.target.value)}
                    className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      outline: "none",
                    }}
                  >
                    {BUYERS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* Route arrow */}
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
                    }}
                  />
                  <span
                    className="text-[11px] font-mono"
                    style={{ color: "#8A93A5" }}
                  >
                    routes to
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
                    }}
                  />
                </div>

                {/* Supplier */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#2E8E3A" }}
                  >
                    Supplier dock
                  </label>
                  <select
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      outline: "none",
                    }}
                  >
                    {SUPPLIERS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div
                  style={{ height: 1, background: "#E2E6EE" }}
                />

                {/* Output template */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#8A93A5" }}
                  >
                    Output template
                  </label>
                  <select
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="w-full rounded-[6px] px-3 py-2 text-[13px] appearance-none"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      outline: "none",
                    }}
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Mode toggle */}
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "#8A93A5" }}
                  >
                    Processing mode
                  </label>
                  <div
                    className="flex rounded-[6px] overflow-hidden text-[12.5px]"
                    style={{ border: "1px solid #E2E6EE" }}
                  >
                    {(["auto", "manual"] as ModeKey[]).map((m) => (
                      <button
                        key={m}
                        className="flex-1 py-2 font-medium capitalize transition-colors"
                        style={{
                          background:
                            mode === m ? "#0B1A2F" : "#FFFFFF",
                          color: mode === m ? "#FFFFFF" : "#56627A",
                          borderRight: m === "auto" ? "1px solid #E2E6EE" : undefined,
                        }}
                        onClick={() => setMode(m)}
                      >
                        {m === "auto" ? "Auto-process" : "Manual review"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto-process warning */}
                {mode === "auto" && (
                  <div
                    className="flex gap-2 rounded-[6px] px-3 py-2.5"
                    style={{ background: "#FAEFD6", border: "1px solid #F0D98A" }}
                  >
                    <span style={{ color: "#C97A14", fontSize: 14, flexShrink: 0 }}>
                      ⚠
                    </span>
                    <p className="text-[11.5px]" style={{ color: "#7A5000" }}>
                      Auto-process will cross the bridge without human review.
                      Enable only for trusted routes.
                    </p>
                  </div>
                )}

                {/* 429 billing error banner */}
                {uploadError && (
                  <div style={{
                    borderRadius: 7,
                    padding: "10px 14px",
                    background: "#FAEFD6",
                    border: "1px solid #C97A14",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    fontSize: 12.5,
                    color: "#7A4A0A",
                  }}>
                    <span>{uploadError.message}</span>
                    <a
                      href="/settings"
                      style={{ fontWeight: 600, color: "#C97A14", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      {uploadError.code === "pilot_expired"
                        ? "Upgrade to continue →"
                        : "Upgrade your plan →"}
                    </a>
                  </div>
                )}

                {/* Pipeline progress (shown while uploading) */}
                {uploading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "space-between" }}>
                      {PIPELINE_STAGES.map((stage, i) => {
                        const done    = i < pipelineStage;
                        const active  = i === pipelineStage;
                        const pending = i > pipelineStage;
                        return (
                          <div key={stage} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{
                              height: 3,
                              borderRadius: 99,
                              width: "100%",
                              background: done    ? "#2E8E3A"
                                        : active  ? "#1E66C9"
                                        : "#E2E6EE",
                              transition: "background 0.3s",
                              position: "relative",
                              overflow: "hidden",
                            }}>
                              {active && (
                                <div style={{
                                  position: "absolute",
                                  inset: 0,
                                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                                  animation: "pipeline-shimmer 0.8s linear infinite",
                                }} />
                              )}
                            </div>
                            <span style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: "0.04em",
                              color: done ? "#2E8E3A" : active ? "#1E66C9" : "#C6CDDA",
                              transition: "color 0.2s",
                            }}>
                              {done ? "✓ " : ""}{stage}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <style>{`@keyframes pipeline-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }`}</style>
                  </div>
                )}

                {/* Bridge button */}
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="w-full rounded-[6px] py-2.5 text-[13px] font-semibold transition-all"
                  style={{
                    background: uploading
                      ? "#E2E6EE"
                      : "linear-gradient(90deg, #1E66C9 0%, #2E8E3A 100%)",
                    color: uploading ? "#8A93A5" : "#FFFFFF",
                    border: "none",
                    boxShadow: uploading ? "none" : "0 2px 8px rgba(30,102,201,0.25)",
                    cursor: uploading ? "not-allowed" : "pointer",
                  }}
                >
                  {uploading ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #C6CDDA", borderTopColor: "#1E66C9", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      Bridging…
                    </span>
                  ) : "↑ Upload & bridge"}
                </button>
              </div>
            </XCard>

            {/* Tip card */}
            <XCard>
              <div className="px-4 py-3">
                <p
                  className="text-[11.5px] font-semibold mb-1"
                  style={{ color: "#6F4FCE" }}
                >
                  ✦ AI extraction
                </p>
                <p className="text-[11.5px] leading-relaxed" style={{ color: "#56627A" }}>
                  Unstructured PDFs and emails are parsed by our extraction engine.
                  Field confidence is shown per-zone in the Spine Review.
                </p>
              </div>
            </XCard>
          </div>
        </div>
      </div>
    </div>
  );
}
