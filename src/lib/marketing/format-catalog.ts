// ─────────────────────────────────────────────────────────────────────────────
// Marketing format catalog — the single source of truth for WHICH import
// formats, delivery channels, and output formats ProcuLink advertises, and at
// what honesty level.
//
// Both the /formats page (the full honest table) AND the landing-page hero stats
// ("10 inbound formats / 6 outbound / 6 delivery channels") derive from THIS
// module, so the headline numbers can never silently drift from the table again.
//
// Document-standard rows (cXML, UBL, IDoc, EDIFACT, X12) take their status from
// src/lib/standards/catalog.ts (the conservative offer⇔works source reconciled
// against the backend DI registrations) via `parseStatus()`, so the marketing
// surface can never over-claim relative to what the engine actually does. The
// EDIFACT rows in particular resolve to `configurable`/`onRequest`, never `live`.
// ─────────────────────────────────────────────────────────────────────────────

import { STANDARDS, type SupportLevel } from "@/lib/standards/catalog";

// Honest by design: nothing is "live" (badge "Supported") unless it works in
// production today.
export type StatusKey = "live" | "configurable" | "onRequest" | "planned";

export interface FormatRow {
  name: string;
  status: StatusKey;
  note: string;
}

// ── Catalog-derived statuses (anti-drift) ──────────────────────────────────────
// For document standards that exist in the standards catalog, the badge is
// DERIVED from the catalog's `parse` level so this marketing surface can never
// silently over-claim — the EDIFACT row used to say "Supported" while the
// catalog said `parse: "partial"`.
const PARSE_LEVEL_STATUS: Record<SupportLevel, StatusKey> = {
  supported: "live",
  partial: "configurable", // works today with caveats — we verify it with you in setup
  planned: "planned",
  none: "planned",
};

/** Resolve a standards-catalog id to its marketing badge status via `parse`. */
export function parseStatus(catalogId: string): StatusKey {
  const entry = STANDARDS.find((s) => s.id === catalogId);
  // Fail the static build loudly on a typo'd id rather than render a wrong badge.
  if (!entry) throw new Error(`format-catalog: unknown standards catalog id '${catalogId}'`);
  return PARSE_LEVEL_STATUS[entry.parse];
}

// ── How orders reach ProcuLink (transport methods, not formats) ─────────────────
export const IMPORT_METHODS: FormatRow[] = [
  { name: "Manual upload (drag-and-drop / browse)", status: "live", note: "Drop a file straight into the app." },
  { name: "REST API", status: "live", note: "POST orders as JSON with an API key — Zapier, Make, or your own code." },
  { name: "Email inbox polling (IMAP)", status: "live", note: "We poll your mailbox for order attachments. Integration plan." },
  { name: "SFTP folder pull", status: "live", note: "Point us at an SFTP folder; we import new files. Integration plan." },
  { name: "S3 / R2 bucket pull", status: "live", note: "Watch a bucket prefix for order files. Integration plan." },
  { name: "Hosted inbound email address", status: "configurable", note: "Forward orders to your orders@… address; we set up the receiving domain." },
  { name: "AS2 / PEPPOL network receive", status: "onRequest", note: "Through a certified access-point partner." },
];

// ── Formats an INCOMING order file can be (the "inbound formats" count) ─────────
export const IMPORT_FORMATS: FormatRow[] = [
  { name: "CSV", status: "live", note: "Delimiters and common column aliases auto-detected." },
  { name: "Excel (XLSX)", status: "live", note: "First worksheet, header row." },
  { name: "PDF (text-based)", status: "live", note: "Text layer read, then AI structured extraction. Deterministic fallback when no AI key." },
  { name: "PDF (scanned / image)", status: "live", note: "No text layer — read by AI vision extraction. Assisted: every line is flagged for review." },
  { name: "cXML 1.2", status: parseStatus("cxml-1-2"), note: "OrderRequest documents." },
  { name: "UBL 2.1 / Peppol BIS", status: parseStatus("ubl-2-1-order"), note: "Order documents." },
  { name: "SAP IDoc ORDERS05", status: parseStatus("sap-idoc-orders05"), note: "SAP's ORDERS05 purchase-order IDoc, sent as XML." },
  { name: "EDIFACT ORDERS", status: parseStatus("edifact-orders"), note: "D96A — core segment coverage today; we verify your message files with you during setup." },
  { name: "ANSI X12 850", status: parseStatus("x12-850"), note: "004010 / 005010." },
  { name: "JSON", status: "live", note: "Via the REST API order shape." },
];

// ── How the finished order reaches each supplier (the "delivery channels" count) ─
export const DELIVERY_METHODS: FormatRow[] = [
  { name: "HTTPS webhook (POST / PUT)", status: "live", note: "Auth: API key, bearer, basic, or OAuth2 fetch-token." },
  { name: "SFTP", status: "configurable", note: "Password or private-key. Configure it yourself; we verify it with you on a real folder before go-live." },
  { name: "FTPS", status: "configurable", note: "Explicit TLS. Configure it yourself; we verify it with you on a real folder before go-live." },
  { name: "Email (attachment)", status: "live", note: "The order is emailed as an attachment to the recipient addresses you enter — sent from ProcuLink over HTTPS. No mail server or credentials to set up." },
  { name: "Erply (ERP connector)", status: "configurable", note: "We switch it on with you against your Erply account before go-live." },
  { name: "Directo (ERP connector)", status: "configurable", note: "We switch it on with you against your Directo account before go-live." },
  { name: "More ERP connectors", status: "onRequest", note: "Fortnox, Visma, e-conomic, Dynamics 365 BC, NetSuite, SAP…" },
  { name: "AS2 / AS4 / PEPPOL access point", status: "onRequest", note: "Through a certified partner." },
];

// ── Formats we PRODUCE per supplier (the "outbound formats" count) ──────────────
// EDIFACT output is deliberately "onRequest" (no outbound transformer yet), so it
// must NOT be counted among the live outbound formats.
export const OUTPUT_FORMATS: FormatRow[] = [
  { name: "CSV", status: "live", note: "Configurable columns." },
  { name: "XML (generic)", status: "live", note: "" },
  { name: "cXML 1.2", status: "live", note: "" },
  { name: "UBL 2.1 / Peppol BIS", status: "live", note: "" },
  { name: "ANSI X12 850", status: "live", note: "" },
  { name: "JSON", status: "live", note: "" },
  { name: "EDIFACT ORDERS", status: "onRequest", note: "Outbound EDIFACT transformer on request." },
];

// ── Derived counts for the landing hero stats (anti-drift) ──────────────────────
// Inbound  = every import FORMAT we can actually take today (live + configurable).
// Outbound = output formats that are LIVE (EDIFACT onRequest is excluded).
// Channels = delivery methods that work today (live + configurable).
const isAvailableNow = (r: FormatRow) => r.status === "live" || r.status === "configurable";

/** Count of inbound formats we accept today (live + configurable). */
export const INBOUND_FORMAT_COUNT = IMPORT_FORMATS.filter(isAvailableNow).length;
/** Count of outbound formats we emit live today (excludes onRequest EDIFACT). */
export const OUTBOUND_FORMAT_COUNT = OUTPUT_FORMATS.filter((r) => r.status === "live").length;
/** Count of delivery channels available today (live + configurable). */
export const DELIVERY_CHANNEL_COUNT = DELIVERY_METHODS.filter(isAvailableNow).length;
