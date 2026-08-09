"use client";

// Delivery log — append-only audit trail with date-grouped table-row layout.
// Pixel-exact port of CrossingsLogScreen / CrossingRow in screen-crossings.jsx
// (Claude Design source). Uses the ported design classes from globals.css
// (.work-inner / .fchip / .btn / .card / .eyebrow / .mono / .faint), the
// canonical PageHeader for the title row, and the locked colour vars
// (--brand-blue #1E66C9 = buyer/primary, --brand-green #2E8E3A = supplier).
// User-visible copy is plain ("Delivery log"); component/type/file names are
// unchanged.

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAuditLog, isApiMockMode, type AuditLogEntry } from "@/lib/api-client";
import {
  auditActionFact,
  auditActionLabel,
  auditEventKind,
  auditEventReason,
  type AuditActionFact,
  type AuditEventKind,
} from "@/lib/auditActionManifest";
import { EmptyState } from "./EmptyState";
import { isPlanGate, PlanGateNotice } from "./PlanGateNotice";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";

// ─── Types ────────────────────────────────────────────────────────────────────

// The row vocabulary IS the manifest's, not a second list kept beside it. It used
// to be a local six-member union fed by two chained hand-typed maps
// (ACTION_TO_EVENT → EVENT_TO_CANONICAL), and the first of those maps was written
// in snake_case against a backend vocabulary that is almost entirely PascalCase —
// so nearly every real action missed it, took a `?? "crossed"` fallback, and
// rendered green as "Delivered". See src/lib/auditActionManifest.ts.
type CanonicalEvent = AuditEventKind;

// Internal event type kept for backward compat with mock data
type EventType =
  | "uploaded"
  | "extracted"
  | "mapped"
  | "validated"
  | "flagged"
  | "reviewed"
  | "crossed"
  | "failed"
  | "retried";

type Actor = { initials: string; name: string; type: "user" | "system" | "ai" };

type LogEntry = {
  id: string;
  ts: string;         // display time HH:mm:ss
  isoTs: string;      // ISO for grouping
  crossingId: string;
  po: string;
  buyer: string;
  supplier: string;
  fmt: string;
  /**
   * Mock-only. The demo rows below are authored in the old internal vocabulary and
   * keep it; nothing on the live path sets this, and nothing reads it for
   * behaviour — the "Open to resend" control is gated on `canonicalEvent`, which
   * is derived from the backend action rather than from this.
   */
  event?: EventType;
  canonicalEvent: CanonicalEvent;
  /** The raw backend action, when this row came from the API. Drives the label. */
  action?: string;
  actor: Actor;
  message: string;
  /**
   * Why this event happened, in the backend's own words — or absent.
   *
   * Lifted from the audit `payload` by `auditEventReason`, which knows per action
   * which key carries prose. ABSENT IS THE NORMAL CASE and must stay renderable as
   * nothing: most actions carry no reason, and the ones that do can carry a null.
   * Never synthesised from the action, the status, or the message.
   */
  reason?: string;
  // Structured key/value detail grid (mirrors `c.detail` in screen-crossings.jsx).
  // Rendered as the eyebrow-labelled grid in the expanded panel.
  details?: Record<string, string>;
  // Recoverable / hard error surfaced as an amber / red banner (design parity).
  error?: string;
  recoverable?: boolean;
  // Legacy free-text detail + field-diff (kept for backward compat / API fallback).
  detail?: string;
  diff?: Array<{ field: string; from: string; to: string }>;
};

// ─── Mock data ─────────────────────────────────────────────────────────────────
// Mirrors the CROSSINGS fixture shape from screen-crossings.jsx (structured
// `details` grids + error banners) while keeping demo-safe PO ids — the
// no-mock-residue e2e crawl bans the canonical fake-PO literals on this route,
// so the design source's example PO numbers are intentionally NOT reused here.

const now = Date.now();
const MOCK_LOG: LogEntry[] = [
  {
    id: "e1",
    ts: "14:22:08", isoTs: new Date(now - 2 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "flagged", canonicalEvent: "validated",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "3 validation errors flagged",
    details: { rules: "3 failed", scope: "Lines 4, 9 · Header", note: "Unit price missing · delivery date in the past" },
    detail: "Unit price missing on lines 4, 9. Delivery date in the past (2026-05-10).",
    diff: [
      { field: "line[4].unitPrice", from: "(missing)", to: "⚠ required" },
      { field: "line[9].unitPrice", from: "(missing)", to: "⚠ required" },
      { field: "header.deliveryDate", from: "2026-05-10", to: "⚠ past date" },
    ],
  },
  {
    id: "e2",
    ts: "14:22:05", isoTs: new Date(now - 14 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "extracted", canonicalEvent: "parsed",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "14 line items extracted · avg confidence 84%",
    details: { srcType: "PDF", lines: "14", confidence: "84% avg", dur: "1.1s" },
    detail: "Document parsed successfully. Zones: header (97%), line table (81%), footer (72%).",
  },
  {
    id: "e3",
    ts: "14:21:51", isoTs: new Date(now - 20 * 60000).toISOString(),
    crossingId: "demo-001", po: "PO-DEMO-001",
    buyer: "Heinrich Industries", supplier: "Acme Components", fmt: "PDF",
    event: "uploaded", canonicalEvent: "created",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Document uploaded — PO-DEMO-001.pdf (214 KB)",
    details: { srcType: "PDF", size: "214 KB", via: "Manual upload" },
  },
  {
    id: "e4",
    ts: "14:08:33", isoTs: new Date(now - 60 * 60000).toISOString(),
    crossingId: "wmt341", po: "WMT-2026-0341",
    buyer: "Westmark Tools", supplier: "Acme Components", fmt: "EMAIL",
    event: "crossed", canonicalEvent: "delivered",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Sent — endpoint answered HTTP 200 (received; not the same as supplier acceptance)",
    details: { channel: "HTTP", status: "HTTP 200 (received)", dur: "1.2s", size: "3.1 KB", attempt: "1" },
    detail: "Endpoint answered HTTP 200 in 1.2s. A 200 means the endpoint received the file — it is not confirmation the supplier accepted the order.",
  },
  {
    id: "e5",
    ts: "14:07:44", isoTs: new Date(now - 65 * 60000).toISOString(),
    crossingId: "wmt341", po: "WMT-2026-0341",
    buyer: "Westmark Tools", supplier: "Acme Components", fmt: "EMAIL",
    event: "reviewed", canonicalEvent: "edited",
    actor: { initials: "MK", name: "Marius Klein", type: "user" },
    message: "Approved for delivery after manual review",
    details: { field: "Header · approval", from: "pending", to: "approved" },
  },
  {
    id: "e6",
    ts: "13:54:12", isoTs: new Date(now - 90 * 60000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "failed", canonicalEvent: "failed",
    actor: { initials: "SY", name: "ProcuLink system", type: "system" },
    message: "Delivery attempt failed — endpoint timeout (30s)",
    details: { channel: "EMAIL", status: "SFTP timeout", dur: "30.0s", attempt: "2" },
    error: "MedicaSupply OY endpoint returned HTTP 504 after 30s",
    recoverable: true,
    detail: "MedicaSupply OY cXML endpoint returned HTTP 504. Will retry in 15 min.",
  },
  {
    id: "e7",
    ts: "13:39:20", isoTs: new Date(now - 2 * 24 * 60 * 60000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "mapped", canonicalEvent: "edited",
    actor: { initials: "AI", name: "Mapping engine", type: "ai" },
    message: "18 codes mapped · 6 low-confidence matches",
    details: { mapped: "18 codes", lowConfidence: "6 matches" },
    diff: [
      { field: "line[3].supplierCode", from: "CPH-SYRG-10", to: "MDS-SY-10-STERILE (72%)" },
      { field: "line[7].supplierCode", from: "CPH-GLOVE-L", to: "MDS-GL-L-NITRILE (68%)" },
    ],
  },
  {
    id: "e8",
    ts: "13:38:05", isoTs: new Date(now - 2 * 24 * 60 * 60000 + 5000).toISOString(),
    crossingId: "850201", po: "850-99201",
    buyer: "Centralis Pharma", supplier: "MedicaSupply OY", fmt: "EDI",
    event: "extracted", canonicalEvent: "parsed",
    actor: { initials: "AI", name: "Extraction engine", type: "ai" },
    message: "18 line items extracted from EDI 850 segment",
    details: { srcType: "EDI", lines: "18", segment: "850", dur: "0.6s" },
  },
];

// ─── Map AuditLogEntry → LogEntry ─────────────────────────────────────────────

/**
 * Turn the backend's own message into something an operator can read.
 *
 * `AuditController.BuildMessage` only has sentences for seven snake_case names and
 * ends with `_ => $"{action}{po}"`, so every PascalCase action describes itself to
 * the user as its own engine identifier — "DeliveryDeadLettered · PO-4711". When the
 * manifest knows the action, swap that leading identifier for the human label and
 * keep whatever the backend appended (the " · PO-…" suffix).
 *
 * Only the exact fallback shape is rewritten. A message the backend wrote a real
 * sentence for is passed through untouched.
 */
function humaniseMessage(action: string, message: string, fact: AuditActionFact | null): string {
  if (!fact || !message) return message;
  if (message === action || message.startsWith(`${action} ·`)) {
    return fact.label + message.slice(action.length);
  }
  return message;
}

function mapApiEntry(e: AuditLogEntry): LogEntry {
  // One lookup against the manifest, case-insensitively, and an action the manifest
  // does not know resolves to `unknown` — NOT to a delivery. The previous code
  // chained two hand-typed maps and fell back to "crossed" → "delivered", so an
  // unrecognised action and a completed send were the same green row.
  const fact = auditActionFact(e.action);
  const canonicalEvent: CanonicalEvent = auditEventKind(e.action);

  const d = new Date(e.ts);
  const ts = Number.isNaN(d.getTime())
    ? e.ts
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return {
    id:             e.id,
    ts,
    isoTs:          e.ts,
    crossingId:     e.orderId ?? e.id,
    po:             e.poNumber ?? e.orderId ?? "—",
    buyer:          e.buyerName ?? "—",
    supplier:       e.supplierName ?? "—",
    fmt:            e.format ?? "—",
    canonicalEvent,
    action:         e.action,
    actor: {
      initials: e.actorInitials,
      name:     e.actorName,
      type:     e.actorType,
    },
    message: humaniseMessage(e.action, e.message, fact),
    // The audit DTO has always carried `payload` and this screen has never read it,
    // so the log could say an order failed and never why — the one question an
    // operator opens it to answer. `auditEventReason` returns undefined-equivalent
    // (null) for every action with no declared reason key, for an absent payload, and
    // for a body that survives sanitising as nothing legible; all three render as no
    // reason at all rather than as a guess.
    reason: auditEventReason(e.action, e.payload) ?? undefined,
  };
}

/** The row's event name: the manifest's per-action label, or the kind's own. */
function entryLabel(e: LogEntry): string {
  return e.action ? auditActionLabel(e.action) : EV_CANON[e.canonicalEvent].label;
}

// ─── Date group label ─────────────────────────────────────────────────────────

function groupLabel(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "Recent activity";
  const long = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (d.toDateString() === today) return `Today · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  if (d.toDateString() === yesterday) return `Yesterday · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  return long;
}

function dateKey(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toDateString();
}

// ─── Canonical event visual config ────────────────────────────────────────────
// The row's icon, circle tint, label, and text colour are driven by
// canonicalEvent (NOT the internal EventType) so every "Validated" reads
// green-check, every "Edited" reads violet-pencil, etc. — exactly like
// CROSSING_EVENTS in the design source. All colours come from the locked
// design tokens (greens use the muted status green #2E8E3A, not the bright
// CTA green). Icon paths match data.jsx ICON_PATHS keys per event.
const EV_CANON: Record<
  CanonicalEvent,
  { bg: string; color: string; label: string; iconPath: string }
> = {
  // created → "plus" · ink-muted on surface-2
  created:   { bg: "var(--surface-2)",        color: "var(--ink-muted)",         label: "Created",   iconPath: "M5 12h14 M12 5v14" },
  // parsed → "file" · brand-blue-deep on brand-blue-soft
  parsed:    { bg: "var(--brand-blue-soft)",  color: "var(--brand-blue-deep)",   label: "Parsed",    iconPath: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" },
  // validated → "checkCircle" · brand-green-deep on brand-green-soft
  validated: { bg: "var(--brand-green-soft)", color: "var(--brand-green-deep)",  label: "Validated", iconPath: "M12 2a10 10 0 1 0 10 10 M9 12l2 2 4-4" },
  // edited → "pencil" · ai on ai-soft
  edited:    { bg: "var(--ai-soft)",          color: "var(--ai)",                label: "Edited",    iconPath: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" },
  // delivered → "send" · brand-green-deep on brand-green-soft
  delivered: { bg: "var(--brand-green-soft)", color: "var(--brand-green-deep)",  label: "Delivered", iconPath: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z M21.854 2.147l-10.94 10.939" },
  // failed → "alert" · danger on danger-soft
  failed:    { bg: "var(--danger-soft)",      color: "var(--danger)",            label: "Failed",    iconPath: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z M12 9v4 M12 17h.01" },
  // held → "pause" · amber. Nothing broke, but the order stopped and only a person
  // (or a billing settlement) restarts it. Amber, never green: a paused send that
  // reads as a delivery is the same lie as a failure that reads as one.
  held:      { bg: "var(--amber-soft)",       color: "var(--amber-text)",        label: "Held",      iconPath: "M10 4H6v16h4z M18 4h-4v16h4z" },
  // recovered → "rotate" · brand-blue. A sweeper or an operator un-stuck something:
  // not a failure, and not an arrival either.
  recovered: { bg: "var(--brand-blue-soft)",  color: "var(--brand-blue-deep)",   label: "Recovered", iconPath: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" },
  // unknown → "help" · ink-muted on surface-2. THE BACKEND SENT AN ACTION THIS
  // BUILD DOES NOT KNOW. Deliberately drab and deliberately not green — the whole
  // defect this file was fixed for is that unrecognised actions used to render as
  // completed deliveries.
  unknown:   { bg: "var(--surface-2)",        color: "var(--ink-muted)",         label: "Unrecognised", iconPath: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01" },
};

// Canonical filter labels (from CrossingsLogScreen), plus the two kinds the
// manifest added. `unknown` gets NO chip on purpose: it is a signal that this build
// is behind the backend, not a workflow an operator filters by — it stays visible
// under "All events", where it cannot be missed.
const FILTERS: Array<{ key: CanonicalEvent | "all"; label: string }> = [
  { key: "all",       label: "All events" },
  { key: "delivered", label: "Delivered" },
  { key: "failed",    label: "Failed" },
  { key: "held",      label: "Held" },
  { key: "recovered", label: "Recovered" },
  { key: "edited",    label: "Edited" },
  { key: "validated", label: "Validated" },
  { key: "parsed",    label: "Parsed" },
  { key: "created",   label: "Created" },
];

/**
 * The row's event badge.
 *
 * Local rather than `<UnifiedStatusBadge status={canonicalEvent} />`, which was
 * here before: that component's vocabulary is ORDER STATUSES, and its `failed`
 * entry is labelled "Couldn't read file" — the parse-failure status. Every failure
 * row on this page therefore announced itself as a parse failure, and this change
 * is what makes failure rows appear at all, so the mislabel would have spread from
 * (effectively) none of them to all of them. Tones come from the same EV_CANON
 * tokens the row icon uses, and the text is the manifest's per-action label.
 */
function EventBadge({ entry }: { entry: LogEntry }) {
  const ev = EV_CANON[entry.canonicalEvent];
  const label = entryLabel(entry);
  return (
    <span
      className="rounded-full font-semibold whitespace-nowrap"
      // inline-block + ellipsis rather than inline-flex: the desktop column is a
      // fixed width, and the manifest's labels are real sentences ("Could not build
      // the supplier file"), so the long ones must clip visibly with the full text
      // still reachable rather than push the row's other columns out of line.
      style={{
        background: ev.bg,
        color: ev.color,
        display: "inline-block",
        maxWidth: "100%",
        height: 20,
        lineHeight: "20px",
        padding: "0 8px",
        fontSize: 11,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={label}
      // The kind, on the element that renders it. Without this the only observable
      // difference between a row classified `delivered` and one classified `unknown`
      // is a background colour, so a guard can assert the LABEL is right while the
      // row is still painted as a success — which is the defect wearing a new coat.
      data-event-kind={entry.canonicalEvent}
    >
      {label}
    </span>
  );
}

// ─── Responsive hook ──────────────────────────────────────────────────────────
// Self-contained (no shared hook to import). SSR-safe: starts false, syncs after
// mount so the desktop flat-row table stays pixel-exact while ≤ 640px gets a
// stacked-card layout. 640px = Tailwind `sm` breakpoint.

function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);
  return isMobile;
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="row gap-3 items-center" style={{ height: 44, padding: "0 16px", borderBottom: "1px solid var(--border)" }}>
      {[64, 26, 82, 150, 220, 110].map((w, i) => (
        <div key={i} className="skel" style={{ height: 13, width: w, flexShrink: 0 }} />
      ))}
    </div>
  );
}

// ─── Desktop column header ────────────────────────────────────────────────────
// Gives the flat desktop row-list a real, sticky table head. Column widths match
// the desktop CrossingRow exactly (Time 64 · icon 26 · Event 150 · PO 150 · Route
// grow · Actor 110 · chevron 15) with the same gap-3 / 11px-16px padding. The log
// is an append-only, time-descending feed, so Time carries a static
// aria-sort="descending". Sticks to the PageShell scroll viewport; opaque
// surface-2 (the unified listTableV2 tinted header band) so scrolled rows don't
// bleed through, single low-contrast --border gridline below.
function DesktopColHeader() {
  const cell = {
    fontSize: 10.5,
    fontWeight: 700 as const,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
    color: "var(--ink-muted)",
  };
  return (
    // role="table" wrapper so the columnheader + aria-sort roles below are valid
    // (an orphaned role="row"/"columnheader" with no table/grid ancestor is dropped
    // by assistive tech). Sticky + visual layout live on this container unchanged;
    // the inner role="row" is display:contents so it adds no box.
    <div
      role="table"
      aria-label="Delivery log columns"
      className="row gap-3 items-center"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        padding: "10px 16px",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--border)",
        borderRadius: "var(--radius) var(--radius) 0 0",
        marginBottom: 8,
      }}
    >
      <div role="row" style={{ display: "contents" }}>
        <span role="columnheader" aria-sort="descending" style={{ ...cell, width: 64, flexShrink: 0 }}>
          Time
        </span>
        {/* icon circle column (26px) — no header text */}
        <span aria-hidden style={{ width: 26, flexShrink: 0 }} />
        <span role="columnheader" style={{ ...cell, width: 150, flexShrink: 0 }}>Event</span>
        <span role="columnheader" style={{ ...cell, width: 150, flexShrink: 0 }}>PO</span>
        <span role="columnheader" className="grow" style={{ ...cell, minWidth: 0 }}>Route</span>
        <span role="columnheader" style={{ ...cell, width: 110, flexShrink: 0, textAlign: "right" }}>
          Actor
        </span>
        {/* chevron column (15px) — no header text */}
        <span aria-hidden style={{ width: 15, flexShrink: 0 }} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CrossingsLog() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [openId, setOpenId]     = useState<string | null>(null);
  const [filter, setFilter]     = useState<CanonicalEvent | "all">("all");
  const [search, setSearch]     = useState("");

  // The URL IS the order filter. `?orderId=` is READ from the query string on every
  // render and never copied into useState on mount: that is the same rule InboxView
  // spells out for `?status=`, and for the same reason — a mirrored copy is a second
  // source of truth that goes stale the first time the URL changes under a mounted
  // view. A failed order's "See every attempt" links here with that param; until now
  // nothing on this page read it, so the operator asking about ONE order landed on
  // the whole workspace's log with no hint that their question had been dropped.
  const params = useSearchParams();
  const orderFilter = (params.get("orderId") ?? "").trim();

  // GET /api/audit takes `page` and `pageSize` and NOTHING else — there is no
  // per-order parameter to ask for (AuditController.GetAuditLog), so one order's
  // entries must be picked out of a page we already hold. When an order filter is
  // active we therefore ask for the widest page the API will serve (it clamps
  // pageSize to 1..200) and then state below exactly how far that window reached.
  // With no filter the page keeps its original 50-entry request, unchanged.
  const pageSize = orderFilter ? 200 : 50;

  // WHICH page of that history is on screen.
  //
  // The API has taken `page` since it was written and returns `total`, but this
  // component only ever asked for page 1 and rendered no page control, so an org's
  // audit history beyond its newest 50 entries could not be reached from the
  // product at all — not by scrolling, not by searching, not by any control on the
  // screen. Search and the filter chips run over the loaded page (see `filtered`
  // below), so paging is also the only way they can reach an older PO.
  //
  // Kept in component state rather than the URL: `?orderId=` is an identity worth
  // sharing, a scroll position in a live-tailing operations log is not, and the
  // route's query-param registry stays untouched.
  const [page, setPage] = useState(1);

  // Any change to what we are looking FOR resets where we are looking. Without
  // this, narrowing the filter while on page 7 shows an empty page 7 and reads as
  // "no such events".
  useEffect(() => {
    setPage(1);
  }, [orderFilter, filter, search]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["audit", pageSize, page],
    queryFn:  () => getAuditLog(page, pageSize),
    enabled:  !isApiMockMode,
    // Hold the previous page on screen while the next one loads, so paging does not
    // flash the skeleton and re-collapse every expanded row.
    placeholderData: keepPreviousData,
  });

  // Below Operations the API refuses this page outright (403
  // `advanced_audit_requires_operations`). That is not a network fault, so it must not read
  // as one — and Retry could only 403 again.
  const planGated = isError && isPlanGate(error);

  const ALL_ENTRIES: LogEntry[] = isApiMockMode
    ? MOCK_LOG
    : (data?.events ?? []).map(mapApiEntry);

  // GUIDs come back lowercase from the API but the param is whatever was in the
  // address bar, so compare case-insensitively rather than dropping a valid link.
  const LOG: LogEntry[] = orderFilter
    ? ALL_ENTRIES.filter((e) => e.crossingId.toLowerCase() === orderFilter.toLowerCase())
    : ALL_ENTRIES;

  // How much of the workspace's history this page actually holds. `total` is every
  // entry the org has; `loadedCount` is the one page we fetched. When they differ we
  // have NOT seen every entry for this order and must not imply otherwise — a short
  // list that silently means "within the last 200" is the same lie as an unfiltered
  // log pretending to be filtered.
  const loadedCount   = isApiMockMode ? ALL_ENTRIES.length : (data?.events?.length ?? 0);
  const totalEntries  = isApiMockMode ? ALL_ENTRIES.length : (data?.total ?? loadedCount);
  const windowPartial = totalEntries > loadedCount;

  // Where this page sits in the whole history, for the range readout and the
  // Prev/Next bounds. `pageCount` is derived from the API's `total`, never guessed
  // from whether the last page came back short.
  const pageCount  = Math.max(1, Math.ceil(totalEntries / pageSize));
  const firstIndex = loadedCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIndex  = (page - 1) * pageSize + loadedCount;
  const showPager  = !isApiMockMode && (pageCount > 1 || page > 1);

  // The log is append-only but not immutable — retention erases old events — so the
  // history can shrink under a reader who is paged deep into it, leaving `page`
  // past the end and the readout saying "page 5 of 2". Converges in one step
  // because pageCount does not depend on page.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  // The PO number is only knowable once a matching entry is in hand; with no match
  // the strip names no order rather than echoing a raw id at the operator.
  const filteredPo    = LOG[0]?.po ?? null;

  // Export filtered log as CSV
  function handleExport() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Timestamp", "Event", "PO", "Buyer", "Supplier", "Format", "Actor", "Message"];
    const body = filtered.map((e) =>
      [e.ts, entryLabel(e), e.po, e.buyer, e.supplier, e.fmt, e.actor.name, e.message]
        .map(esc).join(","),
    );
    const csv = [header.map(esc).join(","), ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filtered = LOG.filter((e) => {
    const mev = filter === "all" || e.canonicalEvent === filter;
    const q   = search.toLowerCase();
    const ms  = !q || e.po.toLowerCase().includes(q) || e.buyer.toLowerCase().includes(q) || e.supplier.toLowerCase().includes(q);
    return mev && ms;
  });

  // Group by calendar date
  const byDate = filtered.reduce<Map<string, { label: string; entries: LogEntry[] }>>(
    (acc, e) => {
      const key = dateKey(e.isoTs);
      if (!acc.has(key)) {
        acc.set(key, { label: groupLabel(e.isoTs), entries: [] });
      }
      acc.get(key)!.entries.push(e);
      return acc;
    },
    new Map(),
  );

  return (
    <PageShell variant="wide">
      {/* Page header — titleHidden: the topbar hub tab "Delivery log" is the
          page name (sr-only h1 kept); the descriptive subtitle is dropped, the
          Export action stays. */}
      <PageHeader
        titleHidden
        title="Deliveries"
        actions={
          /* Export log button — canonical: secondary */
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={filtered.length === 0}
            title={filtered.length === 0 ? "Nothing to export" : "Download current log as CSV"}
            style={isMobile ? { width: "100%", height: 40 } : undefined}
          >
            {/* download icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export log
          </button>
        }
      />

      {/* Order filter strip — the page SAYS it is showing one order, and offers the
          way back to everything. Without this a short list is indistinguishable from
          a quiet workspace. Rendered whenever the param is present (including the
          no-match case) so the way out is never missing. */}
      {orderFilter && !isLoading && !isError && (
        <div
          role="status"
          className="card"
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "center",
            gap: 12,
            padding: "11px 14px",
            marginBottom: 14,
            borderLeft: "3px solid var(--brand-blue)",
            background: "var(--brand-blue-soft)",
          }}
        >
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink)", flex: 1, minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>
              Showing one order{filteredPo ? ` — ${filteredPo}` : ""}.
            </strong>{" "}
            Every other order is hidden.
            {windowPartial
              ? ` We searched the ${loadedCount} entries on this page, out of ${totalEntries} in this workspace — more of this order's history may be on another page.`
              : ""}
          </p>
          <Link
            href="/operations/log"
            className="btn btn-secondary sm"
            style={{ flexShrink: 0, justifyContent: "center", ...(isMobile ? { height: 36 } : {}) }}
          >
            Show all deliveries
          </Link>
        </div>
      )}

      {/* Filter / search bar */}
      <div
        className="row between items-center"
        style={{
          marginBottom: 14,
          gap: 12,
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
        }}
      >
        {/* Filter chips — canonical .fchip row (auto horizontal-scroll on mobile via .fchip-row) */}
        <div className="row gap-2 wrap items-center fchip-row">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              className={`fchip ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
              style={isMobile ? { height: 36 } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {/* PO search — canonical search input. Mobile: full-width, 40px tall. */}
        <div
          className="row gap-2 items-center"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "0 10px",
            height: isMobile ? 40 : 30,
            width: isMobile ? "100%" : 200,
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            className="grow"
            placeholder="Filter by PO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: "none", background: "none", fontSize: 12.5, width: "100%", color: "var(--ink)" }}
          />
        </div>
      </div>

      {/* Loading state */}
      {isLoading && !isApiMockMode && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {/* Plan-gated state — an upgrade prompt, not a retry loop */}
      {planGated && !isApiMockMode && (
        <PlanGateNotice error={error} capability="The full delivery log" />
      )}

      {/* Error state */}
      {isError && !planGated && !isApiMockMode && (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 28, color: "var(--danger)", marginBottom: 10 }}>⚠</div>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>
            Could not load the delivery log. Check your connection and try again.
          </p>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Date-grouped content */}
      {(!isLoading || isApiMockMode) && !isError && (
        <>
          {filtered.length === 0 ? (
            <div className="card">
              {/* Two different nothings. `LOG` empty under an order filter means this
                  ORDER has no entries in the window we searched — saying "nothing
                  recorded for this filter yet" there reads as "your workspace is
                  quiet", which is the opposite of what the operator asked. When the
                  order does have entries and the chips or the search box zeroed them,
                  the original copy is still the right one. */}
              {orderFilter && LOG.length === 0 ? (
                <EmptyState
                  compact
                  title="Nothing recorded for this order"
                  sub={
                    windowPartial
                      ? `This order has no entries among the ${loadedCount} on this page (${totalEntries} in the workspace). Its entries may be on another page.`
                      : "Other orders still have entries — this one has none yet."
                  }
                />
              ) : (
                /* The unfiltered nothing. This used to read "No matching events /
                   Nothing recorded for this filter yet" with no hint of scope — but
                   the chips and the search box only ever see the page that is
                   loaded, so an operator searching for an older PO number got a
                   confident, wrong "nothing recorded". Say what was actually
                   searched. */
                <EmptyState
                  compact
                  title="No matching events on this page"
                  sub={
                    windowPartial
                      ? `Search and the filter chips only cover the ${loadedCount} entries on this page, out of ${totalEntries} in the workspace. Try another page.`
                      : "Nothing in this workspace's log matches."
                  }
                />
              )}
            </div>
          ) : (
            <>
            {/* Sticky desktop table head — one head for the whole log (hidden on mobile stacked cards) */}
            {!isMobile && <DesktopColHeader />}
            {Array.from(byDate.entries()).map(([key, { label, entries }]) => (
              <div key={key} style={{ marginBottom: 18 }}>
                {/* Date eyebrow */}
                <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>

                {/* Card with rows */}
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  {entries.map((c, idx) => {
                    // Visual treatment is canonical-event-driven to match the design
                    // (green Validated/Delivered, violet Edited, blue Parsed, slate Created, red Failed).
                    const ev   = EV_CANON[c.canonicalEvent];
                    const open = openId === c.id;
                    const hasDetails = !!c.details && Object.keys(c.details).length > 0;
                    const hasDiff    = !!c.diff?.length;
                    const hasText    = !!c.detail;
                    const isLast     = idx === entries.length - 1;

                    return (
                      <div
                        key={c.id}
                        style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}
                      >
                        {/* Main row — canonical CrossingRow button.
                            Desktop: single flat line with fixed columns (pixel-exact).
                            Mobile: stacked card (icon+label+time / PO / buyer→supplier / actor). */}
                        {isMobile ? (
                          <button
                            onClick={() => setOpenId(open ? null : c.id)}
                            aria-expanded={open}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              background: open ? "var(--surface-2)" : "none",
                              border: "none",
                              padding: "13px 14px",
                              transition: "background var(--duration-fast)",
                              cursor: "pointer",
                              display: "flex",
                              flexDirection: "column",
                              gap: 7,
                              minHeight: 40,
                            }}
                          >
                            {/* Line 1: icon + label · time · chevron */}
                            <span style={{ display: "flex", alignItems: "center", gap: 9, width: "100%" }}>
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: "50%",
                                  background: ev.bg,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ev.color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                  <path d={ev.iconPath} />
                                </svg>
                              </span>
                              <EventBadge entry={c} />
                              <span className="mono faint" style={{ marginLeft: "auto", fontSize: 11.5, flexShrink: 0 }}>
                                {c.ts}
                              </span>
                              <svg
                                width="16" height="16" viewBox="0 0 24 24" fill="none"
                                stroke="var(--ink-faint)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                                style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms", flexShrink: 0 }}
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </span>

                            {/* Line 2: PO mono */}
                            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-blue-deep)", paddingLeft: 35 }}>
                              {c.po}
                            </span>

                            {/* Line 3: buyer → supplier (wraps) */}
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                flexWrap: "wrap",
                                gap: 6,
                                fontSize: 13,
                                paddingLeft: 35,
                              }}
                            >
                              <span style={{ color: "var(--brand-blue-deep)" }}>{c.buyer}</span>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <path d="M5 12h14M12 5l7 7-7 7" />
                              </svg>
                              <span style={{ color: "var(--brand-green-deep)" }}>{c.supplier}</span>
                            </span>

                            {/* Line 4: actor */}
                            <span className="faint" style={{ fontSize: 12, paddingLeft: 35 }}>
                              {c.actor.name}
                            </span>
                          </button>
                        ) : (
                        <button
                          onClick={() => setOpenId(open ? null : c.id)}
                          className="row gap-3 items-center"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: open ? "var(--surface-2)" : "none",
                            border: "none",
                            // TRUE 44px single-line row (v2 unified list height);
                            // the 26px icon circle centres inside it.
                            height: 44,
                            padding: "0 16px",
                            transition: "background var(--duration-fast)",
                            cursor: "pointer",
                          }}
                        >
                          {/* Time — tabular figures so timestamps stay column-aligned */}
                          <span className="mono faint" style={{ fontSize: 11.5, width: 64, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                            {c.ts}
                          </span>

                          {/* Event icon circle */}
                          <span
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: ev.bg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ev.color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                              <path d={ev.iconPath} />
                            </svg>
                          </span>

                          {/* Event pill — one shape per row. Wider than the old 92px
                              because the label now names the actual event rather
                              than a six-word bucket. */}
                          <span style={{ width: 150, flexShrink: 0, display: "inline-flex", minWidth: 0 }}>
                            <EventBadge entry={c} />
                          </span>

                          {/* PO mono */}
                          <span
                            className="mono"
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              width: 150,
                              flexShrink: 0,
                              color: "var(--brand-blue-deep)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.po}
                          </span>

                          {/* Buyer → supplier */}
                          <span
                            className="grow row gap-2 items-center"
                            style={{ fontSize: 12, color: "var(--ink-muted)", minWidth: 0, overflow: "hidden" }}
                          >
                            <span
                              style={{
                                color: "var(--brand-blue-deep)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.buyer}
                            </span>
                            {/* arrow right */}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                            <span
                              style={{
                                color: "var(--brand-green-deep)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.supplier}
                            </span>
                          </span>

                          {/* Actor */}
                          <span
                            className="faint"
                            style={{
                              fontSize: 11.5,
                              width: 110,
                              flexShrink: 0,
                              textAlign: "right",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={c.actor.name}
                          >
                            {c.actor.name}
                          </span>

                          {/* Chevron */}
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--ink-faint)"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              transform: open ? "rotate(180deg)" : "none",
                              transition: "transform 200ms",
                              flexShrink: 0,
                            }}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        )}

                        {/* Expanded panel — canonical CrossingRow detail.
                            Desktop indents the detail card under the content columns (106px);
                            mobile uses full width. */}
                        {open && (
                          <div
                            style={{
                              padding: isMobile ? "4px 14px 14px" : "4px 16px 16px 106px",
                              background: "var(--surface-2)",
                            }}
                          >
                            <div className="card" style={{ padding: "12px 14px", background: "var(--surface)" }}>
                              {/* Structured detail grid — mirrors c.detail key/value grid in design */}
                              {hasDetails && (
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: isMobile
                                      ? "repeat(auto-fill, minmax(120px, 1fr))"
                                      : "repeat(auto-fill, minmax(150px, 1fr))",
                                    gap: "10px 20px",
                                  }}
                                >
                                  {Object.entries(c.details!).map(([k, v]) => (
                                    <div key={k}>
                                      <div className="eyebrow" style={{ fontSize: 9, marginBottom: 2 }}>
                                        {k.replace(/([A-Z])/g, " $1")}
                                      </div>
                                      <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{String(v)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Free-text detail fallback (API path / entries without a grid) */}
                              {!hasDetails && hasText && (
                                <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6, margin: 0 }}>
                                  {c.detail}
                                </p>
                              )}

                              {/* The reason the backend already sent.
                                  Rendered ONLY when `auditEventReason` found one — an
                                  action with no reason key, an absent payload, or a body
                                  that sanitises to nothing all render nothing here rather
                                  than a sentence this screen made up.
                                  Red for a failure, amber for a held/other event, matching
                                  the row's own badge tone. No "auto-retry scheduled" suffix:
                                  that is the mock banner's claim below and nothing in the
                                  payload substantiates it. */}
                              {c.reason && (
                                <div
                                  data-testid="audit-reason"
                                  data-event-kind={c.canonicalEvent}
                                  // The tone, on the element that wears it. Both colours
                                  // are CSS custom properties and jsdom does not resolve
                                  // those, so without this a guard can only assert that a
                                  // reason rendered, not that a paused order was spared
                                  // being painted as a break. Same seam, same reason, as
                                  // the badge's `data-event-kind`.
                                  data-tone={c.canonicalEvent === "failed" ? "danger" : "amber"}
                                  style={{
                                    // First thing in the card on the live path, where the
                                    // grid and free-text blocks above are never populated.
                                    marginTop: hasDetails || hasText ? 10 : 0,
                                    display: "flex",
                                    // Top-aligned, not centred: the reason is up to
                                    // SUPPLIER_REASON_MAX characters and wraps to several
                                    // lines at 390px, and a centred icon would drift to the
                                    // middle of the paragraph.
                                    alignItems: "flex-start",
                                    gap: 8,
                                    padding: "8px 11px",
                                    background:
                                      c.canonicalEvent === "failed" ? "var(--danger-soft)" : "var(--amber-soft)",
                                    borderRadius: "var(--radius)",
                                    fontSize: 11.5,
                                    lineHeight: 1.55,
                                    color: c.canonicalEvent === "failed" ? "var(--danger)" : "var(--amber-text)",
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                                  </svg>
                                  {/* `minWidth: 0` + `overflowWrap: anywhere` are what keep
                                      the 390px card intact. A flex child defaults to
                                      min-content width, so without the first a long reason
                                      pushes the card wider than the viewport; without the
                                      second an unbroken run — a URL, a stack frame, a
                                      supplier's id blob — does the same. It wraps rather
                                      than truncating: the string is already clamped to a
                                      readable ceiling upstream, and cutting it again here
                                      would remove the half that says what to do. */}
                                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.reason}</span>
                                </div>
                              )}

                              {/* Error banner — amber when recoverable, red otherwise (design parity) */}
                              {c.error && (
                                <div
                                  className="row gap-2 items-center"
                                  style={{
                                    marginTop: 10,
                                    padding: "8px 11px",
                                    background: c.recoverable ? "var(--amber-soft)" : "var(--danger-soft)",
                                    borderRadius: "var(--radius)",
                                    fontSize: 11.5,
                                    color: c.recoverable ? "var(--amber-text)" : "var(--danger)",
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" /><path d="M12 9v4" /><path d="M12 17h.01" />
                                  </svg>
                                  <span>{c.error}{c.recoverable ? " · auto-retry scheduled" : ""}</span>
                                </div>
                              )}

                              {/* Field-diff table (mapping / validation entries) */}
                              {hasDiff && (
                                <div style={{ marginTop: hasDetails || hasText || c.reason || c.error ? 12 : 0 }}>
                                  <div className="eyebrow" style={{ fontSize: 9, marginBottom: 6 }}>Field changes</div>
                                  <div
                                    className="mono"
                                    style={{
                                      borderRadius: "var(--radius)",
                                      border: "1px solid var(--border)",
                                      overflow: "hidden",
                                      fontSize: 11.5,
                                    }}
                                  >
                                    {c.diff!.map((d, i) => (
                                      <div
                                        key={i}
                                        style={{
                                          display: "flex",
                                          alignItems: isMobile ? "flex-start" : "center",
                                          flexWrap: isMobile ? "wrap" : "nowrap",
                                          gap: isMobile ? "2px 8px" : 12,
                                          padding: "8px 11px",
                                          background: i % 2 === 0 ? "var(--surface)" : "var(--surface-2)",
                                          borderBottom: i < c.diff!.length - 1 ? "1px solid var(--border)" : "none",
                                        }}
                                      >
                                        <span style={{ color: "var(--brand-blue-deep)", minWidth: isMobile ? "100%" : 200, wordBreak: "break-all" }}>
                                          {d.field}
                                        </span>
                                        <span style={{ color: "var(--danger)", wordBreak: "break-all" }}>{d.from}</span>
                                        <span style={{ color: "var(--border-strong)" }}>→</span>
                                        <span style={{ color: "var(--brand-green-deep)", wordBreak: "break-all" }}>{d.to}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Action buttons — canonical: View order / Retry delivery / Export entry */}
                              <div className="row gap-2 wrap" style={{ marginTop: 11 }}>
                                {/* View order — secondary, navigates to /inbox/{id} */}
                                <button
                                  className="btn btn-secondary sm"
                                  onClick={() => router.push(`/inbox/${c.crossingId}`)}
                                  style={isMobile ? { height: 36 } : undefined}
                                >
                                  {/* eye icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                                  </svg>
                                  View order
                                </button>

                                {/* Open to resend — secondary, only for failed events. There is no
                                    retry-from-here API; this navigates to the order, where the resend
                                    action lives. Labelled honestly so it doesn't promise a retry it
                                    can't perform (audit: dead "Retry delivery" control). */}
                                {/* Gated on the manifest-derived kind, not the mock-only
                                    `event` field it used to read. `event` is never set on
                                    the live path, so this control could not render for a
                                    real failure at all — the screen's one recovery
                                    affordance was missing from exactly the rows that
                                    needed it. */}
                                {c.canonicalEvent === "failed" && (
                                  <button
                                    className="btn btn-secondary sm"
                                    onClick={() => router.push(`/inbox/${c.crossingId}`)}
                                    style={isMobile ? { height: 36 } : undefined}
                                  >
                                    {/* refresh icon */}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
                                    </svg>
                                    Open to resend
                                  </button>
                                )}

                                {/* Export entry — ghost */}
                                <button
                                  className="btn btn-ghost sm"
                                  onClick={() => {
                                    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                                    const row = [c.ts, entryLabel(c), c.po, c.buyer, c.supplier, c.fmt, c.actor.name, c.message].map(esc).join(",");
                                    const csv = [`"Timestamp","Event","PO","Buyer","Supplier","Format","Actor","Message"`, row].join("\r\n");
                                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `delivery-${c.po}-${c.ts.replace(/:/g, "-")}.csv`;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                  }}
                                  style={isMobile ? { height: 36 } : undefined}
                                >
                                  {/* download icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                                  </svg>
                                  Export entry
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            </>
          )}

          {/* Pager.
              Rendered OUTSIDE the empty/non-empty branch on purpose: when the chips
              or the search box zero out the current page, paging is the only way to
              reach the entries that do match, so the control an operator needs most
              must not disappear with the rows. */}
          {showPager && (
            <nav
              aria-label="Delivery log pages"
              className="row between items-center wrap"
              style={{
                gap: 10,
                marginTop: 4,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "stretch" : "center",
              }}
            >
              {/* Deliberately NOT role="status": the order-filter strip above already
                  owns that role on this page, and a second one makes
                  getByRole("status") ambiguous for anything reading the page. */}
              <p
                style={{ margin: 0, fontSize: 12, color: "var(--ink-muted)", textAlign: isMobile ? "center" : "left" }}
              >
                {loadedCount === 0
                  ? `Page ${page} of ${pageCount} · no entries here`
                  : `Showing ${firstIndex}–${lastIndex} of ${totalEntries} · page ${page} of ${pageCount}`}
              </p>
              <div className="row gap-2 items-center" style={{ flexShrink: 0 }}>
                <button
                  className="btn btn-secondary sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                  style={isMobile ? { height: 36, flex: 1 } : undefined}
                  aria-label="Newer entries"
                >
                  Newer
                </button>
                <button
                  className="btn btn-secondary sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount || isFetching}
                  style={isMobile ? { height: 36, flex: 1 } : undefined}
                  aria-label="Older entries"
                >
                  Older
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </PageShell>
  );
}
