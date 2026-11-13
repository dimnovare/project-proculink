// ── Order direction (per-org presentation setting) ──────────────────────────
// ProcuLink's built-in model is OUTBOUND (the org is the BUYER sending POs out
// to suppliers). Inbound orgs are the SUPPLIER receiving customer POs. The data
// model is direction-agnostic — this setting only changes DISPLAY labels.
// API contract is PascalCase ("Outbound" | "Inbound"); we normalise to lowercase
// internally (see api-client getOrgSettings/updateOrgSettings).
export type OrderDirection = "outbound" | "inbound";

export interface OrgSettings {
  direction: OrderDirection;
  /**
   * Org slug used to build the inbound ingress endpoint
   * (`{API_BASE}/api/ingress/<slug>/orders`). Optional because the backend
   * org-settings response may not include it yet (older API / mid-rollout);
   * the UI shows "generating…" when absent.
   */
  slug?: string;
  /** Supplier row every invoice is sent to; null = not set (invoices wait in Documents). */
  invoiceDestinationSupplierId?: string | null;
}

export type OrderStatus =
  | "parsing"
  // Extracted, but no supplier could be resolved, so the order is parked awaiting one.
  // NOT a failure and NOT idle: it is a user-action backlog — assigning a supplier
  // re-enters the parse flow (POST /orders/{id}/assign-supplier). Reachable on the LIVE
  // parse path today (OrderIngestionService: `if (entity.SupplierId is null) newStatus =
  // Unrouted`), and via SFTP/S3/IMAP ingress when an org's default supplier is unset or
  // soft-deleted — those channels import unrouted rather than blocking the poll.
  // NB: OrderStatusConstants' doc-comment claims "No order reaches this state until the
  // content-routing ingest paths are wired (Phase 1)". That is STALE — Phase 1/1b
  // shipped, and the ingress code says so in its own comments. Trust the producers.
  | "unrouted"
  | "pending_review"
  | "ready"
  | "transforming"
  | "ready_to_deliver"
  // The Worker's atomic delivery claim owns this status: it flips the row here the
  // moment it picks a dispatch up, and settles it to delivered / delivery_failed
  // when the attempt finishes. Short-lived (seconds) but real, persisted, and
  // observable — a claim whose process dies leaves the row here until the backend's
  // 2-minute reclaim window makes it claimable again. It was missing from this union
  // even though the API has always been able to return it, so every `status ===
  // "delivering"` branch the UI needed was a type error nobody could write.
  | "delivering"
  | "delivered"
  // Delivery paused because the plan can't process orders right now (billing).
  // Not a failure: the supplier file is intact, and the backend releases the order
  // back to ready_to_deliver automatically once billing is in good standing.
  | "delivery_held"
  // Sent, but a crash lost the outcome on a channel that can't tell us whether it arrived.
  // Waits for a human: send again, or mark delivered.
  | "delivery_unconfirmed"
  | "failed"
  | "transform_failed"
  | "delivery_failed"
  | "delivery_dead_letter"
  | "rejected_by_supplier";

export interface OrderLine {
  id: string;
  lineNumber: number;
  buyerItemCode: string;
  supplierItemCode?: string | null;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  confidence: number;
  needsReview: boolean;
  /** Phase 4 enrichment — stated line amount as extracted from the source document. */
  lineAmount?: number | null;
  /** Phase 4 enrichment — per-line tax/VAT rate as a percentage. */
  taxRate?: number | null;
  /** Phase 4 enrichment — per-line delivery date, ISO "yyyy-MM-dd". */
  deliveryDate?: string | null;
}

export interface Artifact {
  id: string;
  format: string;
  fileKey: string;
  createdAt: string;
}

export interface Order {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  /** Buyer name extracted from canonical JSON after parsing; null while parsing. */
  buyerName?: string | null;
  orderDate: string; // "yyyy-MM-dd"
  currency: string;
  status: OrderStatus;
  sourceFileKey?: string | null;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  artifacts: Artifact[];
  /** True when this order was created by the onboarding sample-order endpoint. */
  isSample?: boolean;
  /** Held for review: never auto-delivered; an explicit Send still works. */
  holdForReview?: boolean;
  // ── Phase 4 enrichment (header) ───────────────────────────────────────────
  /** Extracted document subtotal (before tax); null when not captured. */
  subTotal?: number | null;
  /** Extracted total tax/VAT amount; null when not captured. */
  taxTotal?: number | null;
  /** Extracted document grand total; prefer this over any client-computed total. */
  grandTotal?: number | null;
  /** Extracted payment terms as printed (e.g. "Net 30"); null when not captured. */
  paymentTerms?: string | null;
  /** Detected document type: "purchase_order" | "invoice" | "other" | null. */
  documentType?: string | null;
  /** Supplier name AS PRINTED ON THE DOCUMENT (extracted) — NOT the resolved supplier. */
  documentSupplierName?: string | null;
  // ── Auto-filled address / contact (structured-format writers emit these) ────
  // For structured formats (cXML / X12 / UBL) the backend writer fills the
  // address + contact blocks automatically from the order's canonical fields.
  // They appear in the live preview but are NOT editable in the mapper, so we
  // surface them READ-ONLY in "What we'll send" so the user can verify them.
  // ALL optional + `string | null` — the backend that supplies them may not be
  // deployed yet; consumers MUST optional-chain and render nothing when absent.
  /** Ship-to party name. */
  shipToName?: string | null;
  shipToStreet?: string | null;
  shipToCity?: string | null;
  shipToPostalCode?: string | null;
  shipToCountry?: string | null;
  /** Free-text "deliver to" / attention line for each party. */
  shipToDeliverTo?: string | null;
  /** Bill-to party name. */
  billToName?: string | null;
  billToDeliverTo?: string | null;
  billToStreet?: string | null;
  billToCity?: string | null;
  billToPostalCode?: string | null;
  billToCountry?: string | null;
  /** Primary contact for the order. */
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Buyer tax / VAT registration id. */
  buyerTaxId?: string | null;
  /** Invoice fields (ISO "yyyy-MM-dd" for dueDate); null/absent on a purchase order. */
  dueDate?: string | null;
  sellerTaxId?: string | null;
  paymentIban?: string | null;
  paymentReference?: string | null;
}

export interface OrderSummary {
  id: string;
  poNumber: string;
  supplierName: string;
  buyerName?: string | null;
  orderDate: string;
  status: OrderStatus;
  lineCount: number;
  unresolvedCount: number;
  totalValue?: number;
  currency?: string;
  sourceFormat?: string | null;
  /** "purchase_order" | "invoice" | "other" | null. */
  documentType?: string | null;
  createdAt: string;
  /**
   * True when this row is a practice order (backend `PurchaseOrder.IsSample`).
   *
   * The list RETURNS practice orders — the product routes a first-run user to one to
   * rehearse review, and `OnboardingStatus.sampleOrderId` exists to route them back — but
   * every metered number excludes them: billing, the overage actually invoiced, and every
   * plan gate. So a row that carries this flag is shown and not counted, and the screen has
   * to say so rather than leaving a "0" beside a visible row. See `meteredTotal` in
   * `src/components/bridge/orderCountContract.ts`.
   *
   * Optional for the same reason `Order.isSample` is: the frontend (Vercel) and the API
   * (Railway) deploy independently, and an API older than dimnovare/ProcuLink#173 sends no
   * such field. Absent means "not known to be practice", which degrades to exactly today's
   * behaviour — never to a fabricated practice badge.
   */
  isSample?: boolean;
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}

// ── Billing ────────────────────────────────────────────────────────────────

export type BillingPlan =
  | "pilot"
  | "growth"
  | "operations"
  | "integration"
  | "distributor"
  | "enterprise"
  // The document ladder (plan 11), sold to workspaces with the document engine.
  | "starter"
  | "pro"
  | "business"
  | "scale";

export interface BillingStatus {
  plan:                   BillingPlan;
  accountStatus:          string;
  ordersThisMonth:        number;
  /** EFFECTIVE order limit = admin override ?? plan default. */
  orderLimit:             number;
  suppliersUsed:          number;
  /** EFFECTIVE supplier limit = admin override ?? plan default. */
  supplierLimit:          number;
  trialStartedAt:         string | null;
  trialEndsAt:            string | null;
  isTrialExpired:         boolean;
  isOrderLimitReached:    boolean;
  isSupplierLimitReached: boolean;
  /** TRUE for active paid plans even over the cap — paid orders are never blocked. */
  canProcessOrders:       boolean;
  canAddSupplier:         boolean;
  stripeCustomerId:       string | null;
  stripeSubscriptionId:   string | null;
  // ── Overage (paid plans bill extra orders at €0.50 each; never blocked) ─────
  /** Orders processed beyond the monthly cap this period (0 when within cap). */
  overageOrders:          number;
  /** EUR billed for those overage orders this period (overageOrders × €0.50). */
  overageAmountEur:       number;
  /** True at ≥80% of the order limit (gentle "approaching" heads-up). */
  nearLimit:              boolean;
  /** True at ≥100% of the order limit (over-cap overage messaging). */
  atLimit:                boolean;
  /**
   * Payment interval of the active Stripe subscription, derived server-side
   * from the persisted price id: "yearly" when it matches a `*YearlyPriceId`,
   * "monthly" otherwise, null when no Stripe subscription is on file (Pilot /
   * manual Enterprise). Informational only — the order quota stays a
   * calendar-month allowance regardless. Optional so older fixtures/responses
   * that omit it stay valid (treat absent as null → hide the interval line).
   */
  billingInterval?:       "monthly" | "yearly" | null;
}

// ── Admin: per-org limit / pilot overrides ──────────────────────────────────
// POST /api/admin/organisations/{id}/limits  (behind [AdminOnly]; 403 for non-admins).
// Every override is independent and optional; the matching clear* flag resets a
// field back to its plan default. extendTrialDays adds days to the current trial
// end; trialEndsAtOverride sets an absolute end date (ISO 8601).

export interface SetOrgLimitsRequest {
  orderLimitOverride?:    number;
  supplierLimitOverride?: number;
  /** Absolute trial end (ISO 8601). */
  trialEndsAtOverride?:   string;
  /** Relative extension added to the current trial end. */
  extendTrialDays?:       number;
  clearOrderLimit?:       boolean;
  clearSupplierLimit?:    boolean;
  clearTrialEnds?:        boolean;
}

export interface OrgLimitsResponse {
  id:                      string;
  name:                    string;
  plan:                    string;
  accountStatus:           string;
  orderLimitOverride?:     number | null;
  supplierLimitOverride?:  number | null;
  trialEndsAtOverride?:    string | null;
  effectiveOrderLimit:     number;
  effectiveSupplierLimit:  number;
  effectiveTrialEndsAt?:   string | null;
}

// ── Order list pagination ───────────────────────────────────────────────────
// GET /api/orders now returns a paginated envelope instead of a bare array.

export interface OrdersPage {
  items: OrderSummary[];
  /**
   * Every order matching the query, practice orders INCLUDED — this is the population the
   * `items` rows are drawn and paged from, so it is the right number for pagination and the
   * wrong number for anything a plan meters.
   */
  totalCount: number;
  /**
   * How many of `totalCount` are practice orders. `totalCount - sampleCount` is the metered
   * population — the same number `OrdersSummary.total` reports. Never read this or
   * `totalCount` directly to print a count: use `meteredTotal` / `practiceTotal` from
   * `src/components/bridge/orderCountContract.ts`, which is what keeps the two screens from
   * deriving the population twice.
   *
   * Optional, and absent means 0, so an API older than dimnovare/ProcuLink#173 makes
   * `meteredTotal` collapse back to `totalCount` instead of under-reporting.
   */
  sampleCount?: number;
  page: number;
  pageSize: number;
}

export interface GetOrdersParams {
  page?: number;
  pageSize?: number;
  status?: string;
  supplierId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
