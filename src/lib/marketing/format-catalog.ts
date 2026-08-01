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
// against the backend DI registrations) via `standardRow()`, so the marketing
// surface can never over-claim relative to what the engine actually does. The
// EDIFACT rows in particular resolve to `configurable`/`onRequest`, never `live`.
//
// That paragraph was true of IMPORT_FORMATS and false of everything else, which is
// how "UBL 2.1 / Peppol BIS" shipped a green "Supported" badge on /formats while
// the catalog said Peppol BIS was `partial`. Two independent holes, both closed
// below: OUTPUT_FORMATS hand-typed its statuses (nothing read the catalog's
// `transform` level at all), and a row's NAME was never checked against the id it
// derived from. See `standardRow`.
// ─────────────────────────────────────────────────────────────────────────────

import { STANDARDS, type SupportLevel } from "@/lib/standards/catalog";

// Honest by design: nothing is "live" (badge "Supported") unless it works in
// production today.
export type StatusKey = "live" | "configurable" | "onRequest" | "planned";

export interface FormatRow {
  name: string;
  status: StatusKey;
  note: string;
  /**
   * Set only by `standardRow()` — the standards-catalog entry this row's badge is
   * derived from. Its absence on a row that names a document standard is itself the
   * defect (a hand-typed status), which is what `format-catalog.test.ts` asserts.
   */
  catalogId?: string;
}

// ── Catalog-derived statuses (anti-drift) ──────────────────────────────────────
// For document standards that exist in the standards catalog, the badge is
// DERIVED from the catalog so this marketing surface can never silently
// over-claim — the EDIFACT row used to say "Supported" while the catalog said
// `parse: "partial"`.
//
// Direction matters and used to be conflated. `parse` answers "can we read this
// file", `transform` answers "can we produce it". A standard can be `supported`
// inbound and `planned` outbound (EDIFACT), or the reverse, so an outbound row
// derived from `parse` is not derived from anything meaningful.
const PARSE_LEVEL_STATUS: Record<SupportLevel, StatusKey> = {
  supported: "live",
  partial: "configurable", // works today with caveats — we verify it with you in setup
  planned: "planned",
  none: "planned",
};

const TRANSFORM_LEVEL_STATUS: Record<SupportLevel, StatusKey> = {
  supported: "live",
  partial: "configurable",
  planned: "onRequest", // no transformer today; we build it with you on request
  none: "planned", // input-only standard — it must not be sold as an output format
};

function directionStatus(catalogId: string, direction: "parse" | "transform"): StatusKey {
  const entry = STANDARDS.find((s) => s.id === catalogId);
  // Fail the static build loudly on a typo'd id rather than render a wrong badge.
  if (!entry) throw new Error(`format-catalog: unknown standards catalog id '${catalogId}'`);
  return direction === "parse"
    ? PARSE_LEVEL_STATUS[entry.parse]
    : TRANSFORM_LEVEL_STATUS[entry.transform];
}

/** Resolve a standards-catalog id to its INBOUND marketing badge status via `parse`. */
export function parseStatus(catalogId: string): StatusKey {
  return directionStatus(catalogId, "parse");
}

/** Resolve a standards-catalog id to its OUTBOUND marketing badge status via `transform`. */
export function transformStatus(catalogId: string): StatusKey {
  return directionStatus(catalogId, "transform");
}

/**
 * Words that NAME a document standard, and the catalog id each one belongs to.
 *
 * A row may only use one of these words if it derives its badge from that word's own
 * catalog entry. This is the half of the anti-drift contract that was missing:
 * `parseStatus()` has always failed the build on an id that does not EXIST, but
 * nothing checked that the id a row cites is the id the row's name SELLS. Both
 * Peppol rows lived in exactly that gap —
 *
 *     { name: "UBL 2.1 / Peppol BIS", status: parseStatus("ubl-2-1-order"), … }  // valid id, other standard
 *     { name: "UBL 2.1 / Peppol BIS", status: "live", … }                        // no id at all
 *
 * — so /formats badged Peppol BIS "Supported" from UBL's `parse: supported`, while
 * the Peppol entry three lines away in the catalog said `partial`, and the honest
 * value was never rendered anywhere.
 *
 * "Peppol" ALONE is deliberately not on this list. The Peppol *network* is a real
 * transport we reach through a certified access-point partner, and IMPORT_METHODS /
 * DELIVERY_METHODS say so honestly as `onRequest`. "Peppol BIS" is the document
 * *profile*, and that is the claim nothing in either repo can back.
 */
export const STANDARD_NAME_TOKENS: ReadonlyArray<{ token: RegExp; catalogId: string }> = [
  { token: /\bpeppol[\s/]+bis\b/i, catalogId: "peppol-bis-order-3" },
  { token: /\bubl\b/i, catalogId: "ubl-2-1-order" },
  { token: /\bcxml\b/i, catalogId: "cxml-1-2" },
  { token: /\bidoc\b/i, catalogId: "sap-idoc-orders05" },
  { token: /\bedifact\b/i, catalogId: "edifact-orders" },
  { token: /\bx12\b/i, catalogId: "x12-850" },
];

/**
 * Build a marketing row whose badge comes from the standards catalog AND whose name is
 * checked against the id it cites.
 *
 * Throws at module load. /formats and the landing hero both import this module and are
 * statically rendered, so a row that sells a standard it does not measure fails
 * `bun run build` rather than waiting for someone to notice on the live page.
 */
export function standardRow(
  catalogId: string,
  direction: "parse" | "transform",
  name: string,
  note: string,
): FormatRow {
  // Resolve first: a typo'd id must be reported as a typo, not as a name mismatch against
  // whatever standard the row happens to be named after.
  const status = directionStatus(catalogId, direction);

  for (const { token, catalogId: owner } of STANDARD_NAME_TOKENS) {
    if (token.test(name) && owner !== catalogId) {
      throw new Error(
        `format-catalog: the row "${name}" names the '${owner}' standard but takes its badge from ` +
          `'${catalogId}'. Derive it from '${owner}', or take that standard out of the name — a row ` +
          `must not sell what it does not measure.`,
      );
    }
  }
  return { name, status, note, catalogId };
}

// ── How orders reach ProcuLink (transport methods, not formats) ─────────────────
export const IMPORT_METHODS: FormatRow[] = [
  { name: "Manual upload (drag-and-drop / browse)", status: "live", note: "Drop a file straight into the app." },
  { name: "REST API", status: "live", note: "POST orders as JSON with an API key — Zapier, Make, or your own code." },
  // The plan named here must be the plan the backend actually gates on. These three said
  // "Integration plan" (€999) while EmailIngestion / SftpIngestion / S3Ingestion have gated at
  // Growth (€149) ever since the channels were decoupled from volume — the same defect WP-11 fixed
  // in the 403 codes, surviving on the public page a buyer reads before they ever see a 403.
  // Source of truth: PlanConstants.MinimumPlan (backend) mirrored by PLANS in src/lib/plans.ts.
  { name: "Email inbox polling (IMAP)", status: "live", note: "We poll your mailbox for order attachments. Growth plan and up." },
  { name: "SFTP folder pull", status: "live", note: "Point us at an SFTP folder; we import new files. Growth plan and up." },
  { name: "S3 / R2 bucket pull", status: "live", note: "Watch a bucket prefix for order files. Growth plan and up." },
  { name: "Hosted inbound email address", status: "configurable", note: "Forward orders to your orders@… address; we set up the receiving domain." },
  { name: "AS2 / PEPPOL network receive", status: "onRequest", note: "Through a certified access-point partner." },
];

// ── Formats an INCOMING order file can be (the "inbound formats" count) ─────────
export const IMPORT_FORMATS: FormatRow[] = [
  { name: "CSV", status: "live", note: "Delimiters and common column aliases auto-detected." },
  { name: "Excel (XLSX)", status: "live", note: "First worksheet, header row." },
  { name: "PDF (text-based)", status: "live", note: "Text layer read, then AI structured extraction. Deterministic fallback when no AI key." },
  { name: "PDF (scanned / image)", status: "live", note: "No text layer — read by AI vision extraction. Assisted: every line is flagged for review." },
  standardRow("cxml-1-2", "parse", "cXML 1.2", "OrderRequest documents."),
  // Named for the document it actually is. Orders sent over the Peppol network use this
  // same UBL 2.1 Order document, so they parse here too — inbound is the direction where
  // that is true, and the row says so without selling a profile we do not validate.
  standardRow("ubl-2-1-order", "parse", "UBL 2.1 Order", "Order documents. Orders sent over the Peppol network use this same UBL 2.1 document, so they parse here too."),
  standardRow("sap-idoc-orders05", "parse", "SAP IDoc ORDERS05", "SAP's ORDERS05 purchase-order IDoc, sent as XML."),
  standardRow("edifact-orders", "parse", "EDIFACT ORDERS", "D96A — core segment coverage today; we verify your message files with you during setup."),
  standardRow("x12-850", "parse", "ANSI X12 850", "004010 / 005010."),
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
// Document standards derive from the catalog's `transform` level, so EDIFACT resolves
// to "onRequest" (no outbound transformer) without anyone having to remember to type it.
// CSV / XML / JSON have no standards-catalog entry to derive from and stay explicit.
export const OUTPUT_FORMATS: FormatRow[] = [
  { name: "CSV", status: "live", note: "Configurable columns." },
  { name: "XML (generic)", status: "live", note: "" },
  standardRow("cxml-1-2", "transform", "cXML 1.2", ""),
  // Was "UBL 2.1 / Peppol BIS", status hand-typed "live" — the single strongest Peppol
  // claim on the site, and the row that made /formats contradict the standards catalog.
  // We really do emit the OASIS UBL 2.1 Order document, so the row stays and the badge
  // is honestly "Supported"; what goes is the profile name we cannot substantiate.
  standardRow(
    "ubl-2-1-order",
    "transform",
    "UBL 2.1 Order",
    "The OASIS UBL 2.1 Order document. Not validated against Peppol BIS 3 business rules — check it with your access point before relying on it.",
  ),
  standardRow("x12-850", "transform", "ANSI X12 850", ""),
  { name: "JSON", status: "live", note: "" },
  standardRow("edifact-orders", "transform", "EDIFACT ORDERS", "Outbound EDIFACT transformer on request."),
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
