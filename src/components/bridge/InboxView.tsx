"use client";

// Inbox — the order queue. Dense TanStack Table with StatusJourney in rows.
// Click a row → /inbox/[orderId] (Canonical Spine Review)

import { useRouter } from "next/navigation";
import { FileChip } from "./FileChip";
import { StatusCell, type CrossingStatus } from "./StatusJourney";

// ─── Mock data ────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: CrossingStatus;
  fmt: string;
  buyer: string;
  supplier: string;
  po: string;
  lines: number;
  value: string;
  issues: number;
  assigned: string;
  age: string;
};

const ORDERS: OrderRow[] = [
  { id: "008412", status: "review",     fmt: "PDF",   buyer: "Heinrich Industries GmbH", supplier: "Acme Components Ltd.",   po: "PO-2026-008412",  lines: 14, value: "€ 24,180.50", issues: 3, assigned: "MK", age: "2m"  },
  { id: "nrd9981",status: "new",        fmt: "cXML",  buyer: "Nordmark Logistics A/S",   supplier: "BoltWorks BV",            po: "PO-NRD-9981",     lines:  7, value: "€  8,420.00", issues: 0, assigned: "—",  age: "4m"  },
  { id: "sh44120",status: "extracting", fmt: "XLSX",  buyer: "Steelhouse Construction",  supplier: "VanDerBerg Metaal",       po: "SH-PO-44120",     lines: 32, value: "€ 71,205.18", issues: 0, assigned: "—",  age: "6m"  },
  { id: "850201", status: "failed",     fmt: "EDI",   buyer: "Centralis Pharma",         supplier: "MedicaSupply OY",         po: "850-99201",       lines: 18, value: "€ 12,408.00", issues: 6, assigned: "JT", age: "14m" },
  { id: "wmt341", status: "ready",      fmt: "EMAIL", buyer: "Westmark Tools",           supplier: "Acme Components Ltd.",   po: "WMT-2026-0341",   lines:  4, value: "€  1,920.40", issues: 0, assigned: "MK", age: "22m" },
  { id: "008411", status: "sent",       fmt: "PDF",   buyer: "Heinrich Industries GmbH", supplier: "BoltWorks BV",            po: "PO-2026-008411",  lines: 11, value: "€  5,612.00", issues: 0, assigned: "MK", age: "1h"  },
  { id: "ar1107", status: "review",     fmt: "XLSX",  buyer: "Atlas Reseller AG",        supplier: "Nordix Distribution",     po: "AR-2026-1107",    lines:  9, value: "€ 14,290.00", issues: 1, assigned: "JT", age: "1h"  },
  { id: "bmt720", status: "review",     fmt: "CSV",   buyer: "Bauer Medizintechnik",     supplier: "MedicaSupply OY",         po: "BMT-PO-7720",     lines: 22, value: "€ 38,710.20", issues: 2, assigned: "—",  age: "2h"  },
  { id: "nrd967", status: "sent",       fmt: "cXML",  buyer: "Nordmark Logistics A/S",   supplier: "VanDerBerg Metaal",       po: "PO-NRD-9967",     lines:  5, value: "€  3,408.00", issues: 0, assigned: "EL", age: "2h"  },
  { id: "sh4118", status: "ready",      fmt: "API",   buyer: "Steelhouse Construction",  supplier: "BoltWorks BV",            po: "SH-PO-44118",     lines: 16, value: "€ 19,860.00", issues: 0, assigned: "MK", age: "3h"  },
  { id: "ar1104", status: "failed",     fmt: "PDF",   buyer: "Atlas Reseller AG",        supplier: "Acme Components Ltd.",   po: "AR-2026-1104",    lines: 28, value: "€ 41,205.50", issues: 5, assigned: "EL", age: "3h"  },
  { id: "850198", status: "sent",       fmt: "EDI",   buyer: "Centralis Pharma",         supplier: "Nordix Distribution",     po: "850-99198",       lines: 12, value: "€  9,114.40", issues: 0, assigned: "JT", age: "4h"  },
];

const FILTER_CHIPS: Array<{ label: string; status?: CrossingStatus }> = [
  { label: "All" },
  { label: "New",          status: "new"        },
  { label: "Needs review", status: "review"     },
  { label: "Ready",        status: "ready"      },
  { label: "Sent",         status: "sent"       },
  { label: "Failed",       status: "failed"     },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function InboxView() {
  const router = useRouter();

  const counts = FILTER_CHIPS.map(({ status }) =>
    status ? ORDERS.filter((o) => o.status === status).length : ORDERS.length
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Page header */}
      <div
        className="flex items-end gap-4 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Inbox
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {ORDERS.length} crossings · last sync 14s ago
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            ↻ Sync
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F" }}
            onClick={() => router.push("/upload")}
          >
            ↑ Upload
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
          >
            + New crossing
          </button>
        </div>
      </div>

      {/* Filter chips + view toggle */}
      <div
        className="flex items-center gap-1.5 px-5 flex-shrink-0"
        style={{
          height: 44,
          borderBottom: "1px solid #E2E6EE",
          background: "#FFFFFF",
        }}
      >
        {FILTER_CHIPS.map(({ label, status }, i) => {
          const active = i === 0; // TODO: wire up real filter state
          return (
            <button
              key={label}
              className="flex items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors"
              style={{
                height: 26,
                border: `1px solid ${active ? "#1E66C933" : "#E2E6EE"}`,
                background: active ? "#E3EDFB" : "#FFFFFF",
                color: active ? "#0F4FA8" : "#0B1A2F",
              }}
            >
              {label}
              <span style={{ color: active ? "#0F4FA8" : "#8A93A5" }}>
                {counts[i]}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* View toggle */}
        <div
          className="flex rounded-[6px] overflow-hidden text-[12px]"
          style={{ border: "1px solid #E2E6EE" }}
        >
          <button
            className="px-3 py-1"
            style={{ background: "#FFFFFF", color: "#56627A", borderRight: "1px solid #E2E6EE" }}
            onClick={() => router.push("/bridge")}
          >
            Bridge view
          </button>
          <button
            className="px-3 py-1 font-medium"
            style={{ background: "#0B1A2F", color: "#FFFFFF" }}
          >
            List view
          </button>
        </div>
      </div>

      {/* Time-strip ribbon */}
      <div
        className="flex items-center gap-3 px-6 flex-shrink-0"
        style={{ height: 52, borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <span
          className="text-[10.5px] font-bold uppercase tracking-[0.06em] flex-shrink-0 w-[80px]"
          style={{ color: "#8A93A5" }}
        >
          Last 24h
        </span>
        <svg className="flex-1" height={32} viewBox="0 0 800 32" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rib" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1E66C9" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#1E66C9" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          {Array.from({ length: 48 }).map((_, i) => {
            const h = 6 + (Math.sin(i * 0.3) + 1.4) * 8 + (i > 38 ? 6 : 0);
            return (
              <rect
                key={i}
                x={i * 17}
                y={32 - h}
                width={13}
                height={h}
                fill="url(#rib)"
                rx={1.5}
              />
            );
          })}
          {/* Selected window */}
          <rect
            x={640}
            y={0}
            width={160}
            height={32}
            fill="#1E66C9"
            fillOpacity={0.08}
            stroke="#1E66C9"
            strokeWidth={1.5}
            rx={2}
          />
        </svg>
        <span
          className="text-[11px] font-mono flex-shrink-0 text-right"
          style={{ color: "#56627A", width: 120 }}
        >
          last 2h · 28 crossings
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ background: "#FFFFFF" }}>
        <table className="inbox-table w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {[
                "Status", "Received", "Source", "Buyer", "Supplier",
                "PO #", "Lines", "Value", "Issues", "Assigned",
              ].map((h) => (
                <th key={h} className="text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((row) => (
              <tr
                key={row.id}
                onClick={() => router.push(`/inbox/${row.id}`)}
                style={{
                  background:
                    row.status === "review"
                      ? "#FAEFD608"
                      : row.status === "failed"
                      ? "#FBE3E308"
                      : undefined,
                }}
              >
                <td>
                  <StatusCell status={row.status} />
                </td>
                <td style={{ color: "#56627A" }}>{row.age}</td>
                <td>
                  <FileChip type={row.fmt} />
                </td>
                <td>{row.buyer}</td>
                <td>{row.supplier}</td>
                <td>
                  <span className="font-mono text-[11.5px]" style={{ color: "#0F4FA8" }}>
                    {row.po}
                  </span>
                </td>
                <td className="text-right">{row.lines}</td>
                <td className="text-right font-mono text-[11.5px]">{row.value}</td>
                <td>
                  {row.issues > 0 ? (
                    <span className="font-semibold" style={{ color: "#C53A3A" }}>
                      ⚠ {row.issues}
                    </span>
                  ) : (
                    <span style={{ color: "#8A93A5" }}>—</span>
                  )}
                </td>
                <td style={{ color: "#56627A" }}>{row.assigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
