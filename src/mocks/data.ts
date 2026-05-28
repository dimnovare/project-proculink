/**
 * §11 MSW seed data — 50 orders, 12 buyers, 8 suppliers, 200 SKU mappings,
 * 12 validation rules, 30 days of crossings log.
 * All data is deterministic (no Math.random) so page refreshes are stable.
 */

import type { CrossingStatus } from "@/components/bridge/StatusJourney";

// ─── Buyers & suppliers ───────────────────────────────────────────────────────

export const BUYERS = [
  { id: "B01", name: "Heinrich Industries GmbH",  code: "HIND",  country: "DE", volume: 412 },
  { id: "B02", name: "Nordmark Logistics A/S",     code: "NRDM",  country: "DK", volume: 287 },
  { id: "B03", name: "Steelhouse Construction",    code: "STLH",  country: "FI", volume: 198 },
  { id: "B04", name: "Centralis Pharma",           code: "CPHA",  country: "SE", volume: 154 },
  { id: "B05", name: "Westmark Tools",             code: "WSTM",  country: "NO", volume: 96  },
  { id: "B06", name: "Atlas Reseller AG",          code: "ATLS",  country: "CH", volume: 341 },
  { id: "B07", name: "Bauer Medizintechnik",       code: "BMED",  country: "DE", volume: 112 },
  { id: "B08", name: "OmniRetail GmbH",            code: "OMNI",  country: "AT", volume: 229 },
  { id: "B09", name: "ThermoBloc AS",              code: "TBLC",  country: "NO", volume: 67  },
  { id: "B10", name: "MassBuild Ltd.",             code: "MSBL",  country: "GB", volume: 183 },
  { id: "B11", name: "VentureGroup NL",            code: "VTNG",  country: "NL", volume: 91  },
  { id: "B12", name: "DuraTech OÜ",               code: "DRTE",  country: "EE", volume: 58  },
] as const;

export const SUPPLIERS = [
  { id: "S01", name: "Acme Components Ltd.",    code: "ACMC",  type: "cXML PunchOut", health: "ok"   as const },
  { id: "S02", name: "BoltWorks BV",            code: "BLTW",  type: "API (REST)",    health: "down" as const },
  { id: "S03", name: "VanDerBerg Metaal",       code: "VDBM",  type: "cXML PunchOut", health: "ok"   as const },
  { id: "S04", name: "MedicaSupply OY",         code: "MDCS",  type: "EDI (SFTP)",    health: "risk" as const },
  { id: "S05", name: "Nordix Distribution",     code: "NRDX",  type: "API (REST)",    health: "ok"   as const },
  { id: "S06", name: "PrimeParts GmbH",         code: "PRMX",  type: "Email inbox",   health: "ok"   as const },
  { id: "S07", name: "OrthoTech AS",            code: "ORTH",  type: "EDI (SFTP)",    health: "ok"   as const },
  { id: "S08", name: "SteelCore BV",            code: "STLC",  type: "API (REST)",    health: "ok"   as const },
] as const;

// ─── Orders (50) ──────────────────────────────────────────────────────────────

export type Order = {
  id: string;
  status: CrossingStatus;
  fmt: string;
  buyerId: string;
  supplierId: string;
  po: string;
  lines: number;
  value: number;
  issues: number;
  assigned: string;
  ageMin: number;
  createdAt: string; // ISO
};

type Fmt = "PDF" | "cXML" | "XLSX" | "EDI" | "EMAIL" | "API" | "CSV" | "JSON";
const FMTS: Fmt[] = ["PDF", "cXML", "XLSX", "EDI", "EMAIL", "API", "CSV", "JSON"];
const STATUSES: CrossingStatus[] = ["new", "extracting", "review", "ready", "sent", "failed"];
const ASSIGNEES = ["MK", "JT", "EL", "SH", "—"];

function pad(n: number, w = 6) { return String(n).padStart(w, "0"); }
function fmtAge(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

export function generateOrders(count = 50): (Order & { buyerName: string; supplierName: string; age: string; valueLabel: string })[] {
  // Seed hand-crafted orders first
  const SEED: Omit<Order, "createdAt">[] = [
    { id: "demo-001", status: "review",     fmt: "PDF",   buyerId: "B01", supplierId: "S01", po: "PO-DEMO-001",  lines: 14, value: 24180.50, issues: 3, assigned: "MK", ageMin: 2   },
    { id: "nrd9981",status: "new",        fmt: "cXML",  buyerId: "B02", supplierId: "S02", po: "PO-NRD-9981",     lines:  7, value:  8420.00, issues: 0, assigned: "—",  ageMin: 4   },
    { id: "sh44120",status: "extracting", fmt: "XLSX",  buyerId: "B03", supplierId: "S03", po: "SH-PO-44120",     lines: 32, value: 71205.18, issues: 0, assigned: "—",  ageMin: 6   },
    { id: "850201", status: "failed",     fmt: "EDI",   buyerId: "B04", supplierId: "S04", po: "850-99201",       lines: 18, value: 12408.00, issues: 6, assigned: "JT", ageMin: 14  },
    { id: "wmt341", status: "ready",      fmt: "EMAIL", buyerId: "B05", supplierId: "S01", po: "WMT-2026-0341",   lines:  4, value:  1920.40, issues: 0, assigned: "MK", ageMin: 22  },
    { id: "008411", status: "sent",       fmt: "PDF",   buyerId: "B01", supplierId: "S02", po: "PO-2026-008411",  lines: 11, value:  5612.00, issues: 0, assigned: "MK", ageMin: 60  },
    { id: "ar1107", status: "review",     fmt: "XLSX",  buyerId: "B06", supplierId: "S05", po: "AR-2026-1107",    lines:  9, value: 14290.00, issues: 1, assigned: "JT", ageMin: 65  },
    { id: "bmt720", status: "review",     fmt: "CSV",   buyerId: "B07", supplierId: "S04", po: "BMT-PO-7720",     lines: 22, value: 38710.20, issues: 2, assigned: "—",  ageMin: 120 },
    { id: "nrd967", status: "sent",       fmt: "cXML",  buyerId: "B02", supplierId: "S03", po: "PO-NRD-9967",     lines:  5, value:  3408.00, issues: 0, assigned: "EL", ageMin: 122 },
    { id: "sh4118", status: "ready",      fmt: "API",   buyerId: "B03", supplierId: "S02", po: "SH-PO-44118",     lines: 16, value: 19860.00, issues: 0, assigned: "MK", ageMin: 185 },
    { id: "ar1104", status: "failed",     fmt: "PDF",   buyerId: "B06", supplierId: "S01", po: "AR-2026-1104",    lines: 28, value: 41205.50, issues: 5, assigned: "EL", ageMin: 190 },
    { id: "850198", status: "sent",       fmt: "EDI",   buyerId: "B04", supplierId: "S05", po: "850-99198",       lines: 12, value:  9114.40, issues: 0, assigned: "JT", ageMin: 242 },
  ];

  const rows: (Order & { buyerName: string; supplierName: string; age: string; valueLabel: string })[] = [];
  const now = new Date("2026-05-24T12:00:00Z");

  const enrich = (o: Omit<Order, "createdAt">) => {
    const buyer    = BUYERS.find(b => b.id === o.buyerId)!;
    const supplier = SUPPLIERS.find(s => s.id === o.supplierId)!;
    const createdAt = new Date(now.getTime() - o.ageMin * 60_000).toISOString();
    return {
      ...o,
      createdAt,
      buyerName: buyer.name,
      supplierName: supplier.name,
      age: fmtAge(o.ageMin),
      valueLabel: `€ ${o.value.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`,
    };
  };

  SEED.forEach(s => rows.push(enrich(s)));

  for (let i = rows.length; i < count; i++) {
    const si    = i % STATUSES.length;
    const bi    = (i * 7 + si) % BUYERS.length;
    const supi  = (i * 3 + bi) % SUPPLIERS.length;
    const ageMin= 5 + (i * 13) % (60 * 72);
    const val   = 500 + (i * 1237 + 189) % 98000 + ((i * 17) % 100) / 100;
    const issues= STATUSES[si] === "failed" ? 1 + (i % 6)
                : STATUSES[si] === "review"  ? (i % 3)
                : 0;
    rows.push(enrich({
      id: `gen-${pad(i)}`,
      status: STATUSES[si],
      fmt: FMTS[(i * 2) % FMTS.length],
      buyerId:    BUYERS[bi].id,
      supplierId: SUPPLIERS[supi].id,
      po:         `PO-2026-${100000 + i}`,
      lines:      2 + (i * 5) % 48,
      value:      val,
      issues,
      assigned:   ASSIGNEES[(i * 3) % ASSIGNEES.length],
      ageMin,
    }));
  }

  return rows;
}

export const ORDERS = generateOrders(50);

// ─── SKU Mappings (200) ───────────────────────────────────────────────────────

export type SkuMapping = {
  id: string;
  buyerCode: string;
  supplierCode: string;
  description: string;
  supplierId: string;
  confidence: number;
  source: "Manual" | "AI" | "Imported";
  usedCount: number;
};

const ITEM_NAMES = [
  "M6 Hex Bolt 40mm",      "M8 Hex Bolt 60mm",       "M10 Nut Zinc",
  "Flat Washer 10mm",      "Self-tap Screw 4×20",    "Rivnut M5",
  "Cable Tie 200mm",       "Din Rail 35mm 1m",        "Crimp Terminal 2.5mm²",
  "HDPE Tube 20×2.0",      "PVC Conduit 20mm 2m",     "Cable Gland M20",
  "Fuse 10A Ceramic",      "Circuit Breaker 16A",     "Contactor 24VDC",
  "Relay Base 8-pin",      "Pilot Light Green 22mm",  "Selector Switch 2pos",
  "Control Transformer",   "Surge Protector 3-ph",
];

export function generateMappings(count = 200): SkuMapping[] {
  const maps: SkuMapping[] = [];
  for (let i = 0; i < count; i++) {
    const supi = i % SUPPLIERS.length;
    const item = ITEM_NAMES[i % ITEM_NAMES.length];
    const buyerCode = `BUY-${(10000 + i * 7).toString(36).toUpperCase().slice(0, 6)}`;
    const supplierCode = `${SUPPLIERS[supi].code}-${(20000 + i * 3).toString(36).toUpperCase().slice(0, 5)}`;
    const conf = 50 + (i * 17) % 50;
    maps.push({
      id: `m${pad(i, 4)}`,
      buyerCode,
      supplierCode,
      description: item,
      supplierId: SUPPLIERS[supi].id,
      confidence: conf,
      source: i % 5 === 0 ? "AI" : i % 7 === 0 ? "Imported" : "Manual",
      usedCount: (i * 13) % 280,
    });
  }
  return maps;
}

export const MAPPINGS = generateMappings(200);

// ─── Validation rules (12) ────────────────────────────────────────────────────

export type ValidationRule = {
  id: string;
  name: string;
  scope: "global" | "buyer" | "supplier";
  severity: "Error" | "Warning" | "Info";
  trigger30d: number;
  enabled: boolean;
  autoBlock: boolean;
  description: string;
};

export const RULES: ValidationRule[] = [
  { id: "r01", name: "Required PO number",           scope: "global",   severity: "Error",   trigger30d: 0,   enabled: true,  autoBlock: true,  description: "Reject documents missing a purchase order identifier." },
  { id: "r02", name: "Supplier SKU must be mapped",  scope: "global",   severity: "Error",   trigger30d: 18,  enabled: true,  autoBlock: true,  description: "Every line item must resolve to a supplier SKU via the mapping table." },
  { id: "r03", name: "Qty must be positive integer", scope: "global",   severity: "Error",   trigger30d: 3,   enabled: true,  autoBlock: true,  description: "Quantity field must parse to a whole number > 0." },
  { id: "r04", name: "Unit price > 0",               scope: "global",   severity: "Warning", trigger30d: 7,   enabled: true,  autoBlock: false, description: "Lines with zero unit price are flagged for review." },
  { id: "r05", name: "Currency must be EUR",         scope: "supplier", severity: "Error",   trigger30d: 2,   enabled: true,  autoBlock: true,  description: "Supplier Acme only accepts EUR-denominated orders." },
  { id: "r06", name: "Max 50 lines per PO",          scope: "supplier", severity: "Warning", trigger30d: 4,   enabled: true,  autoBlock: false, description: "VanDerBerg Metaal order processing limit." },
  { id: "r07", name: "EDI ISA sender ID match",      scope: "buyer",    severity: "Error",   trigger30d: 0,   enabled: true,  autoBlock: true,  description: "Validate ISA06 against registered buyer IDs." },
  { id: "r08", name: "cXML payloadID unique",        scope: "global",   severity: "Warning", trigger30d: 1,   enabled: true,  autoBlock: false, description: "Detect duplicate payloadID values within 24h window." },
  { id: "r09", name: "AI confidence < 75% block",   scope: "global",   severity: "Error",   trigger30d: 12,  enabled: true,  autoBlock: true,  description: "Stop auto-processing when any field falls below 75% AI confidence." },
  { id: "r10", name: "Delivery date in future",      scope: "global",   severity: "Warning", trigger30d: 6,   enabled: true,  autoBlock: false, description: "Flag orders where requested delivery date is in the past." },
  { id: "r11", name: "Min order value €50",          scope: "supplier", severity: "Info",    trigger30d: 3,   enabled: false, autoBlock: false, description: "PrimeParts minimum order value threshold." },
  { id: "r12", name: "Duplicate PO within 7 days",   scope: "global",   severity: "Warning", trigger30d: 2,   enabled: true,  autoBlock: false, description: "Detect PO numbers seen in the last 7 days." },
];

// ─── Crossings log events (30 days) ───────────────────────────────────────────

export type LogEvent = {
  id: string;
  orderId: string;
  po: string;
  actor: "system" | "user" | "ai" | "supplier";
  actorName: string;
  type: "received" | "parsed" | "mapped" | "validated" | "human-edited" | "transformed" | "delivered" | "failed" | "retried";
  timestamp: string;
  summary: string;
  diff?: Array<{ field: string; from: string; to: string }>;
};

const EVENT_TYPES: LogEvent["type"][] = ["received","parsed","mapped","validated","delivered","failed"];
const ACTORS: Array<{ actor: LogEvent["actor"]; name: string }> = [
  { actor: "system", name: "ProcuLink"   },
  { actor: "user",   name: "MK"          },
  { actor: "ai",     name: "AI engine"   },
  { actor: "supplier",name: "Acme API"   },
];

const SUMMARIES: Record<LogEvent["type"], string> = {
  received:     "Document received from buyer channel",
  parsed:       "Document parsed — 14 lines extracted",
  mapped:       "SKU mapping applied — 13/14 matched",
  validated:    "Validation passed — 2 warnings",
  "human-edited":"Field corrected by operator",
  transformed:  "Output document generated",
  delivered:    "Delivered to supplier endpoint",
  failed:       "Delivery failed — timeout",
  retried:      "Retry attempt #1",
};

export function generateLogEvents(count = 90): LogEvent[] {
  const events: LogEvent[] = [];
  const now = new Date("2026-05-24T12:00:00Z");
  for (let i = 0; i < count; i++) {
    const order   = ORDERS[i % ORDERS.length];
    const type    = EVENT_TYPES[i % EVENT_TYPES.length];
    const actorObj= ACTORS[i % ACTORS.length];
    const minsAgo = (i * 23) % (60 * 24 * 30);
    const ts      = new Date(now.getTime() - minsAgo * 60_000).toISOString();
    events.push({
      id: `ev-${pad(i, 5)}`,
      orderId: order.id,
      po: order.po,
      actor: actorObj.actor,
      actorName: actorObj.name,
      type,
      timestamp: ts,
      summary: SUMMARIES[type],
      diff: type === "human-edited" ? [
        { field: "lines.3.qty",       from: "120",       to: "12" },
        { field: "lines.3.unitPrice", from: "0.00",      to: "4.50" },
      ] : undefined,
    });
  }
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export const LOG_EVENTS = generateLogEvents(90);
