"use client";

// Inbox — TanStack Table order queue
// Sort on every column header · filter chips by status · bulk-select rows
// Click a row → /inbox/[orderId] (Canonical Spine Review)

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary, OrderStatus } from "@/types/procurement";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type VisibilityState,
  type RowData,
} from "@tanstack/react-table";
import { FileChip } from "./FileChip";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { StatusJourney, failedStageFor, isFailureStatus, type CrossingStatus, type OrderStage } from "./StatusJourney";
import { UnifiedStatusBadge, statusLabel } from "@/components/bridge/UnifiedStatusBadge";
import { tv2DotColor } from "@/components/bridge/layout/listTableV2";
import { useOrderDirection, type PartyLabels } from "@/hooks/useOrderDirection";
import {
  bulkSendConfirmCopy,
  bulkSendNeedsDuplicateConfirm,
  formatBulkSendResult,
  isBulkSelectable,
  isRowSendable,
  ROW_SEND_CTA,
  ROW_SEND_CTA_PROGRESS,
  rowSendFailedCopy,
  rowSendStartedCopy,
  shouldShowBulkBar,
  type BulkSendResult,
} from "./inboxSend";
import {
  FAILED_BUCKET,
  countFor,
  statusesForLabel,
  sumStatuses,
} from "./orderCountContract";
import {
  PIPELINE_STAGE_NAMES,
  pipelineAccessibleName,
  pipelineCaption,
  pipelineCardLine,
} from "./pipelineIndicator";
import {
  inboxChipIndexFor,
  inboxSortingFor,
  resolveInboxStatusParam,
} from "./inboxUrlFilter";
import { useConfirm } from "@/components/ui/confirm";

// Per-column metadata. `numeric` right-aligns value cells; `label` is the
// human-readable name shown in the desktop "Columns" visibility menu (the raw
// header for hideable columns is a plain string, but display columns have no
// string header, so we carry an explicit label).
declare module "@tanstack/react-table" {
  // TData/TValue mirror react-table's own ColumnMeta signature; they're part of
  // the augmented interface contract even though this app doesn't reference them.
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
    label?: string;
  }
}

// ─── Accent palette ─────────────────────────────────────────────────────────────
// Bridge Layer semantic palette (mirrors --brand-* / chrome in globals.css):
//   BLUE  = primary action + buyer side + the "active / in-progress" pipeline node
//   GREEN = supplier side + "done" pipeline node
//   NAVY  = display ink (PO numbers, page title, chips chrome)
// Kept as local consts so every inline style swaps from one place.
const BLUE       = "#1E66C9"; // --brand-blue        (primary action)
const BLUE_DEEP  = "#0F4FA8"; // --brand-blue-deep   (hover / buyer text)
const GREEN_DEEP = "#1E6D29"; // --brand-green-deep  (supplier text)
const NAVY       = "#0B1A2F"; // --ink / --navy      (display ink)
const INK        = NAVY;      // alias kept for existing references

// ─── Pipeline stage mapping ─────────────────────────────────────────────────────
// STATUS column → soft pill via the ported .pill / .pill-* classes (leading dot +
// full semantic label). PIPELINE column → standalone 5-node .journey.compact track.
// `key` maps each CrossingStatus onto its globals.css .pill-* / status class.
// NOTE: this is the single source of truth for order-status DISPLAY LABELS in the
// inbox. It should later consolidate into the canonical map in
// src/components/bridge/UnifiedStatusBadge.tsx (STATUS_META), which keys on raw
// backend OrderStatus rather than the collapsed CrossingStatus used here — keep
// the label vocabulary in sync until then.
//   - `ready`      → "Ready to send": every check passed, nothing queued yet
//                    (Parse→Normalize→Validate→[Transform]→Deliver, stage 3). It is
//                    the HUMAN's turn. (WP-25 / DESIGN-DB-1 §6.4 row 57.)
//   - `delivering` → carries the post-transform backend `ready_to_deliver` status
//                    (see mapStatus): the output file is built and the send is
//                    pending — OUR turn. Labelled "Queued to send", the same words
//                    as the chip that filters `ready_to_deliver`, so badge and chip
//                    can never disagree (the regression this comment guards).
//   - `sending`    → carries the backend `delivering` status: claimed by the Worker
//                    and in flight right now. Labelled "Sending" to match
//                    STATUS_META.delivering, and NOT "Queued to send" (it is past
//                    that) nor "Delivered" (the supplier does not have it yet).
// `stage: null` = "no single stage": the collapsed `failed` slot folds five raw
// failure statuses that failed at DIFFERENT nodes, so its journey stage must be
// derived per-row from rawStatus (journeyStage below) — a constant here could only
// hardcode one node for all five, which is the bug this replaced.
export const STATUS_PRESENTATION: Record<
  CrossingStatus,
  { key: string; label: string; stage: OrderStage | null }
> = {
  new:        { key: "new",        label: "New",            stage: 0 },
  // Stage 0, not 1. An order being read is AT Parse; stage 1 drew Parse as done for the
  // one status that means Parse is still running — and it contradicted the dashboard,
  // whose journeyStageFor("parsing") has been pinned to 0 all along
  // (statusJourneyFailedStage.test.tsx:100). `new` shares the node on purpose: queued
  // and parsing are both at Parse, told apart by the badge word, not by the track.
  extracting: { key: "extracting", label: "Extracting",     stage: 0 },
  unrouted:   { key: "unrouted",   label: "Needs supplier", stage: 1 },
  review:     { key: "review",     label: "Needs review",   stage: 2 },
  ready:      { key: "ready",      label: "Ready to send",  stage: 3 },
  // The output file is being built — the Transform node, three past where this used to
  // draw it. Its own slot (rather than folding into `extracting`) is what stops the
  // mobile card saying "Extracting" while the desktop badge says "Preparing output".
  transforming: { key: "transforming", label: "Preparing output", stage: 3 },
  sent:       { key: "sent",       label: "Delivered",      stage: 4 },
  delivering: { key: "delivering", label: "Queued to send", stage: 4 },
  sending:    { key: "sending",    label: "Sending",        stage: 4 },
  held:       { key: "held",       label: "Delivery paused", stage: 4 },
  unconfirmed: { key: "unconfirmed", label: "Delivery unknown", stage: 4 },
  // The collapsed failure slot folds five raw statuses that failed at different
  // stages, so it cannot name any one of them ("Couldn't read file" would be a
  // lie on a rejected order). It stays "Failed" — plain English, and the SAME
  // word as the chip that filters it, so chip and row can never disagree.
  failed:     { key: "failed",     label: "Failed",         stage: null },
};

/**
 * Journey stage for one inbox row. Non-failed statuses have a fixed stage
 * (STATUS_PRESENTATION); a failed row derives its node from the RAW status —
 * `transform_failed` puts the X on Transform, the three delivery failures on
 * Deliver, bare `failed` (the parse-terminal status) on Parse.
 */
export function journeyStage(status: CrossingStatus, rawStatus: string): OrderStage {
  const preset = STATUS_PRESENTATION[status].stage;
  if (preset !== null) return preset;
  // status === "failed" here, and mapStatus only returns "failed" for the five
  // FAILURE_JOURNEY_STAGE keys, so the guard passes for every reachable row. The
  // fallback exists for an out-of-contract raw status (a sixth backend failure
  // status this mirror hasn't learned): render it as failed-at-Deliver — where
  // three of the five known failure classes live — rather than crash.
  return isFailureStatus(rawStatus) ? failedStageFor(rawStatus) : { failed: 4 };
}

// (The mobile card's StatusDotPill is gone: it rendered off the COLLAPSED
// CrossingStatus, so `transforming` printed "Extracting" there while the desktop badge
// printed "Preparing output" for the same order. Both viewports now render
// UnifiedStatusBadge on the raw status — one component, one vocabulary.)

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: CrossingStatus;
  /**
   * RAW backend OrderStatus (e.g. "ready_to_deliver", "delivery_failed",
   * "transform_failed"). Drives ACTION gating — the collapsed display
   * `status` above folds five failure statuses into one "failed" pill, so it
   * cannot tell a redeliverable delivery_failed from a non-redeliverable
   * parse/transform failure (see isRedeliverable in ./inboxSend).
   */
  rawStatus: string;
  fmt: string;
  buyer: string;
  supplier: string;
  po: string;
  lines: number;
  value: number;      // raw number for sorting
  valueLabel: string; // formatted display
  issues: number;
  assigned: string;
  age: string;
  ageMin: number;     // minutes, for sorting
};

// ─── Data generation ──────────────────────────────────────────────────────────

const STATUSES: CrossingStatus[] = ["new", "extracting", "review", "ready", "sent", "failed"];
const FMTS     = ["PDF", "cXML", "XLSX", "EDI", "EMAIL", "API", "CSV"] as const;
const BUYERS   = [
  "Heinrich Industries GmbH", "Nordmark Logistics A/S", "Steelhouse Construction",
  "Centralis Pharma", "Westmark Tools", "Atlas Reseller AG", "Bauer Medizintechnik",
  "OmniRetail GmbH", "ThermoBloc AS", "MassBuild Ltd.",
];
const SUPPLIERS = [
  "Acme Components Ltd.", "BoltWorks BV", "VanDerBerg Metaal", "MedicaSupply OY",
  "Nordix Distribution", "PrimeParts GmbH", "OrthoTech AS", "SteelCore BV",
];
const ASSIGNEES = ["MK", "JT", "EL", "SH", "—"];

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }

function fmtAge(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

// Mock-only: a representative raw backend status per display status so the
// deliverable-row gating behaves realistically in demo mode (mock "failed"
// rows act like delivery_failed, which IS redeliverable; "delivering" carries
// ready_to_deliver — see mapStatus below).
const MOCK_RAW_STATUS: Record<CrossingStatus, string> = {
  new:        "pending_parse",
  extracting: "parsing",
  transforming: "transforming",
  // Not redeliverable either — the action an unrouted order needs is assign-supplier.
  unrouted:   "unrouted",
  review:     "pending_review",
  ready:      "ready",
  sent:       "delivered",
  delivering: "ready_to_deliver",
  // Also not redeliverable — a real delivering row is already in flight, so its
  // bulk-select is disabled too (there is nothing to re-fire).
  sending:    "delivering",
  // Not redeliverable (see inboxSend.ts) — so a mock held row also demonstrates the
  // disabled bulk-select, which is the behaviour a real held order has.
  held:       "delivery_held",
  // IS redeliverable, unlike held (see inboxSend.ts) — a mock unconfirmed row
  // demonstrates the ENABLED bulk-select a human uses to choose "Send again".
  unconfirmed: "delivery_unconfirmed",
  failed:     "delivery_failed",
};

function generateOrders(count: number): OrderRow[] {
  const rows: OrderRow[] = [];
  // Seed with the original 12 hand-crafted rows first
  const SEED: Array<Omit<OrderRow, "ageMin" | "rawStatus">> = [
    { id: "demo-001",  status: "review",     fmt: "PDF",   buyer: BUYERS[0], supplier: SUPPLIERS[0], po: "PO-DEMO-001",  lines: 14, value: 24180.50, valueLabel: "€ 24,180.50", issues: 3, assigned: "MK", age: "2m"  },
    { id: "nrd9981", status: "new",        fmt: "cXML",  buyer: BUYERS[1], supplier: SUPPLIERS[1], po: "PO-NRD-9981",     lines:  7, value:  8420.00, valueLabel: "€  8,420.00", issues: 0, assigned: "—",  age: "4m"  },
    { id: "sh44120", status: "extracting", fmt: "XLSX",  buyer: BUYERS[2], supplier: SUPPLIERS[2], po: "SH-PO-44120",     lines: 32, value: 71205.18, valueLabel: "€ 71,205.18", issues: 0, assigned: "—",  age: "6m"  },
    { id: "850201",  status: "failed",     fmt: "EDI",   buyer: BUYERS[3], supplier: SUPPLIERS[3], po: "850-99201",       lines: 18, value: 12408.00, valueLabel: "€ 12,408.00", issues: 6, assigned: "JT", age: "14m" },
    { id: "wmt341",  status: "ready",      fmt: "EMAIL", buyer: BUYERS[4], supplier: SUPPLIERS[0], po: "WMT-2026-0341",   lines:  4, value:  1920.40, valueLabel: "€  1,920.40", issues: 0, assigned: "MK", age: "22m" },
    { id: "008411",  status: "sent",       fmt: "PDF",   buyer: BUYERS[0], supplier: SUPPLIERS[1], po: "PO-2026-008411",  lines: 11, value:  5612.00, valueLabel: "€  5,612.00", issues: 0, assigned: "MK", age: "1h"  },
    { id: "ar1107",  status: "review",     fmt: "XLSX",  buyer: BUYERS[5], supplier: SUPPLIERS[4], po: "AR-2026-1107",    lines:  9, value: 14290.00, valueLabel: "€ 14,290.00", issues: 1, assigned: "JT", age: "1h"  },
    { id: "bmt720",  status: "review",     fmt: "CSV",   buyer: BUYERS[6], supplier: SUPPLIERS[3], po: "BMT-PO-7720",     lines: 22, value: 38710.20, valueLabel: "€ 38,710.20", issues: 2, assigned: "—",  age: "2h"  },
    { id: "nrd967",  status: "sent",       fmt: "cXML",  buyer: BUYERS[1], supplier: SUPPLIERS[2], po: "PO-NRD-9967",     lines:  5, value:  3408.00, valueLabel: "€  3,408.00", issues: 0, assigned: "EL", age: "2h"  },
    { id: "sh4118",  status: "ready",      fmt: "API",   buyer: BUYERS[2], supplier: SUPPLIERS[1], po: "SH-PO-44118",     lines: 16, value: 19860.00, valueLabel: "€ 19,860.00", issues: 0, assigned: "MK", age: "3h"  },
    { id: "ar1104",  status: "failed",     fmt: "PDF",   buyer: BUYERS[5], supplier: SUPPLIERS[0], po: "AR-2026-1104",    lines: 28, value: 41205.50, valueLabel: "€ 41,205.50", issues: 5, assigned: "EL", age: "3h"  },
    { id: "850198",  status: "sent",       fmt: "EDI",   buyer: BUYERS[3], supplier: SUPPLIERS[4], po: "850-99198",       lines: 12, value:  9114.40, valueLabel: "€  9,114.40", issues: 0, assigned: "JT", age: "4h"  },
  ];
  SEED.forEach((s) => rows.push({ ...s, rawStatus: MOCK_RAW_STATUS[s.status], ageMin: s.age.endsWith("d") ? parseInt(s.age)*1440 : s.age.endsWith("h") ? parseInt(s.age)*60 : parseInt(s.age) }));

  // Generate remaining rows procedurally
  for (let i = rows.length; i < count; i++) {
    const si = i % STATUSES.length;
    const bi = (i * 7 + si) % BUYERS.length;
    const supi = (i * 3 + bi) % SUPPLIERS.length;
    const ageMin = 5 + (i * 13) % (60 * 72);
    const val = 500 + (i * 1237 + 189) % 98000;
    const valCents = val + ((i * 17) % 100) / 100;
    const lines = 2 + (i * 5) % 48;
    const issues = si === STATUSES.indexOf("failed") ? 1 + (i % 6)
                 : si === STATUSES.indexOf("review")  ? (i % 3)
                 : 0;
    const poNum = 100000 + i;
    const assigned = ASSIGNEES[(i * 3) % ASSIGNEES.length];
    const fmt = FMTS[(i * 2) % FMTS.length];
    rows.push({
      id: `gen-${pad(i, 6)}`,
      status: STATUSES[si],
      rawStatus: MOCK_RAW_STATUS[STATUSES[si]],
      fmt,
      buyer: BUYERS[bi],
      supplier: SUPPLIERS[supi],
      po: `PO-2026-${poNum}`,
      lines,
      value: valCents,
      valueLabel: `€ ${valCents.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`,
      issues,
      assigned,
      age: fmtAge(ageMin),
      ageMin,
    });
  }
  return rows;
}

// ─── API status mapping ───────────────────────────────────────────────────────

// Backend `ready` and `ready_to_deliver` are DIFFERENT pipeline stages and must
// NOT collapse to one display status, or the row badge contradicts the chips:
//   - `ready`            = every check passed, NO output built yet (pre-Transform).
//                          Rendered "Ready to send" — the HUMAN's turn, and since WP-29
//                          the chip that filters `ready` carries the same three words
//                          and the row carries the button that acts on them.
//   - `ready_to_deliver` = post-transform, output file built, send pending — OUR turn.
//                          Rendered "Queued to send", the SAME vocabulary as the chip
//                          that filters `ready_to_deliver`.
// We reuse the `delivering` CrossingStatus slot (stage 4, distinct blue pill) for
// `ready_to_deliver`. That slot's NAME is a historical accident, not a claim about the
// backend: a persisted `delivering` status DOES exist upstream (OrderStatusConstants),
// and it maps to the separate `sending` slot below.
export function mapStatus(s: string): CrossingStatus {
  if (s === "pending_review") return "review";
  if (s === "parsing") return "extracting";
  // Its OWN slot, not folded into `extracting`. Folding it lit Normalize for an order
  // at Transform, and made the mobile card (which reads this collapsed value) print
  // "Extracting" while the desktop badge (which reads the raw status) printed
  // "Preparing output" — one order, two words, two screen sizes.
  if (s === "transforming") return "transforming";
  // Extracted, but no supplier resolved — parked awaiting one, which is the operator's
  // job (POST /orders/{id}/assign-supplier). Reachable on the LIVE parse path today
  // (OrderIngestionService: `if (entity.SupplierId is null) newStatus = Unrouted`) and via
  // SFTP/S3/IMAP ingress when an org's default supplier is unset or soft-deleted. Without
  // this it fell through to "new" (stage 0), so the one order that REQUIRED the operator
  // to act was the one rendered as needing nothing.
  if (s === "unrouted") return "unrouted";
  if (s === "ready_to_deliver") return "delivering";
  if (s === "ready") return "ready";
  // The Worker's atomic claim persists `delivering` while it dispatches, and settles it
  // to delivered/delivery_failed seconds later; a claim whose process dies holds the row
  // until the 2-minute reclaim window. Without this it fell through to "new" (stage 0) —
  // an order mid-dispatch rendered as if nothing had started, the opposite of the truth.
  if (s === "delivering") return "sending";
  if (s === "delivered") return "sent";
  // delivery_held reached Deliver and paused for billing. Without this it fell
  // through to "new" (stage 0) — the opposite of the truth.
  if (s === "delivery_held") return "held";
  // delivery_unconfirmed also reached Deliver — it was (probably) sent — before a crash
  // lost the outcome on a channel that cannot tell us whether it arrived. Same
  // fall-through bug as delivery_held would apply here.
  //
  // It gets its own bucket, NOT the red `failed` arm below, and it is deliberately
  // absent from FAILED_BUCKET: we do not know it failed, and re-sending risks a
  // duplicate purchase order, so a human decides ("Send again" / "Mark as delivered").
  // Do not "tidy" it into either list — that would claim a failure we cannot support
  // AND pull it into the Failed chip's count (failureBucketPills.test.ts iterates that
  // bucket, so adding it there would silently make this arm unreachable).
  if (s === "delivery_unconfirmed") return "unconfirmed";
  // Every status in FAILED_BUCKET must land here — that list is what the "Failed" chip
  // counts, and the backend's OrderStatusConstants.FailureBucket states the contract:
  // "Every status the UI renders as the single red 'Failed' pill." This arm honoured
  // only three of the five: `rejected_by_supplier` and `delivery_dead_letter` fell
  // through to "new" (stage 0), so the chip counted an order as Failed while its own
  // row rendered it as untouched. See failureBucketPills.test.ts, which asserts the
  // whole bucket rather than these five names, so the next status added to it cannot
  // regress here silently.
  if (
    s === "delivery_failed" ||
    s === "failed" ||
    s === "transform_failed" ||
    s === "delivery_dead_letter" ||
    s === "rejected_by_supplier"
  ) return "failed";
  // Reached by `pending_parse` — queued, nothing run on it yet, which is what "New"
  // (stage 0) genuinely means. This is the honest default, NOT the fall-through that
  // produced the bugs above. Any status that HAS progressed needs an explicit arm:
  // landing here claims the pipeline never started.
  //
  // Before adding a status to this default, GREP THE PRODUCERS — do not trust a
  // doc-comment. Every bug this function has had came from believing one. The
  // `delivering` arm exists because a comment here swore no such status was persisted
  // (DeliveryService writes it). The `unrouted` arm exists because the SECOND version of
  // that same mistake was made in this very comment: it deferred unrouted as
  // "unreachable until the content-routing ingest paths ship", echoing
  // OrderStatusConstants' doc-comment, which is stale — Phase 1/1b shipped, the ingress
  // code says so in its own comments, and OrderIngestionService parks live orders there.
  return "new";
}

function summaryToRow(o: OrderSummary): OrderRow {
  const ageMin = Math.max(0, Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000));
  const fmt =
    o.sourceFormat === "pdf" ? "PDF" :
    o.sourceFormat === "csv" ? "CSV" :
    o.sourceFormat === "xlsx" || o.sourceFormat === "xls" ? "XLSX" :
    o.sourceFormat === "cxml" ? "cXML" :
    o.sourceFormat === "edi" ? "EDI" :
    "API";
  const value = o.totalValue ?? 0;
  const currency = o.currency ?? "EUR";
  const valueLabel = `${currency} ${value.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
  return {
    id: o.id,
    status: mapStatus(o.status),
    rawStatus: o.status,
    fmt,
    buyer: o.buyerName ?? "—",
    supplier: o.supplierName,
    po: o.poNumber,
    lines: o.lineCount,
    value,
    valueLabel,
    issues: o.unresolvedCount,
    assigned: "—",
    age: fmtAge(ageMin),
    ageMin,
  };
}

// ─── Status buckets for live action counts ──────────────────────────────────────
// The red "Failed" pill collapses FIVE backend statuses into one (mapStatus above
// folds them all to CrossingStatus "failed"), so its badge sums the whole bucket.
// FAILED_BUCKET now LIVES in orderCountContract.ts — the dashboard's "Failed" number
// is the same number, which is that module's whole thesis — and is re-exported here so
// its existing importers (failureBucketPills.test.ts, statusJourneyFailedStage.test.tsx,
// StatusJourney's FAILURE_JOURNEY_STAGE comment) are unchanged.
export { FAILED_BUCKET };

// ─── Filter chips ─────────────────────────────────────────────────────────────

// `status` drives mock-mode client-side column filtering (CrossingStatus);
// `api` is the backend OrderStatus passed to the live ?status= query param.
// Each chip's `status` (mock client-side CrossingStatus filter) and `api`
// (live ?status= OrderStatus) must resolve to the rows its label promises.
//
// "Ready to send" (WP-29) filters `ready`: every check passed, no output built, nothing
// sent — the human's turn, and the reason this screen exists. It had no chip at all
// until now, which made the product's most valuable state its least visible one.
// "Queued to send" filters `ready_to_deliver` — output built, send pending, our turn.
// The two are named after the statuses they actually filter, so a chip's count and the
// row badges under it can never disagree.
//
// Failure handling is bucketed client-side over all failure statuses because the red
// "Failed" pill collapses five backend statuses; the live `api: "failed"` value is
// expanded SERVER-side to the same bucket.
//
// THE LABELS AND summaryKeys ARE NOT HAND-WRITTEN. Both come from
// ORDER_COUNT_CONTRACT, so this chip row and the dashboard's stat row are two renders
// of one table — see orderCountContract.ts for why that matters. The array itself must
// stay DECLARED IN THIS FILE: the vocabulary gate's noun budget is path-pinned to the
// FILTER_CHIPS declaration in src/components/bridge/InboxView.tsx
// (scripts/check-vocabulary.mjs NOUN_REGISTRIES), and it reads the `label:` literals
// below. Keep them literal.
//
// This comment used to spell that token as a declaration, and doing so DISARMED the very
// guard it was describing: blockBody() takes the first declaration-shaped match of the
// name, so the comment became the anchor and `registry-moved` stopped firing. The gate now strips
// comments before matching (and src/lib/vocabulary.test.ts proves it against these real
// files), so this is belt and braces — but do not reintroduce the phrasing.
export const FILTER_CHIPS: Array<{
  label: string;
  status?: CrossingStatus;
  api?: OrderStatus;
  summaryKeys?: OrderStatus[];
}> = [
  { label: "All orders" },
  { label: "Needs review",   status: "review",     api: "pending_review",    summaryKeys: contractStatuses("Needs review") },
  { label: "Ready to send",  status: "ready",      api: "ready",             summaryKeys: contractStatuses("Ready to send") },
  { label: "Queued to send", status: "delivering", api: "ready_to_deliver",  summaryKeys: contractStatuses("Queued to send") },
  { label: "Delivered",      status: "sent",       api: "delivered",         summaryKeys: contractStatuses("Delivered") },
  { label: "Failed",         status: "failed",     api: "failed",            summaryKeys: contractStatuses("Failed") },
];

/** The contract's statuses for a chip label. Throws for a label the contract doesn't know. */
function contractStatuses(label: string): OrderStatus[] {
  const statuses = statusesForLabel(label);
  if (!statuses) {
    throw new Error(
      `InboxView: chip "${label}" is not in ORDER_COUNT_CONTRACT. Add it there — a chip that ` +
        `computes its own count is how the dashboard and the inbox came to print different ` +
        `numbers under "Ready to send".`,
    );
  }
  return statuses;
}

// ─── Column helper ────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<OrderRow>();

// Columns depend on the org's direction labels (rail header + unknown-buyer
// fallback), so they're built per-render via useMemo([labels]) inside the
// component rather than living at module scope. getRowId still keys on order id,
// so row stability / selection behaviour is unchanged.
function buildColumns(labels: PartyLabels, rowSend: RowSendContext) {
  return [
  // Checkbox select — selection feeds ONLY the "Send selected" bulk action
  // (POST /redeliver). The selectable set is isBulkSelectable =
  // {ready_to_deliver, delivery_failed}, exactly the backend's
  // ClaimableForRetryFrom, so "Send selected" can never fire a guaranteed-400
  // request. TanStack's select-all helpers respect getCanSelect(), so the header
  // checkbox keeps working on filtered views and selects only sendable rows.
  //
  // Parked (delivery_unconfirmed) rows are redeliverable but are NOT selectable
  // here any more: the bulk bar routed N of them through ONE boolean confirm, on
  // the very channels that de-duplicate nothing. That decision belongs to the
  // per-order resolver on the order screen, which asks what the supplier actually
  // said — a question a checkbox cannot answer.
  columnHelper.display({
    id: "select",
    enableHiding: false,
    header: ({ table }) => {
      // Only Ready to send / Failed delivery rows are selectable (enableRowSelection
      // gate). On a view with none (e.g. "All orders" showing only Normalized /
      // Needs review), select-all would select nothing and look DEAD. Disable it +
      // say why, so the click isn't a silent no-op.
      const selectable = table.getRowModel().rows.filter((r) => r.getCanSelect()).length;
      const none = selectable === 0;
      return (
        <input
          type="checkbox"
          disabled={none}
          style={{ accentColor: BLUE, cursor: none ? "not-allowed" : "pointer", width: 13, height: 13, opacity: none ? 0.4 : 1 }}
          checked={!none && table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label={none ? "No sendable orders on this view" : "Select all sendable orders"}
          // Names the chips that actually exist. It used to send the operator to a
          // “Ready to send” tab that did not exist — and now that one does, it would
          // send them to the WRONG one: `ready` rows carry their own row button and are
          // deliberately not bulk-selectable (see isRowSendable / isBulkSelectable).
          title={none
            ? "No orders here can be sent together. Switch to the “Queued to send” or “Failed” filter, or use the Send button on a “Ready to send” row."
            : "Selects orders that are queued to send or had a delivery failure."}
        />
      );
    },
    cell: ({ row }) => {
      const canSelect = row.getCanSelect();
      return (
        <input
          type="checkbox"
          style={{
            accentColor: BLUE,
            cursor: canSelect ? "pointer" : "not-allowed",
            width: 13,
            height: 13,
            opacity: canSelect ? 1 : 0.35,
          }}
          checked={row.getIsSelected()}
          disabled={!canSelect}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label={
            canSelect
              ? "Select row"
              : row.original.rawStatus === "delivery_unconfirmed"
                ? "Delivery unknown — open the order to resolve it safely"
                : isRowSendable(row.original.rawStatus)
                  ? "Use this row's Send button — this order still needs its output built"
                  : "Can't select — only orders that are queued to send or had a failed delivery can be sent together"
          }
          title={
            canSelect
              ? undefined
              : row.original.rawStatus === "delivery_unconfirmed"
                ? "Delivery unknown — open the order to resolve it safely"
                : isRowSendable(row.original.rawStatus)
                  ? "This order still needs its output built, so it is sent one at a time — use the Send button on this row."
                  : "Only orders that are queued to send or had a failed delivery can be sent together. Open the others to see what they need."
          }
        />
      );
    },
    size: 36,
  }),
  // Order column: PO# + lines/exceptions
  columnHelper.accessor("po", {
    header: "Order",
    enableHiding: false,
    // v2 leading status dot: a small dot coloured by the row's status tone
    // (via tv2DotColor on the raw backend status) leads the PO# — dot + word,
    // where the word is the Status column's UnifiedStatusBadge. Colour always
    // agrees with that badge because both derive from the same status→tone map.
    cell: (info) => (
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: tv2DotColor(info.row.original.rawStatus),
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span
            className="font-mono text-[12px] font-semibold tabular-nums"
            style={{ color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {info.getValue()}
          </span>
          <div className="text-[11px]" style={{ color: "#5E6779" }}>
            {info.row.original.lines} lines{info.row.original.issues > 0 ? ` · ${info.row.original.issues} to review` : ""}
          </div>
        </div>
      </div>
    ),
    size: 188,
  }),
  // Buyer → Supplier (or Customer → You in inbound mode)
  columnHelper.display({
    id: "lane",
    enableHiding: false,
    header: labels.railHeader,
    cell: ({ row }) => {
      const buyer = row.original.buyer;
      const hasBuyer = buyer != null && buyer.trim() !== "" && buyer.trim() !== "—";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "12.5px" }}>
          <span style={{ color: hasBuyer ? BLUE_DEEP : "var(--ink-faint)", fontWeight: hasBuyer ? 500 : 400, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
            {hasBuyer ? buyer : labels.unknownBuyer}
          </span>
          <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>→</span>
          {row.original.rawStatus === "unrouted" ? (
            <AssignSupplierCell orderId={row.original.id} noun={labels.counterpartyNoun} />
          ) : (
            <span style={{ color: GREEN_DEEP, fontWeight: 500, flex: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
              {row.original.supplier}
            </span>
          )}
        </div>
      );
    },
    size: 320,
  }),
  columnHelper.accessor("fmt", {
    header: "Source",
    cell: (info) => <FileChip type={info.getValue()} />,
    meta: { label: "Source" },
    size: 72,
  }),
  columnHelper.accessor("value", {
    header: "Value",
    cell: (info) => (
      <span className="font-mono text-[12.5px] font-semibold tabular-nums" style={{ color: "#0B1A2F" }}>
        {info.row.original.valueLabel}
      </span>
    ),
    meta: { numeric: true, label: "Value" },
    size: 110,
  }),
  // Pipeline — the 5-node track, plus the words that make it readable.
  //
  // It used to be five bare 11px dots in 184px: no role, no accessible name, no
  // caption, and no legend anywhere on the page. A screen reader announced the empty
  // string. Now the dots are aria-hidden decoration and the cell is one role="img"
  // whose name says the step AND the status ("Step 3 of 5: Validate. Needs review."),
  // with the same words printed under it for everyone else. The legend that turns
  // "3 of 5" into a fact renders once above the table (see PipelineLegend).
  columnHelper.accessor("status", {
    header: "Pipeline",
    cell: (info) => {
      const stage = journeyStage(info.getValue(), info.row.original.rawStatus);
      return (
        <div
          data-pipeline
          role="img"
          aria-label={pipelineAccessibleName(stage, statusLabel(info.row.original.rawStatus))}
          style={{ minWidth: 132, maxWidth: 176 }}
        >
          <span aria-hidden="true" style={{ display: "block" }}>
            <StatusJourney stage={stage} compact />
          </span>
          <span
            aria-hidden="true"
            className="mt-1 block text-[10px] tabular-nums"
            // --ink-muted #56627A on white = 6.13:1 (AA). --ink-faint #8A93A5 would be
            // 3.09:1 — below AA for text, which is why the caption is not faint.
            style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}
          >
            {pipelineCaption(stage)}
          </span>
        </div>
      );
    },
    meta: { label: "Pipeline" },
    size: 184,
  }),
  // Status pill — soft rounded-full pill with leading dot + full semantic label
  columnHelper.display({
    id: "statusPill",
    enableHiding: false,
    header: "Status",
    // Canonical status pill — one shape/size/padding, Lucide icon + word per tone.
    // Keyed on the RAW backend OrderStatus so it can tell `ready` ("Ready to send")
    // apart from `ready_to_deliver` ("Queued to send") — the collapsed display
    // `status` can't (see UnifiedStatusBadge / STATUS_META).
    cell: ({ row }) => <UnifiedStatusBadge status={row.original.rawStatus} icon />,
    size: 124,
  }),
  columnHelper.accessor("ageMin", {
    header: "Updated",
    cell: (info) => <span style={{ color: "#5E6779", fontSize: "12px" }}>{info.row.original.age} ago</span>,
    meta: { label: "Updated" },
    size: 72,
  }),
  // Row action — the primary send on a "Ready to send" row, the chevron on every
  // other. Reuses the chevron's slot rather than adding a column so the table's
  // structure is unchanged; only its width grows (30 → 132).
  columnHelper.display({
    id: "chevron",
    enableHiding: false,
    header: "",
    cell: ({ row }) =>
      canRowSend(row.original) ? (
        <RowSendButton row={row.original} ctx={rowSend} />
      ) : (
        <span style={{ color: "var(--ink-faint)", fontSize: "15px" }}>›</span>
      ),
    size: 132,
  }),
  ];
}

/** What a row needs to run (and report) the primary send. Threaded, not global. */
type RowSendContext = {
  /** Order id currently in flight, or null. One at a time — a click is a real POST. */
  sendingId: string | null;
  onSend: (row: OrderRow) => void;
};

/**
 * Whether THIS row offers the action — status first, then the row's own issue count.
 *
 * The status set is the real guard (OrderStatusMachine.TransformableFrom contains `ready`
 * and the endpoint 422s on unresolved lines regardless), so the second clause is defence in
 * depth: it is what the spec promised, and it costs one field the row already carries. A
 * `ready` row with open issues should not exist; if the backend ever produced one, the
 * honest response is to leave it to the review screen rather than offer a button whose only
 * possible outcome is a 422.
 */
function canRowSend(row: OrderRow): boolean {
  return isRowSendable(row.rawStatus) && row.issues === 0;
}

/**
 * The primary send on a `ready` row.
 *
 * IMMEDIATE, no confirm — and that is a decision, not an omission. `ready` means every
 * check passed and NOTHING has been built or sent, so there is no duplicate risk. The
 * confirm WP-24 added (bulkSendNeedsDuplicateConfirm) exists for `delivery_unconfirmed`,
 * where the supplier may already hold the order; reusing it here would train the
 * operator to click past the dialog that actually matters.
 *
 * It posts to /orders/{id}/transform, whose guard set (TransformableFrom) contains
 * `ready`, so the click cannot 400 on status — the WP-24 D2 discipline.
 *
 * The label is ROW_SEND_CTA, not partyLabels().primaryCta — see inboxSend.ts for why
 * reusing the order-detail CTA's words here would over-claim on the default configuration.
 */
function RowSendButton({ row, ctx }: { row: OrderRow; ctx: RowSendContext }) {
  const inFlight = ctx.sendingId === row.id;
  const busy = ctx.sendingId !== null;
  return (
    <button
      type="button"
      // Viewport hook. BOTH row variants mount in jsdom, so without it a role+name query is
      // satisfied by the mobile card alone and the desktop cell goes untested — which is
      // exactly how a mutation that broke only the desktop button stayed green.
      data-row-send="desktop"
      onClick={(e) => { e.stopPropagation(); ctx.onSend(row); }}
      disabled={busy}
      // The PO is in the accessible name because a table of identical "Prepare output"
      // buttons tells a screen-reader user nothing about which order they are acting on.
      aria-label={`${ROW_SEND_CTA} — ${row.po}`}
      className="w-full rounded-[6px] px-2 text-[12px] font-semibold"
      style={{
        height: 28,
        // white on --brand-blue #1E66C9 = 5.53:1 (AA).
        background: BLUE,
        color: "#FFFFFF",
        border: 0,
        cursor: busy ? "default" : "pointer",
        opacity: busy && !inFlight ? 0.5 : 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {inFlight ? ROW_SEND_CTA_PROGRESS : ROW_SEND_CTA}
    </button>
  );
}

/**
 * The key for the Pipeline column's "3 of 5" captions.
 *
 * Rendered once, above the table, desktop-only — and only when the Pipeline column is
 * actually visible, so the legend never explains something the Columns menu has hidden.
 * --ink-muted #56627A on --bg #F6F7FA = 5.73:1 (AA).
 */
function PipelineLegend() {
  return (
    <div
      data-pipeline-legend
      className="hidden lg:flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[10.5px]"
      style={{ color: "var(--ink-muted)" }}
    >
      <span className="font-semibold uppercase tracking-[0.06em]">Pipeline</span>
      {PIPELINE_STAGE_NAMES.map((stage, i) => (
        <span key={stage} className="inline-flex items-center gap-1">
          <span className="font-mono tabular-nums" style={{ color: "var(--ink-faint)" }}>{i + 1}</span>
          {stage}
        </span>
      ))}
    </div>
  );
}

/**
 * The supplier half of the rail for an order parked `unrouted`.
 *
 * That order has no supplier — the API has nothing to put in `supplierName` — so this
 * cell used to render the buyer, an arrow, and a blank. The blank IS the thing to do,
 * so it says so and routes to the order page, where AssignSupplierBanner holds the
 * picker and the 409 handling. Deliberately not a second assign implementation: one
 * atomic claim, one place that knows what its conflict means.
 *
 * The row itself already navigates here on click; this is the keyboard-reachable,
 * NAMED version of that, and the only thing on the row that says what it needs.
 */
function AssignSupplierCell({ orderId, noun }: { orderId: string; noun: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      // The row's own onClick would fire too and race this push to the same URL.
      onClick={(e) => { e.stopPropagation(); router.push(`/inbox/${orderId}`); }}
      className="text-[12px] font-semibold"
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        padding: "3px 8px",
        borderRadius: 5,
        border: "1px solid #EBD7AE",
        background: "#FAF1DD",
        color: "#B36D14",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      Assign {noun.toLowerCase()} →
    </button>
  );
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ state }: { state: "asc" | "desc" | false }) {
  return (
    <span style={{ fontSize: 10, color: state ? BLUE_DEEP : "#CBD0DA", marginLeft: 4, userSelect: "none" }}>
      {state === "asc" ? "↑" : state === "desc" ? "↓" : "⇅"}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Mock mode: use a static generated set (50 rows)
const MOCK_ORDERS = isApiMockMode ? generateOrders(50) : [];

const PAGE_SIZE = 25;

export function InboxView() {
  const router = useRouter();
  const queryEnabled = useQueriesEnabled();
  // Shared confirm dialog (ConfirmProvider is mounted in the (app) layout) — the
  // duplicate guard on bulk sends that include a parked order.
  const confirm = useConfirm();
  const { direction, labels } = useOrderDirection();
  // Row send ("Ready to send" rows) — one order in flight at a time, because each click
  // is a real POST /transform. Declared before the columns memo, which closes over it.
  const [rowSendingId, setRowSendingId] = useState<string | null>(null);
  const [rowSendNotice, setRowSendNotice] = useState<BulkSendResult | null>(null);
  const rowSendRef = useRef<(row: OrderRow) => void>(() => {});
  const handleRowSend = useCallback((row: OrderRow) => rowSendRef.current(row), []);
  // Columns depend on the direction labels and the in-flight row — memoise so
  // react-table receives a stable reference between those changes. `handleRowSend` is a
  // stable trampoline into a ref, so the real handler can close over query state
  // without rebuilding every column on every render.
  const columns = useMemo(
    () => buildColumns(labels, { sendingId: rowSendingId, onSend: handleRowSend }),
    [labels, rowSendingId, handleRowSend],
  );
  // Empty-state copy: outbound orders arrive from buyers; inbound from customers.
  // Shown only in the genuinely-empty (no filter active) branch — the filtered
  // zero-result branch has its own "No matching orders" copy, so don't open
  // with "No orders match this filter." here.
  const emptyStateCopy =
    direction === "inbound"
      ? "New orders land here automatically as customers send them, or upload one yourself."
      : "New orders land here automatically as buyers send them, or upload one yourself.";
  // Practice-order CTA for the GENUINE empty state (task 9) — shared hook so
  // analytics/invalidation/routing match every other sample entry point.
  const sample = useSampleOrder("/inbox");
  // The URL IS the filter (D3). statusFilter / activeChip / page are DERIVED from
  // the query string, never mirrored into state: every ?status= link in the product
  // used to land on an unfiltered inbox because this component read no params, and
  // copying them into useState on mount would have re-created the same
  // two-sources-of-truth bug the first time a link changed under a mounted view.
  // Chip clicks write the URL back, so back/forward work and a filtered view is
  // shareable — which is the whole promise a health tile makes.
  const params = useSearchParams();
  const pathname = usePathname();
  const urlStatus = params.get("status");
  const { status: statusFilter, known: statusKnown } = resolveInboxStatusParam(urlStatus);
  const activeChip = statusKnown ? inboxChipIndexFor(urlStatus) : 0;
  const urlSort = params.get("sort");
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  /** Write the next filter state into the URL (replace: no history spam per chip). */
  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Sort seeds from ?sort=oldest — the honest target for the "Overdue" health tile,
  // which has no server-side age filter — and is owned by the table thereafter.
  const [sorting, setSorting]           = useState<SortingState>(() => inboxSortingFor(urlSort));
  const columnFilters: ColumnFiltersState = useMemo(() => {
    if (!isApiMockMode) return [];
    const chip = FILTER_CHIPS[activeChip];
    return chip?.status ? [{ id: "status", value: chip.status }] : [];
  }, [activeChip]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Column visibility — session-only (no localStorage). Empty = all visible.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnsMenuOpen, setColumnsMenuOpen]   = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  // Keyboard row navigation (desktop): j/ArrowDown + k/ArrowUp move a row
  // highlight, Enter opens it. -1 = no active row. The desktop table body is
  // reffed so the active row can be scrolled into view as it moves.
  const [activeRow, setActiveRow] = useState(-1);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const [searchInput, setSearchInput]   = useState(""); // controlled search-box value
  const [search, setSearch]             = useState(""); // committed (debounced) server search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bulk "Send selected" lifecycle: idle while no request is in flight, then a
  // visible pending → result feedback so the action is never a silent no-op.
  const [bulkSending, setBulkSending]   = useState(false);
  const [bulkResult, setBulkResult]     = useState<BulkSendResult | null>(null);

  const queryClient = useQueryClient();
  // Live (non-mock) path: the backend returns a paginated envelope and applies
  // status + search filters server-side. A distinct query key keeps this apart
  // from the lightweight ["orders"] working-set used by sidebar/topbar/dashboard.
  const { data: ordersPage, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["orders", "inbox", page, statusFilter ?? "", search],
    queryFn: () => apiClient.getOrders({
      page,
      pageSize: PAGE_SIZE,
      status: statusFilter,
      search: search || undefined,
    }),
    staleTime: 30_000,
    enabled: !isApiMockMode,
    placeholderData: (prev) => prev, // keep the current page visible while the next loads
  });

  // Action counts — the headline "what needs me?". `GET /api/orders/summary`
  // returns whole-account per-status counts (not just the current page/filter), so
  // the chip badges and header summary stay accurate regardless of pagination. This
  // runs in BOTH mock and live so paying customers see real counts (previously the
  // counts rendered only under isApiMockMode). Gated via useQueriesEnabled
  // (mock OR qa-bypass OR signed-in) — mock/qa-bypass have no Clerk session.
  const { data: summary } = useQuery({
    queryKey: ["orders", "summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
    enabled: queryEnabled,
  });

  // Memoize so react-table receives a STABLE `data` reference across renders.
  // A bare `.map(summaryToRow)` would build a brand-new array on EVERY render. In
  // the live (non-mock) path the inbox is also subscribed to TanStack Query, so it
  // re-renders on query activity; each render handed react-table a fresh `data`
  // identity, which forced it to rebuild its row models and produce new derived
  // references, scheduling yet another render. Applying a status filter tipped this
  // into an unbounded re-render cascade that locked the main thread (the reported
  // hard freeze). Keying the memo on `ordersPage` keeps the reference stable until
  // the underlying query data actually changes.
  const ALL_ORDERS: OrderRow[] = useMemo(
    () => (isApiMockMode ? MOCK_ORDERS : (ordersPage?.items ?? []).map(summaryToRow)),
    [ordersPage],
  );

  // Status chip → mock filters the column client-side; live sets the server filter.
  const handleChip = useCallback((idx: number) => {
    setRowSelection({});
    const chip = FILTER_CHIPS[idx];
    // ONE code path for both modes: the URL decides which chip is active, and the
    // mock-mode column filter is derived from that same index above.
    setParams({ status: chip.api ?? null, page: null });
  }, [setParams]);

  // Reset every active filter/search back to "All orders" with no query. Mirrors
  // handleChip(0) plus clearing both the controlled search input and the committed
  // (debounced) live search term. Used by the filter-aware empty state.
  const handleClearFilters = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput("");
    setSearch("");
    setRowSelection({});
    setParams({ status: null, page: null, sort: null });
  }, [setParams]);

  // Search box: mock filters instantly client-side; live debounces into a server query.
  // Clear any row selection on every search change (mirrors handleChip): search hides
  // non-matching rows, so a previously-selected row can scroll out of view yet stay
  // silently selected and get swept into a bulk action. Resetting keeps selection in
  // sync with what's actually visible.
  const handleSearch = useCallback((value: string) => {
    setSearchInput(value);
    if (page !== 1) setParams({ page: null });
    setRowSelection({});
    if (isApiMockMode) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 350);
  }, [page, setParams]);

  // Bulk "Send selected": selection keys are order ids (see getRowId), and
  // selection is gated to redeliverable statuses (see enableRowSelection), so
  // every id here SHOULD be accepted — but the status can still change
  // server-side between render and click (or the request can fail), so each
  // re-deliver runs in parallel and failures are reported BY PO NUMBER with
  // the per-order reason instead of an opaque "N failed".
  //
  // A selection holding a parked (delivery_unconfirmed) row CONFIRMS FIRST: those
  // orders may already be sitting with the supplier, and this bar can send N of them
  // in one click. See bulkSendNeedsDuplicateConfirm — the bulk path must not be a way
  // around the same guard the workshop panel puts on the single-order button.
  const handleSendSelected = useCallback(async () => {
    const ids = Object.keys(rowSelection);
    if (!ids.length || bulkSending) return;
    // PO labels for failure reporting. Selection can outlive the loaded page
    // (page changes don't clear it), so fall back to a shortened order id for
    // rows no longer in the current data set.
    const poById = new Map(ALL_ORDERS.map((r) => [r.id, r.po]));

    // Ask BEFORE anything goes out — cancel must send nothing at all, so this sits
    // ahead of the pending state and the requests.
    const rawById = new Map(ALL_ORDERS.map((r) => [r.id, r.rawStatus]));
    if (bulkSendNeedsDuplicateConfirm(ids, rawById)) {
      const ok = await confirm(bulkSendConfirmCopy(ids.length));
      if (!ok) return;
    }

    setBulkSending(true);
    setBulkResult(null);
    try {
      // Route through apiClient.redeliverOrder so the Clerk auth header is
      // attached (a raw fetch here 401'd for real users). It resolves on
      // success and throws on failure — keep the error message, it carries
      // the backend's actual reason (e.g. the not-redeliverable-status 400).
      const results = await Promise.all(
        ids.map((id) =>
          apiClient
            .redeliverOrder(id)
            .then(() => ({ id, ok: true as const }))
            .catch((err: unknown) => ({
              id,
              ok: false as const,
              reason: err instanceof Error ? err.message : "Unknown error",
            })),
        ),
      );
      const failures = results
        .filter((r): r is { id: string; ok: false; reason: string } => !r.ok)
        .map((r) => ({ po: poById.get(r.id) ?? r.id.slice(0, 8), reason: r.reason }));
      const sent = results.length - failures.length;
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setBulkResult(formatBulkSendResult(sent, failures));
      // Keep ONLY the failed rows selected (so a retry can't re-send the
      // orders that already went out); clear entirely on full success.
      setRowSelection(
        Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, true])),
      );
    } catch {
      setBulkResult({ ok: false, text: "Send failed — please retry" });
    } finally {
      setBulkSending(false);
    }
  }, [rowSelection, bulkSending, queryClient, ALL_ORDERS, confirm]);

  // The primary send on a "Ready to send" row.
  //
  // POST /orders/{id}/transform — NOT /redeliver, whose RedeliverableFrom does not
  // contain `ready` (a bulk send of these rows could only ever 400, which is WP-24's D2
  // defect). No confirm: nothing has been built or sent, so there is no duplicate risk;
  // see RowSendButton for the full reasoning.
  //
  // The success line does not claim delivery. The transform job enqueues delivery
  // "respecting the AutoDeliver flag", so an order whose supplier does not auto-send
  // rests in `ready_to_deliver` ("Queued to send") until a person acts. Invalidating
  // ["orders"] is what makes the row itself tell the rest of the story.
  const handleRowSendImpl = useCallback(async (row: OrderRow) => {
    if (rowSendingId) return;
    setRowSendingId(row.id);
    setRowSendNotice(null);
    try {
      await apiClient.transformOrder(row.id);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setRowSendNotice({ ok: true, text: rowSendStartedCopy(row.po) });
    } catch (err) {
      setRowSendNotice({
        ok: false,
        text: rowSendFailedCopy(row.po, err instanceof Error ? err.message : "Unknown error"),
      });
    } finally {
      setRowSendingId(null);
    }
  }, [rowSendingId, queryClient]);
  rowSendRef.current = handleRowSendImpl;

  const table = useReactTable({
    data: ALL_ORDERS,
    columns,
    // Stable row id keyed on the order id (not the array index). Selection keys are
    // therefore order ids, so bulk actions resolve to the correct orders regardless
    // of current sort / filter / page — never positional `rows[index]` lookups.
    getRowId: (row) => row.id,
    state: { sorting, columnFilters, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Selection exists solely for "Send selected" (POST /redeliver), and the
    // backend rejects every status outside RedeliverableFrom with a 400 — so
    // gate selection on the RAW backend status (the display pill is too
    // coarse: its "failed" bucket mixes redeliverable delivery_failed with
    // non-redeliverable parse/transform failures and dead-letters).
    // Narrower than /redeliver's guard set ON PURPOSE — see isBulkSelectable. A
    // parked (delivery_unconfirmed) row IS redeliverable but is NOT selectable:
    // that decision needs the per-order "what did the supplier say?" resolver on
    // the order screen, and a checkbox cannot answer that question.
    enableRowSelection: (row) => isBulkSelectable(row.original.rawStatus),
  });

  const { rows } = table.getRowModel();

  // Client-side text search only in mock mode (live mode searches server-side).
  const filteredRows = useMemo(() => {
    if (!isApiMockMode || !searchInput) return rows;
    const q = searchInput.toLowerCase();
    return rows.filter((row) =>
      row.original.po.toLowerCase().includes(q) ||
      row.original.buyer.toLowerCase().includes(q) ||
      row.original.supplier.toLowerCase().includes(q),
    );
  }, [rows, searchInput]);

  // Pagination: mock paginates the filtered set client-side; live already holds
  // exactly one server page in `filteredRows`.
  const totalCount = isApiMockMode ? filteredRows.length : (ordersPage?.totalCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = isApiMockMode
    ? filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : filteredRows;

  const selectedCount = Object.keys(rowSelection).length;
  // Parked rows currently in the selection. The confirm dialog is the hard gate, but
  // the operator should see WHY it's coming before they reach for Send selected — a
  // count of orders the supplier may already hold is the one thing that makes this
  // selection different from any other.
  const selectedUnconfirmedCount = useMemo(() => {
    const rawById = new Map(ALL_ORDERS.map((r) => [r.id, r.rawStatus]));
    return Object.keys(rowSelection).filter(
      (id) => rawById.get(id) === "delivery_unconfirmed",
    ).length;
  }, [rowSelection, ALL_ORDERS]);

  // ─── Keyboard row navigation (desktop) ────────────────────────────────────
  // The visible set is what j/k traverses. Reset the highlight whenever it
  // changes underfoot (page / filter / search / sort) so the active index never
  // points past the end or at a now-different row.
  const pageLen = pagedRows.length;
  useEffect(() => {
    setActiveRow(-1);
  }, [currentPage, statusFilter, search, searchInput, activeChip, sorting]);

  // Close the columns menu on outside click / Escape (mirrors BridgeTopbar).
  useEffect(() => {
    if (!columnsMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setColumnsMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setColumnsMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [columnsMenuOpen]);

  // Global j/k/Arrow/Enter handler, scoped to the inbox. Ignored while typing in
  // a field, when a modifier is held (don't hijack browser shortcuts), or when
  // the columns menu / a dialog is open. Enter opens the highlighted order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (columnsMenuOpen) return;
      // Skip when focus is in an editable element or any open dialog/menu exists.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (pageLen === 0) return;

      const key = e.key;
      if (key === "j" || key === "ArrowDown") {
        e.preventDefault();
        setActiveRow((i) => (i < 0 ? 0 : Math.min(i + 1, pageLen - 1)));
      } else if (key === "k" || key === "ArrowUp") {
        e.preventDefault();
        setActiveRow((i) => (i <= 0 ? 0 : i - 1));
      } else if (key === "Enter") {
        if (activeRow >= 0 && activeRow < pagedRows.length) {
          e.preventDefault();
          router.push(`/inbox/${pagedRows[activeRow].original.id}`);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pageLen, pagedRows, router, columnsMenuOpen, activeRow]);

  // Scroll the highlighted row into view as it moves.
  useEffect(() => {
    if (activeRow < 0 || !tableBodyRef.current) return;
    const rowEl = tableBodyRef.current.querySelectorAll<HTMLTableRowElement>("tr[data-row]")[activeRow];
    rowEl?.scrollIntoView({ block: "nearest" });
  }, [activeRow]);

  // A chip filter is active (not "All orders") OR there is a search query. Drives
  // the filter-aware empty state: 0 rows under a filter/search means "no MATCHING
  // orders" (work may exist, just not here) — distinct from a genuinely empty inbox.
  // searchInput covers both modes (mock filters on it directly; live mirrors it into
  // the debounced `search`), so an in-flight live debounce still counts as filtered.
  const isFiltered = activeChip !== 0 || searchInput.trim() !== "";

  // Whole-account action counts from `GET /api/orders/summary` (byStatus). These
  // drive the header summary AND the per-chip badges in BOTH mock and live. Summing
  // the byStatus buckets (rather than counting the current page's ALL_ORDERS) keeps
  // the headline correct across pagination/filtering. While the summary query is in
  // flight `byStatus`/`total` are undefined → sumStatuses returns 0 (treated as 0
  // per the Partial<Record> contract).
  const byStatus = summary?.byStatus;
  const reviewCount = useMemo(() => sumStatuses(byStatus, ["pending_review"]), [byStatus]);
  const failedCount = useMemo(() => sumStatuses(byStatus, FAILED_BUCKET), [byStatus]);

  // Per-chip badge counts, resolved through ORDER_COUNT_CONTRACT by LABEL — the same
  // call the dashboard makes for the same words. That is what stops "Ready to send"
  // meaning `ready` here and `ready + ready_to_deliver` there;
  // orderCountParity.test.tsx renders both screens against one fixture to keep it so.
  const chipCounts = useMemo(
    () => FILTER_CHIPS.map(({ label }) => countFor(label, byStatus, summary?.total)),
    [byStatus, summary?.total],
  );

  // Initial load: show skeleton ROW BODIES inside the table card while keeping the
  // header + filter chips + search fully rendered, so the chrome doesn't shift in
  // when data arrives. (The old early-return swapped the whole screen for a bare
  // card → layout jump.) Only the very first page load (no placeholder data yet)
  // shows the skeleton; subsequent page/filter fetches keep prior rows visible.
  const isInitialLoading = !isApiMockMode && isLoading && !ordersPage;

  // Error state
  if (!isApiMockMode && isError) {
    return (
      <PageShell variant="wide" className="flex flex-col items-center justify-center">
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "#FBE3E3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
            }}
          >
            <span style={{ fontSize: "22px", color: "#B43838" }}>⚠</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "#0B1A2F" }}>
            Couldn't load the queue
          </div>
          <div className="muted" style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "#5E6779" }}>
            We couldn&apos;t load your orders right now — your data is safe. Try again in a moment.
          </div>
          <button
            onClick={() => refetch()}
            className="rounded-[6px] px-4 text-[12.5px] font-medium"
            style={{ height: 32, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
          >
            ↻ Retry
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" className="flex flex-col">

      {/* Page header — titleHidden: the topbar "Inbox" tab is the page name
          (sr-only h1 kept); the live "what needs me?" line + Sync/Upload
          actions stay as a compact row. */}
      <PageHeader
          titleHidden
          title="Orders"
          /* Header summary = the live "what needs me?" line. The total order count
             is shown ONCE, in the footer next to pagination — not duplicated here. */
          sub={
            <>
              {reviewCount.toLocaleString()} need review{" · "}{failedCount.toLocaleString()} failed
              {selectedCount > 0 && <span style={{ color: BLUE_DEEP, marginLeft: 8 }}>· {selectedCount} selected</span>}
            </>
          }
          actions={
            <>
              <button
                className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
                style={{
                  height: 32,
                  border: "1px solid #E5E8EE",
                  background: "#FFFFFF",
                  color: isFetching ? "var(--ink-faint)" : "#0B1A2F",
                  cursor: isFetching ? "default" : "pointer",
                }}
                onClick={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
                disabled={isFetching}
                aria-busy={isFetching}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    animation: isFetching ? "inbox-sync-spin 0.8s linear infinite" : undefined,
                  }}
                >
                  ↻
                </span>
                <style>{`@keyframes inbox-sync-spin { to { transform: rotate(360deg); } }`}</style>
                {isFetching ? "Syncing…" : "Sync"}
              </button>
              <button
                className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold transition-colors"
                style={{ height: 32, background: BLUE, color: "#FFFFFF", border: 0 }}
                onClick={() => router.push("/upload")}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = BLUE; }}
              >
                ↑ Upload order
              </button>
            </>
          }
        />

      {/* Bulk action bar — shown while selecting AND while a send result is on
          display. A full success clears the selection, which previously
          unmounted the bar together with its "N orders sent" confirmation, so
          the action read as a silent no-op; now the bar stays until dismissed. */}
      {shouldShowBulkBar(selectedCount, bulkResult) && (
        <div
          className="flex items-center justify-between rounded-[8px] px-4 py-2 mb-3 flex-shrink-0"
          style={{ background: "#0B1A2F", color: "#FFFFFF" }}
        >
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "12.5px", fontWeight: 600 }}>
              {/* Drive the headline from the real result: a fully-failed bulk
                  must not read "Send complete". Falls back to a neutral
                  "Send finished" if a result is on display without a flag. */}
              {selectedCount > 0
                ? `${selectedCount} selected`
                : bulkResult
                  ? (bulkResult.ok ? "Sent" : "Some failed to send")
                  : "Send finished"}
            </span>
            {/* Names the parked rows swept into this selection — the operator is
                about to be asked about a duplicate risk, so say what it's about. */}
            {selectedCount > 0 && selectedUnconfirmedCount > 0 && (
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#F0C674" }}>
                {selectedUnconfirmedCount === 1
                  ? "1 with delivery unknown — the supplier may already have it"
                  : `${selectedUnconfirmedCount} with delivery unknown — the supplier may already have them`}
              </span>
            )}
            <button
              onClick={() => { setRowSelection({}); setBulkResult(null); }}
              style={{ background: "none", border: "none", color: "var(--ink-faint)", fontSize: "12px", cursor: "pointer" }}
            >
              {selectedCount > 0 ? "Clear" : "Dismiss"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {bulkResult && (
              <span
                role="status"
                aria-live="polite"
                style={{ fontSize: "12px", fontWeight: 600, color: bulkResult.ok ? "#7FD18A" : "#F2A6A6" }}
              >
                {bulkResult.ok ? "✓ " : "⚠ "}{bulkResult.text}
              </span>
            )}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={handleSendSelected}
                disabled={bulkSending}
                style={{
                  background: "none",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: bulkSending ? "default" : "pointer",
                  opacity: bulkSending ? 0.6 : 1,
                  padding: 0,
                }}
              >
                {bulkSending ? "Sending…" : "Send selected"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Row-send feedback ("Ready to send" rows). Its own strip rather than the bulk
          bar's: that bar is about a SELECTION, and this action has none — a result
          appearing inside it would imply rows were selected. role="status" so the
          outcome is announced, since the button that caused it is back to idle. */}
      {rowSendNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] px-3 py-2 mb-3 flex-shrink-0"
          style={{
            // #1E6D29 on #E9F1EA = 5.47:1; #B43838 on #FBE3E3 = 5.13:1. Both AA.
            background: rowSendNotice.ok ? "#E9F1EA" : "#FBE3E3",
            color: rowSendNotice.ok ? GREEN_DEEP : "#B43838",
            border: `1px solid ${rowSendNotice.ok ? "#BEDCC2" : "#F0C4C4"}`,
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <span>{rowSendNotice.ok ? "✓ " : "⚠ "}{rowSendNotice.text}</span>
          <button
            type="button"
            onClick={() => setRowSendNotice(null)}
            style={{ background: "none", border: "none", color: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 28 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter chips + search input — toolbar on the grey canvas, above the table card.
          Mobile: chips on a horizontal-scroll row, search full-width on its own row below.
          sm+: both sit side by side on one row. */}
      <div
        className="flex flex-col gap-2 pb-3 sm:flex-row sm:flex-wrap sm:items-center flex-shrink-0"
        style={{ background: "var(--bg)" }}
      >
        {/* An unrecognised ?status= must NOT quietly fall through to "All orders":
            an inbox showing everything reads as "you have no problems", which is
            the one lie this screen cannot afford. Say so, and offer the way out. */}
        {!statusKnown && (
          <div
            role="status"
            className="flex w-full flex-wrap items-center gap-2"
            style={{
              background: "var(--amber-soft)",
              color: "var(--amber-text)",
              border: "1px solid #F0D39A",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            We don&rsquo;t recognise that filter, so this is every order.
            <button
              type="button"
              onClick={handleClearFilters}
              style={{
                minHeight: 32,
                padding: "0 10px",
                borderRadius: 6,
                border: "1px solid #E4C489",
                background: "var(--surface)",
                color: "var(--amber-text)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        )}
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto flex-nowrap w-full sm:w-auto sm:flex-1 min-w-0">
          {FILTER_CHIPS.map(({ label }, i) => {
            const active = i === activeChip;
            // "Ready to send" is the one chip that is visually PRIMARY: it is the state
            // the product exists to produce, and it is the only chip whose rows carry an
            // action. When it is not the active chip it still reads green rather than
            // grey, so the queue's most valuable bucket is findable at a glance.
            const primary = label === "Ready to send";
            return (
              <button
                key={label}
                onClick={() => handleChip(i)}
                // The chip row is a filter group, so selection is announced, not merely
                // coloured — colour alone was the only "active" signal here.
                aria-pressed={active}
                className="flex items-center gap-1.5 rounded-[6px] pl-2.5 pr-2 text-[12px] font-medium transition-colors flex-shrink-0"
                style={{
                  height: 28,
                  border: `1px solid ${active ? INK : primary ? "#BEDCC2" : "#E5E8EE"}`,
                  background: active ? INK : primary ? "#E9F1EA" : "#FFFFFF",
                  // #1E6D29 on #E9F1EA = 5.47:1 (AA); #5E6779 on #FFFFFF = 5.69:1 (AA).
                  color: active ? "#FFFFFF" : primary ? GREEN_DEEP : "#5E6779",
                  fontWeight: primary ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {label}
                <span
                  data-count-label={label}
                  data-count-value={chipCounts[i] ?? 0}
                  className="inline-flex items-center justify-center font-mono text-[10.5px] font-semibold rounded-[8px]"
                  style={{
                    minWidth: 18,
                    height: 17,
                    padding: "0 5px",
                    background: active ? "rgba(255,255,255,0.16)" : primary ? "#D6E8D8" : "#F1F3F7",
                    color: active ? "#FFFFFF" : primary ? GREEN_DEEP : "#5E6779",
                  }}
                >
                  {chipCounts[i]?.toLocaleString() ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search input — full width on its own row on mobile, capped on sm+ */}
        <div
          className="flex items-center gap-1.5 rounded-[6px] px-3 w-full sm:w-auto sm:min-w-[160px] sm:max-w-[240px] sm:flex-shrink-0"
          style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", height: 32 }}
        >
          {/* An SVG magnifier, not an emoji: an emoji renders in the platform's
              font at the platform's colour and cannot inherit --ink-faint or
              participate in the system's icon construction language (WP-28). */}
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: "var(--ink-faint)", flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            aria-label="Search orders"
            placeholder="Search PO, buyer, supplier…"
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              border: "none",
              background: "none",
              fontSize: "12.5px",
              color: "#0B1A2F",
              flex: 1,
              minWidth: 0,
              padding: 0,
            }}
          />
        </div>

        {/* Columns visibility menu — desktop table only. Toggles the optional
            columns (Source / Value / Pipeline / Updated); structural columns are
            enableHiding:false so they never appear here. Session-only state. */}
        <div ref={columnsMenuRef} className="relative hidden lg:block sm:flex-shrink-0">
          <button
            type="button"
            onClick={() => setColumnsMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={columnsMenuOpen}
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
            style={{
              height: 32,
              border: `1px solid ${columnsMenuOpen ? INK : "#E5E8EE"}`,
              background: "#FFFFFF",
              color: "#5E6779",
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ fontSize: "13px" }}>▦</span>
            Columns
          </button>
          {columnsMenuOpen && (
            <div
              role="menu"
              aria-label="Toggle columns"
              className="absolute right-0 z-20 mt-1.5 rounded-[8px] py-1.5"
              style={{
                top: "100%",
                minWidth: 168,
                background: "#FFFFFF",
                border: "1px solid #E5E8EE",
                boxShadow: "0 8px 24px rgba(11,26,47,0.12)",
              }}
            >
              <div
                className="px-3 pb-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                style={{ color: "var(--ink-faint)" }}
              >
                Show columns
              </div>
              {table.getAllLeafColumns()
                .filter((col) => col.getCanHide())
                .map((col) => {
                  const label = col.columnDef.meta?.label ?? col.id;
                  const visible = col.getIsVisible();
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={visible}
                      onClick={() => col.toggleVisibility()}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#F6F7FA]"
                      style={{ color: "#0B1A2F", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={visible}
                        tabIndex={-1}
                        style={{ accentColor: BLUE, cursor: "pointer", width: 13, height: 13, pointerEvents: "none" }}
                      />
                      {label}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* The Pipeline column's key. Rendered only while that column is visible, so the
          legend never explains something the Columns menu has hidden. */}
      {table.getColumn("status")?.getIsVisible() && <PipelineLegend />}

      {/* ── Queue table / mobile route cards — floating white card on grey canvas ── */}
      <div
        className="flex-1 min-h-0 overflow-auto mb-3"
        style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 12 }}
      >
        <div className="flex flex-col gap-2.5 p-3 lg:hidden">
          {/* Mobile loading skeleton — card-shaped, matching the route cards below
              so the list doesn't reflow when data lands. */}
          {isInitialLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`sk-${i}`}
                className="rounded-[10px] px-4 py-3.5"
                style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.05)" }}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 h-[15px] w-32 rounded bg-[#E5E8EE] animate-pulse" />
                    <div className="h-[13px] w-44 rounded bg-[#EEF1F6] animate-pulse" />
                  </div>
                  <div className="h-[18px] w-20 rounded-full bg-[#EEF1F6] animate-pulse" />
                </div>
                <div className="mb-2 h-[18px] w-14 rounded bg-[#EEF1F6] animate-pulse" />
                <div className="h-[15px] w-2/3 rounded bg-[#EEF1F6] animate-pulse" />
              </div>
            ))}
          {!isInitialLoading && pagedRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div style={{ fontSize: 28, color: "#CBD0DA" }}>⊘</div>
              {isFiltered ? (
                <>
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No matching orders</p>
                  <p className="text-[13px]" style={{ color: "#5E6779" }}>
                    No orders match the current filter or search. Try a different filter, or clear them to see everything.
                  </p>
                  <button
                    onClick={handleClearFilters}
                    style={{
                      marginTop: 8,
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      border: "1px solid #E5E8EE",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Your inbox is clear</p>
                  <p className="text-[13px]" style={{ color: "#5E6779" }}>{emptyStateCopy}</p>
                  <button
                    onClick={() => router.push("/upload")}
                    style={{
                      marginTop: 8,
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: BLUE,
                      color: "#FFFFFF",
                      border: "none",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ↑ Upload an order
                  </button>
                  {/* Practice-order path (task 9) — genuine-empty branch only,
                      never the filtered-zero branch. */}
                  <button
                    onClick={() => sample.runSample()}
                    disabled={sample.isPending}
                    style={{
                      height: 32,
                      padding: "0 16px",
                      borderRadius: 6,
                      background: "#FFFFFF",
                      color: "#0B1A2F",
                      border: "1px solid #E5E8EE",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: sample.isPending ? "default" : "pointer",
                      opacity: sample.isPending ? 0.6 : 1,
                    }}
                  >
                    {sample.isPending ? "Starting practice order…" : "Try a practice order"}
                  </button>
                  {sample.error && (
                    <p className="text-[12px]" style={{ color: "#B43838" }}>{sample.error.message}</p>
                  )}
                </>
              )}
            </div>
          )}
          {pagedRows.map((row) => (
            // Card + action share ONE bordered wrapper. The card itself stays a
            // <button> (tapping it opens the order), so the send action cannot live
            // inside it — nesting buttons is invalid — and sits below the hairline
            // instead. Only "Ready to send" rows grow the footer.
            <div
              key={row.id}
              className="rounded-[10px] overflow-hidden"
              style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 2px rgba(11,26,47,0.05)" }}
            >
            <button
              className="block w-full px-4 py-3.5 text-left transition-colors active:bg-[#F6F7FA]"
              style={{ background: "transparent", border: 0, minHeight: 44 }}
              onClick={() => router.push(`/inbox/${row.original.id}`)}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="truncate font-mono text-[13px] font-semibold" style={{ color: INK }}>
                      {row.original.po}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
                    {row.original.age} ago · {row.original.lines} lines · <span className="whitespace-nowrap">{row.original.valueLabel}</span>
                  </p>
                </div>
                {/* The SAME badge the desktop Status column renders, keyed on the same
                    raw status. The card used to render StatusDotPill off the collapsed
                    CrossingStatus, so one order read "Extracting" here and "Preparing
                    output" on desktop. One component, one vocabulary, both viewports. */}
                <span style={{ flexShrink: 0, marginLeft: 8 }}>
                  <UnifiedStatusBadge status={row.original.rawStatus} icon />
                </span>
              </div>
              {/* The pipeline, as words. The dot track is desktop-only; at 390px four
                  words say more than five 11px dots, are legible at any width, and are
                  announced without any ARIA at all. */}
              <p className="mb-2 text-[12px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
                {pipelineCardLine(journeyStage(row.original.status, row.original.rawStatus))}
              </p>
              <div className="mb-2 flex items-center gap-2">
                <FileChip type={row.original.fmt} />
                {row.original.issues > 0 && (
                  <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: "#FBE3E3", color: "#B43838" }}>
                    {row.original.issues} to review
                  </span>
                )}
              </div>
              {(() => {
                const buyer = row.original.buyer;
                const hasBuyer = buyer != null && buyer.trim() !== "" && buyer.trim() !== "—";
                // An unrouted order has no supplier to print, so the supplier slot
                // carries the action instead — same words as the desktop cell. It is
                // NOT a button here: the whole card is already one (nesting is invalid),
                // and tapping the card goes exactly where the words say.
                const supplierSlot = row.original.rawStatus === "unrouted" ? (
                  <span
                    className="truncate font-semibold"
                    style={{ color: "#B36D14", background: "#FAF1DD", border: "1px solid #EBD7AE", borderRadius: 5, padding: "1px 7px", fontSize: 12 }}
                  >
                    Assign {labels.counterpartyNoun.toLowerCase()} →
                  </span>
                ) : (
                  <span className="truncate font-medium" style={{ color: GREEN_DEEP }}>{row.original.supplier}</span>
                );
                // Missing buyer → one honest line (supplier only) instead of two
                // disconnected dashes. Present buyer → buyer → supplier rail that
                // stacks vertically on mobile, horizontal from sm up.
                if (!hasBuyer) {
                  return (
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{labels.unknownBuyer}</span>
                      <span aria-hidden style={{ color: "#CBD0DA" }}>→</span>
                      {supplierSlot}
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col items-start gap-1 text-[13px] sm:flex-row sm:items-center sm:gap-2">
                    <span className="truncate font-medium" style={{ color: BLUE_DEEP }}>{buyer}</span>
                    <span
                      aria-hidden
                      className="h-px w-5 flex-shrink-0 hidden sm:block"
                      style={{ background: "linear-gradient(90deg, #1E66C9, #2E8E3A)" }}
                    />
                    <span aria-hidden className="text-[11px] leading-none sm:hidden" style={{ color: "#CBD0DA" }}>↓</span>
                    {supplierSlot}
                  </div>
                );
              })()}
            </button>
            {canRowSend(row.original) && (
              <div style={{ borderTop: "1px solid #E5E8EE" }}>
                <button
                  type="button"
                  // See RowSendButton — the desktop twin carries data-row-send="desktop".
                  data-row-send="mobile"
                  onClick={() => handleRowSend(row.original)}
                  disabled={rowSendingId !== null}
                  aria-label={`${ROW_SEND_CTA} — ${row.original.po}`}
                  className="w-full text-[13px] font-semibold"
                  style={{
                    // 44px — the tap-target floor, which is why the desktop button is
                    // 28px and this one is not.
                    minHeight: 44,
                    background: BLUE,
                    color: "#FFFFFF",
                    border: 0,
                    opacity: rowSendingId !== null && rowSendingId !== row.original.id ? 0.5 : 1,
                  }}
                >
                  {rowSendingId === row.original.id ? ROW_SEND_CTA_PROGRESS : ROW_SEND_CTA}
                </button>
              </div>
            )}
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto lg:block">
        <table
          style={{
            width: "100%",
            // 1180 → 1280: the chevron slot grew to 132px to hold the "Ready to send"
            // row's primary send button. The table already scrolls horizontally.
            minWidth: 1280,
            borderCollapse: "collapse",
            fontSize: 12.5,
            tableLayout: "fixed",
          }}
        >
          {/* Colgroup for fixed widths — must track the VISIBLE leaf columns so
              widths stay aligned when the Columns menu hides one (tableLayout:fixed
              maps <col> positionally onto rendered cells). */}
          <colgroup>
            {table.getVisibleLeafColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>

          {/* Sticky header */}
          <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
            {table.getHeaderGroups().map((hg) => (
              // v2 tinted header band (surface-2) — full-bleed table treatment.
              <tr key={hg.id} style={{ borderBottom: "1px solid #E5E8EE", background: "#F1F3F7" }}>
                {hg.headers.map((header, hi) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const toggleSort = header.column.getToggleSortingHandler();
                  // Plain-text label for the sort button's accessible name.
                  const headerDef = header.column.columnDef.header;
                  const columnLabel =
                    typeof headerDef === "string" && headerDef ? headerDef : header.column.id;
                  return (
                    // Native columnheader: aria-sort lives on the <th> (valid here,
                    // invalid on role=button), while the real <button> inside carries
                    // the click/keyboard affordance. Veterans live on the keyboard.
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                            ? "descending"
                            : "none"
                          : undefined
                      }
                      style={{
                        padding: "10px 10px",
                        paddingLeft: hi === 0 ? 16 : 10,
                        textAlign: "left",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        color: "var(--ink-muted)",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        background: "#F1F3F7",
                      }}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={toggleSort}
                          aria-label={`Sort by ${columnLabel}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            background: "none",
                            border: "none",
                            padding: 0,
                            margin: 0,
                            font: "inherit",
                            color: "inherit",
                            letterSpacing: "inherit",
                            textTransform: "inherit",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon state={sorted} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody ref={tableBodyRef}>
            {/* Desktop loading skeleton — one pulse bar per visible column, so the
                table keeps its real shape (header stays mounted above) instead of
                swapping to a bare card. */}
            {isInitialLoading &&
              Array.from({ length: 9 }).map((_, ri) => (
                <tr key={`sk-row-${ri}`} style={{ height: 44, borderBottom: "1px solid #EEF0F4" }}>
                  {table.getVisibleLeafColumns().map((col, ci) => (
                    <td key={col.id} style={{ padding: "0 10px", paddingLeft: ci === 0 ? 16 : 10 }}>
                      <div
                        className="h-[14px] rounded bg-[#EEF1F6] animate-pulse"
                        style={{ width: ci === 0 ? 24 : "70%" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {!isInitialLoading && pagedRows.map((row, rowIndex) => {
              const isSelected = row.getIsSelected();
              const isActive = rowIndex === activeRow;
              return (
                <tr
                  key={row.id}
                  data-row
                  onClick={() => router.push(`/inbox/${row.original.id}`)}
                  style={{
                    height: 44,
                    borderBottom: "1px solid #EEF0F4",
                    cursor: "pointer",
                    background: isSelected
                      ? "#EAF0F8"
                      : isActive
                      ? "#EEF4FE"
                      : row.original.status === "review"
                      ? "#FAF1DD08"
                      : row.original.status === "failed"
                      ? "#FBE3E308"
                      // Same tinted-row idiom as review/failed, applied to the state the
                      // product exists to produce. Decorative only — the badge and the
                      // Send button carry the meaning, so nothing depends on the wash.
                      : row.original.status === "ready"
                      ? "#E9F1EA0A"
                      : "#FFFFFF",
                    boxShadow: isActive ? "inset 2px 0 0 #1E66C9, inset 0 0 0 1px #1E66C9" : undefined,
                    transition: "background 80ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isActive) (e.currentTarget as HTMLElement).style.background = "#F6F7FA";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isActive) {
                      const s = row.original.status;
                      (e.currentTarget as HTMLElement).style.background =
                        s === "review" ? "#FAF1DD08" : s === "failed" ? "#FBE3E308" : s === "ready" ? "#E9F1EA0A" : "#FFFFFF";
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell, ci) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0 10px",
                        paddingLeft: ci === 0 ? 16 : 10,
                        verticalAlign: "middle",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Empty state — filter-aware: 0 rows under a filter/search means "no
                MATCHING orders" (clear filters), not a genuinely empty inbox. */}
            {!isInitialLoading && pagedRows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} style={{ textAlign: "center", padding: "64px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 16, color: "#CBD0DA" }}>⊘</div>
                  {isFiltered ? (
                    <>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#0B1A2F",
                          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                          marginBottom: 8,
                        }}
                      >
                        No matching orders
                      </p>
                      <p style={{ fontSize: 13, marginTop: 4, color: "#5E6779", maxWidth: 380, margin: "8px auto 0" }}>
                        No orders match the current filter or search. Try a different filter, or clear them to see everything.
                      </p>
                      <button
                        onClick={handleClearFilters}
                        style={{
                          marginTop: 16,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: "#FFFFFF",
                          color: "#0B1A2F",
                          border: "1px solid #E5E8EE",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#0B1A2F",
                          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                          marginBottom: 8,
                        }}
                      >
                        Your inbox is clear
                      </p>
                      <p style={{ fontSize: 13, marginTop: 4, color: "#5E6779", maxWidth: 380, margin: "8px auto 0" }}>
                        {emptyStateCopy}
                      </p>
                      <button
                        onClick={() => router.push("/upload")}
                        style={{
                          marginTop: 16,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: BLUE,
                          color: "#FFFFFF",
                          border: "none",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ↑ Upload an order
                      </button>
                      {/* Practice-order path (task 9) — genuine-empty branch only,
                          never the filtered-zero branch. */}
                      <button
                        onClick={() => sample.runSample()}
                        disabled={sample.isPending}
                        style={{
                          marginTop: 8,
                          marginLeft: 8,
                          height: 32,
                          padding: "0 16px",
                          borderRadius: 6,
                          background: "#FFFFFF",
                          color: "#0B1A2F",
                          border: "1px solid #E5E8EE",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: sample.isPending ? "default" : "pointer",
                          opacity: sample.isPending ? 0.6 : 1,
                        }}
                      >
                        {sample.isPending ? "Starting practice order…" : "Try a practice order"}
                      </button>
                      {sample.error && (
                        <p style={{ fontSize: 12, marginTop: 8, color: "#B43838" }}>{sample.error.message}</p>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Footer: total + pagination controls — on the grey canvas, below the card */}
      <div
        className="flex-shrink-0 flex flex-wrap items-center gap-3 pt-0.5"
        style={{ background: "var(--bg)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {totalCount.toLocaleString()} order{totalCount !== 1 ? "s" : ""}
          {selectedCount > 0 && <span style={{ color: BLUE_DEEP }}> · {selectedCount} selected</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setParams({ page: currentPage - 1 <= 1 ? null : String(currentPage - 1) })}
            disabled={currentPage <= 1}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E5E8EE", background: "#FFFFFF", color: currentPage <= 1 ? "#CBD0DA" : "#0B1A2F", cursor: currentPage <= 1 ? "default" : "pointer" }}
          >
            ← Prev
          </button>
          <span className="text-[11px] font-mono" style={{ color: "#5E6779", minWidth: 92, textAlign: "center" }}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setParams({ page: String(currentPage + 1) })}
            disabled={currentPage >= totalPages}
            className="rounded-[6px] px-2.5 text-[12px] font-medium"
            style={{ height: 28, border: "1px solid #E5E8EE", background: "#FFFFFF", color: currentPage >= totalPages ? "#CBD0DA" : "#0B1A2F", cursor: currentPage >= totalPages ? "default" : "pointer" }}
          >
            Next →
          </button>
        </div>
      </div>
    </PageShell>
  );
}
