"use client";

// Suppliers — /library/suppliers
// List of every supplier the buyer delivers orders to. Fetches live data from
// GET /api/suppliers, then enriches each visible row with its delivery config
// (GET /api/suppliers/{id}/delivery-config) so the Supplier / Format / Channel /
// Auto-process columns carry real data. A green supplier-entity accent (badge
// tile, hover band) and a blue primary "New supplier" action.
//
// Columns the design once showed but for which no real data source exists on
// either the supplier list or the delivery config — "Orders" and "Acceptance"
// (they'd need a per-supplier order/delivery-success aggregate the API doesn't
// expose here) — were DROPPED rather than rendered as permanent dashes, per the
// offer↔works rule. Format / Channel / Auto-process come from the delivery
// config, and read "Not set" only when a COMPLETED read established that this
// supplier has no config yet.
//
// Performance: the delivery config is fetched PER ROW via a child component's own
// query, but bounded — only the first DELIVERY_FETCH_CAP rows fetch — so a large
// supplier book can't trigger an unbounded burst of requests. Each row's query
// has a long staleTime so navigating away and back doesn't re-hit the API.
//
// That bound is one of TWO reasons these cells have THREE readings, not two.
// Both reasons produce the same shape at the call site — `isLoading === false`
// with `data === undefined` — which is byte-for-byte what a settled "this
// supplier has no config" read produces, so `!config` collapsed all three:
//
//   1. NEVER ASKED. A row past DELIVERY_FETCH_CAP passes `enabled: false`, and a
//      disabled TanStack v5 query reports exactly that shape. Every row past the
//      cap therefore asserted an absence nobody had checked — with the shimmer
//      deliberately suppressed (`fetchConfig && isLoading`), so nothing on
//      screen hinted the question had never been put.
//   2. ASKED AND FAILED. `getDeliveryConfig` throws on any non-ok response, and
//      `isError` was never destructured at either consumer. A settled-errored
//      query has `isLoading === false` too, so a supplier with a live, working
//      delivery config read as "Not set" the moment its request 5xx'd — and
//      this list fires up to DELIVERY_FETCH_CAP of them in parallel on mount,
//      which is precisely the shape that produces intermittent failures.
//
// `deliveryConfigState` below separates them: both become "unknown", which
// renders a dash saying the setup was not loaded rather than any verdict about
// it. The two share ONE rendering deliberately. A 44px cell cannot carry the
// paragraph-plus-"Try again" panel that DeliverySummaryBody
// (SupplierDockProfile.tsx) already ships for this same query, and fifty of them
// would be worse than the defect; the reader's next move is identical in both
// cases, so the dash points at the supplier page, where that panel lives.
//
// Staleness is a different question from those three readings, and it is now
// bounded. The key this file reads — `deliveryConfigQueryKey(id)` — is invalidated
// by every mutation that changes a delivery config: the supplier create below,
// `DeliveryConfigEditor`'s save and delete, and `DeliveryGuidedSetup`'s save, all
// via `invalidateDeliveryConfig` (src/lib/deliveryConfigCache.ts). A mounted row
// re-reads after any of them instead of answering from the entry it warmed before
// the change.
//
// What that cannot cover is a change no mutation in this app saw — a config edited
// in another tab, or by a teammate — so a cell may still be up to staleTime old.
// Nothing here claims otherwise.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBillingStatus, apiClient, listConnections } from "@/lib/api-client";
import { getDeliveryConfig, upsertDeliveryConfig } from "@/lib/api/delivery";
import { deliveryConfigQueryKey, invalidateDeliveryConfig } from "@/lib/deliveryConfigCache";
import {
  isOrgAdminError,
  isPlanGateError,
  orgAdminMessage,
  planGateMessage,
  planGateUpgradeUrl,
} from "@/lib/planGate";
import { PlanGateNotice } from "./PlanGateNotice";
// The quota-429 copy is SHARED with UploadWorkbench — see src/lib/limitRefusal.ts. It is
// imported rather than rewritten because the correct `supplier_limit_reached` sentence
// already existed there, in a screen that can never receive that code.
import { isLimitCode, knownPlanId, limitRefusalCopy, type LimitRefusalCopy } from "@/lib/limitRefusal";
import { serverReason } from "@/lib/serverText";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { DeliveryConfig, DeliveryProtocol } from "@/lib/api/types";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";
import { tv2HeaderCell, tv2BodyCell, tv2RowDivider } from "./layout/listTableV2";

// How many rows enrich themselves with a delivery-config fetch. Procurement
// books are typically 3–20 suppliers (the ICP), so this comfortably covers a
// real account while capping the request burst on the rare oversized list.
//
// Exported so its guard can DERIVE the fixture size it needs instead of
// hard-coding one: a test with fewer suppliers than the cap never reaches a
// single un-fetched row and passes without exercising the defect at all.
export const DELIVERY_FETCH_CAP = 50;

// Friendly channel labels for the raw protocol ids (mirrors DeliveryConfigEditor).
const PROTOCOL_LABEL: Record<DeliveryProtocol, string> = {
  http: "HTTP",
  sftp: "SFTP",
  ftps: "FTPS",
  email: "Email",
  smtp: "Email (SMTP)",
  erp_erply: "Erply ERP",
  erp_directo: "Directo ERP",
};

// Connections offered in the New-supplier modal — the REAL protocols the delivery
// pipeline supports today (smtp is retired; Postmark HTTPS "email" is canonical).
//
// Email leads, matching the guided setup (WP-27): it is the only one that needs
// nothing from the other company, so it is the only one a user can complete on the
// day they sign up.
const NEW_SUPPLIER_CHANNELS: ReadonlyArray<{ id: DeliveryProtocol; label: string }> = [
  { id: "email", label: "Email" },
  { id: "http", label: "HTTP" },
  { id: "sftp", label: "SFTP" },
  { id: "ftps", label: "FTPS" },
  { id: "erp_erply", label: "Erply ERP" },
  { id: "erp_directo", label: "Directo ERP" },
];

// Output formats offered in the New-supplier modal — exactly the backend's
// allowed set (DeliveryConfigService: xml, csv, cxml, json, ubl, x12).
const NEW_SUPPLIER_FORMATS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "cxml", label: "cXML" },
  { id: "ubl", label: "UBL" },
  { id: "x12", label: "X12" },
  { id: "xml", label: "XML" },
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
];

function channelLabel(protocol: string): string {
  return PROTOCOL_LABEL[protocol as DeliveryProtocol] ?? protocol.toUpperCase();
}

function formatLabel(outputFormat?: string | null): string | null {
  if (!outputFormat) return null;
  return outputFormat.toUpperCase();
}

// ── Palette (CSS-var first; hexes mirror tokens for inline-only styles) ──────
// Supplier-green is the supplier ENTITY colour across the product (badge tile,
// hover row band, acceptance). Forest #2E8E3A reads crisp on white; deep #1E6D29
// is the icon stroke / accepted text; soft #E9F1EA is the tile / hover fill.
const GREEN        = "#2E8E3A"; // brand supplier green (markers, focus ring)
const GREEN_DEEP   = "#1E6D29"; // deep green — icon stroke, accepted text
const GREEN_SOFT   = "#E9F1EA"; // soft green — badge tile, hovered row band
// Blue is the primary-action colour (buttons), per the design source.
const BLUE         = "#1E66C9";
const BLUE_DEEP    = "#0F4FA8";
// Neutrals (sampled from the design render / tokens.css).
const INK          = "#0B1A2F"; // primary text
const TEXT_MUTED   = "#5E6779"; // subtitle / pill text
const TEXT_FAINT   = "var(--ink-faint)"; // header labels / codes
const PLACEHOLDER  = "#A2AAB9"; // faint "—" for not-yet-configured cells
const BORDER       = "#E5E8EE"; // card border + row dividers
const PILL_BG      = "#F1F3F7"; // neutral "Not set" pill fill
// Shared monospace stack for codes / numeric cells (matches the Buyers table).
const MONO         = "'JetBrains Mono', ui-monospace, monospace";

/**
 * Short uppercase code shown under the supplier name — mirrors the design's
 * ACME / BOLT / VDBM line. Derived from the name so it stays human-readable
 * instead of surfacing a raw UUID fragment.
 */
function shortCode(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SUP";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.slice(0, 4).map((w) => w[0].toUpperCase()).join("");
}

/** Supplier glyph — truck mark from the design icon set (stroke 1.75). */
function SupplierGlyph({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2" />
      <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </svg>
  );
}

export function SupplierDockList() {
  const router = useRouter();
  const qc = useQueryClient();
  // Direction-aware copy: "Supplier" → "Customer" in inbound mode (route/types unchanged).
  const { labels } = useOrderDirection();
  const noun = labels.counterpartyNoun;       // "Supplier" | "Customer"
  const nounLower = noun.toLowerCase();        // "supplier" | "customer"
  const plural = labels.counterpartyPlural;    // "Suppliers" | "Customers"
  const pluralLower = plural.toLowerCase();     // "suppliers" | "customers"
  const queryEnabled = useQueriesEnabled();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newName, setNewName] = useState("");
  // Optional initial delivery channel / output format — real fields stored on the
  // supplier's delivery config (protocol + outputFormat); full connection details
  // are still configured on the Delivery tab.
  const [newProtocol, setNewProtocol] = useState<DeliveryProtocol | null>(null);
  const [newFormat, setNewFormat] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Page-level notice for the partial-success path (supplier created, channel not
  // saved). It carries the new supplier's id, not just a sentence: the message
  // names the Delivery tab as the fix, so the notice has to be able to OPEN that
  // tab. Without the id the only control was the dismiss ✕ — which throws away
  // the very instruction the operator still needs to act on.
  //
  // It also carries the REASON the write was refused, verbatim from the api layer,
  // because "go to the Delivery tab" is only the fix for some of the reasons. See
  // the cause split below.
  const [pageNotice, setPageNotice] = useState<{ reason: string; supplierId: string } | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  // New-supplier modal a11y: Escape + focus-in + focus-trap + focus-restore +
  // scroll lock. Was an Escape-only listener with no trap.
  const addPanelRef = useRef<HTMLDivElement>(null);
  const closeAddPanel = useCallback(() => setShowAddPanel(false), []);
  useDialogA11y({ open: showAddPanel, onClose: closeAddPanel, panelRef: addPanelRef });

  // ── Billing check ──────────────────────────────────────────────────────────
  const {
    data: billing,
    isError: billingError,
    isPending: billingPending,
  } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
  });

  // When billing API is unavailable, optimistically allow adding (backend enforces the limit).
  //
  // FAILING OPEN ON AN ERROR IS DELIBERATE AND STAYS. Locking someone out of
  // their own workspace because a billing call 500'd is worse than letting the
  // backend refuse a create it was always going to refuse.
  const canAddSupplier = billingError ? true : (billing?.canAddSupplier ?? true);

  // FAILING OPEN WHILE LOADING WAS NOT DELIBERATE, and it is a different thing.
  //
  // `?? true` covered both states with one answer: "billing said no" and "billing
  // has not answered yet". So on every load of this page a limit-reached
  // workspace got a blue, enabled "New supplier" button until the query resolved,
  // and clicking inside that window opened the panel for a create the server was
  // certain to refuse with a 429.
  //
  // `limitReached` three hundred lines below already got this right — it requires
  // `billing` to exist before it claims anything. The two guards disagreed inside
  // one component, and the disagreement is what rendered.
  //
  // `isPending` alone is NOT the predicate. TanStack reports pending for a
  // DISABLED query too, so a workspace where `queryEnabled` is false — no Clerk
  // session, no organisation yet — would sit behind a permanently dead button.
  // That would be a worse bug than the one being fixed, so the enabled-ness is
  // part of the condition.
  const billingUnknown = queryEnabled && billingPending && !billingError;

  // ── Live supplier list ─────────────────────────────────────────────────────
  const {
    data: suppliers = [],
    isLoading,
    isError: suppliersError,
    // Bound to the failure state below. The list query is the only thing that
    // failed, so re-running IT is the fix — not a browser reload, which also
    // throws away the New-supplier panel and any notice on screen.
    refetch: refetchSuppliers,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
  });

  // ── Versioned connections (one query for the whole list) ──────────────────
  // supplierId → connectionId, so each row can link to its Connection where one
  // exists. Rows without a connection simply show no link (a connection is
  // created the first time the supplier is configured).
  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: queryEnabled,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 800,
  });
  const connectionIdBySupplier = useMemo(
    () => new Map((connections ?? []).map((c) => [c.supplierId, c.id] as const)),
    [connections],
  );

  // ── Create supplier ────────────────────────────────────────────────────────
  // Two-step: create the supplier, then (only when a channel was chosen) store the
  // initial delivery protocol + output format on its delivery config. A failed
  // second step must NOT look like a failed create — the supplier exists — so it
  // degrades to a page notice pointing at the Delivery tab instead of an error.
  //
  // The second step is NOT rolled back when it fails. Deleting the supplier that was
  // just created would throw away something the operator asked for and can no longer
  // see, to hide a failure from them — and the delete can be refused by exactly the
  // role check that refused the write, which would leave the undo half-done too.
  // The supplier stays; the notice below says what is missing from it.
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; protocol: DeliveryProtocol | null; outputFormat: string | null }) => {
      const supplier = await apiClient.createSupplier({ name: input.name });
      let channelError: string | null = null;
      if (input.protocol) {
        try {
          await upsertDeliveryConfig(supplier.id, {
            protocol: input.protocol,
            autoDeliver: false,
            configJson: "{}",
            outputFormat: input.outputFormat,
          });
        } catch (err) {
          // KEEP the cause. This used to be a bare `catch {}`, which collapsed every
          // reason the write can fail into one sentence — and one of those reasons
          // makes that sentence's instruction impossible to follow. See below.
          channelError = err instanceof Error ? err.message : String(err);
        }
      }
      return { supplier, channelError, wantedChannel: input.protocol != null };
    },
    onSuccess: ({ supplier, channelError, wantedChannel }) => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void invalidateDeliveryConfig(qc, supplier.id);
      setShowAddPanel(false);
      setNewName("");
      setNewProtocol(null);
      setNewFormat(null);
      setAddError(null);
      setPageNotice(
        wantedChannel && channelError !== null
          ? { reason: channelError, supplierId: supplier.id }
          : null,
      );
    },
    // KEEP THE REASON, DO NOT RENDER IT. This used to be
    //
    //     const parsed = JSON.parse(err.message);
    //     setAddError(parsed.error ?? err.message);
    //
    // which lifted the machine token out of the refusal and put it on screen: an org that
    // crossed its supplier allowance was shown `supplier_limit_reached`, in the add-supplier
    // modal, at the moment it is deciding whether to spend money. `createSupplier` already
    // runs the body through `serverReason`, so `err.message` IS that token by the time it
    // arrives — the JSON.parse arm never even fired. The string is kept raw here because the
    // discriminators downstream match on it (`isPlanGateError` reads the plan out of the
    // code); it is turned into a sentence at render, by `addFailure` below.
    onError: (err: Error) => setAddError(err.message),
  });

  function handleSave() {
    const trimmed = newName.trim();
    if (!trimmed) { setAddError(`${noun} name is required.`); return; }
    setAddError(null);
    createMutation.mutate({ name: trimmed, protocol: newProtocol, outputFormat: newProtocol ? newFormat : null });
  }

  // ── What the partial-success notice is allowed to tell the operator to do ──
  //
  // The delivery-config write answers 403 for TWO unrelated reasons, and the fix
  // differs for each. Until now the notice said "Set it on the supplier's Delivery
  // tab" for all of them, with a button straight to that tab — which for the
  // organisation-admin refusal sends the reader to a screen that will refuse them
  // again, and for a plan gate sends them somewhere no amount of trying will help.
  //
  //   plan gate   the org's plan does not include this channel → upgrading is the fix
  //   org admin   the reader is not an administrator            → asking one is the fix
  //   anything else (a 500, a timeout, a validation error)      → the Delivery tab IS the fix
  //
  // The discriminator and both sentences come from `@/lib/planGate`, never from here:
  // a capability that is re-tiered on the server must re-label itself with no change
  // to this file, and the two 403s must not be told apart by two different rules in
  // two different places.
  //
  // The org-admin refusal reaches this component by TWO carriers, and both must land
  // on the same arm. `src/lib/api/delivery.ts` swaps the machine code for the finished
  // sentence before throwing, so by the time the message gets here the code
  // `requires_org_admin` is usually gone; a caller that has not been converted still
  // carries it. Matching only the code would have silently routed the live path — the
  // converted one — into the "other" arm and re-offered the Delivery tab. Neither
  // branch retypes anything: the sentence is compared against `orgAdminMessage()`
  // itself, so there is still exactly one copy of it in the codebase.
  const isOrgAdminRefusal = (reason: string) =>
    isOrgAdminError(reason) || reason.includes(orgAdminMessage());

  const noticeCause: "plan" | "org_admin" | "other" | null = !pageNotice
    ? null
    : isPlanGateError(pageNotice.reason)
      ? "plan"
      : isOrgAdminRefusal(pageNotice.reason)
        ? "org_admin"
        : "other";

  // ── What the add-supplier modal is allowed to say when the CREATE is refused ──
  //
  // The second step of this button (the delivery-config write) has been routed through
  // planGate since #128; the FIRST step never was, so the two failures on one click took
  // two different paths and only one of them produced a sentence. Same three causes, same
  // three fixes, plus the one this endpoint adds:
  //
  //   plan gate    403 `<capability>_requires_<plan>`   → upgrading is the fix
  //   org admin    403 `requires_org_admin`             → asking an administrator is the fix
  //   quota        429 `supplier_limit_reached` etc.    → a bigger allowance is the fix
  //   anything else (a 500, a name clash, a timeout)    → trying again / reading the reason
  //
  // A quota refusal is NOT a plan gate and must not borrow its sentence: a gate means the
  // capability is absent from the tier, a quota means the tier has it and the allowance is
  // spent. Both end in "upgrade", which is exactly why they are easy to conflate and why
  // they are told apart by two different discriminators here.
  //
  // The allowance and the tier are read from the billing status this component already
  // holds, because `createSupplier` throws a plain `Error` and the structured body (`plan`,
  // the effective `limit`) does not survive it. When billing is unknown the copy says no
  // number at all rather than inventing the plan default.
  type AddFailure =
    | { kind: "plan_gate"; reason: string }
    | { kind: "org_admin" }
    | { kind: "quota"; copy: LimitRefusalCopy }
    | { kind: "other"; message: string };

  // A snake_case token with no spaces is a machine code, whatever it says. Anything this
  // build does not recognise falls through to generic copy rather than being printed: a
  // code the frontend has never heard of is still not a sentence, and a new one appearing
  // on the server must not become user-facing text by default.
  const looksLikeMachineCode = (value: string) => /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value.trim());

  const addFailure: AddFailure | null = !addError
    ? null
    : isPlanGateError(addError)
      ? { kind: "plan_gate", reason: addError }
      : isOrgAdminRefusal(addError)
        ? { kind: "org_admin" }
        : isLimitCode(addError)
          ? {
              kind: "quota",
              copy: limitRefusalCopy({
                code: addError.trim().toLowerCase(),
                plan: knownPlanId(billing?.plan),
                limit: billing?.supplierLimit ?? null,
                raw: addError,
              }),
            }
          : {
              kind: "other",
              message: looksLikeMachineCode(addError)
                ? `Could not add this ${nounLower}. Please try again, or contact support if it keeps happening.`
                : serverReason(
                    addError,
                    `Could not add this ${nounLower}. Please try again, or contact support if it keeps happening.`,
                  ),
            };

  const limitReached = !billingError && billing && !billing.canAddSupplier;

  /**
   * "You cannot press this right now" — true whether the answer is a refusal or
   * has not arrived. Kept separate from `limitReached`, which is "we know the
   * reason and it is the plan ceiling", because only one of the two may speak.
   */
  const notActionable = limitReached || billingUnknown;
  const hasRows = !isLoading && !suppliersError && suppliers.length > 0;

  // ── The supplier-limit banner, DERIVED ─────────────────────────────────────
  //
  // Same allowance, same tier, same null branch as the 429 the create call would have
  // received — `limitRefusalCopy` is the one derivation and this is its second reader.
  //
  // What stood here was hand-typed and named no tier at all:
  //
  //     Your {planName(billing.plan)} plan includes {billing.supplierLimit} suppliers.
  //     Existing supplier flows remain viewable. Upgrade when you are ready to add
  //     another supplier route.
  //
  // Three defects in that, all of the shape CLAUDE.md §11.5 names — a tier or an allowance
  // typed into a banner IS the defect:
  //
  //   1. NO TIER. "Upgrade when you are ready" tells a Growth org to upgrade to nothing in
  //      particular, so the one fact that would let them act — which tier, and what it costs —
  //      was the fact missing. §11.5 mandates "Upgrade to {next} to add more supplier flows."
  //   2. NO NULL BRANCH. `next` is null at the top of the self-serve ladder (Distributor) and
  //      on Enterprise. The old sentence read the same for them as for Pilot, so the two tiers
  //      with nothing left to sell were sent to a checkout that has nothing to offer them.
  //   3. AN EMPTY NUMBER. Enterprise supplier counts are set by agreement, so
  //      `PLAN_BY_ID.enterprise.supplierLimit` is null and the banner rendered the literal
  //      "Your Enterprise plan includes  suppliers." — a gap where the allowance should be.
  //
  // This screen never sees the 429 body here (nothing was POSTed — the server already said so
  // on the billing status), so `limit` is the effective allowance off that status, which is
  // where an admin override lands too. `knownPlanId` keeps an unrecognised plan id out of the
  // ladder lookup: it becomes null, and the copy then claims no number and no tier at all.
  const limitCopy = limitRefusalCopy({
    code: "supplier_limit_reached",
    plan: knownPlanId(billing?.plan),
    limit: billing?.supplierLimit ?? null,
    raw: "supplier_limit_reached",
  });

  return (
    <PageShell variant="wide">
        {/* Page header — titleHidden: the topbar already names this page on
            every viewport — the Partners hub tab is direction-aware
            ("Suppliers" outbound / "Customers" inbound; BridgeTopbar threads
            counterpartyPlural into HubTabs), and that strip shows on mobile
            too. sr-only h1 keeps {plural}. Count line + New-supplier action
            stay. */}
        <PageHeader
          titleHidden
          title={plural}
          sub={
            isLoading
              ? "Loading…"
              : `Your ${pluralLower} directory — each one's versioned integration lives in Connections. ${suppliers.length} active ${nounLower}${suppliers.length === 1 ? "" : "s"}.`
          }
          actions={
            <div className="w-full sm:w-auto">
              <button
                disabled={!canAddSupplier || billingUnknown || createMutation.isPending}
                aria-busy={billingUnknown || undefined}
                /* The label is a STATE, not a reason. On its own — which is what a
                   screen-reader user got — "Supplier limit reached" says the door is
                   shut and nothing about the allowance, the tier, or the way through.
                   The banner below carries all three; this ties the two together so
                   the refused control names its own reason. */
                aria-describedby={limitReached ? "supplier-limit-banner" : undefined}
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="inline-flex h-[34px] w-full items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold tracking-[-0.005em] transition-colors sm:w-auto"
                /* Appearance answers "can I act on this?", which is false in BOTH
                   states. The LABEL answers "why not?", which is only knowable in
                   one of them — so it stays keyed to `limitReached` and says
                   nothing about a limit that has not been checked. A blue button
                   that does not respond is the defect this replaces. */
                style={{
                  background: notActionable ? "#F1F3F7" : BLUE,
                  color: notActionable ? "var(--ink-faint)" : "#FFFFFF",
                  border: "none",
                  cursor: notActionable ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: notActionable ? "none" : "0 1px 2px rgba(30,102,201,0.30)",
                }}
                onMouseEnter={(e) => { if (!notActionable) (e.currentTarget as HTMLButtonElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { if (!notActionable) (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
              >
                {!notActionable && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5v14" />
                  </svg>
                )}
                {limitReached ? `${noun} limit reached` : `New ${nounLower}`}
              </button>
            </div>
          }
        />

        {/* Partial-success notice (supplier created, channel not saved). Amber, the
            same action treatment as the billing banner below, so this introduces no
            new visual language. `role="status"` because the panel it replaces has
            already closed by the time this appears — without it the only signal that
            half the operation failed is a colour a screen reader cannot see.

            The action is chosen from the CAUSE, not assumed. Only the "other" arm
            offers the Delivery tab, because only that arm is a failure the reader
            can actually clear there. The dismiss ✕ stays, and for the org-admin arm
            it is deliberately the only control: there is nowhere in the product to
            send someone whose fix is another person. */}
        {pageNotice && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[10px] px-4 py-3 text-[12.5px]"
            style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
          >
            <span className="min-w-0 flex-1">
              {noun} created — but its delivery channel was not saved, so orders cannot be
              sent to this {nounLower} yet.{" "}
              {noticeCause === "plan"
                ? planGateMessage(pageNotice.reason)
                : noticeCause === "org_admin"
                  ? orgAdminMessage()
                  : `Set it on the ${nounLower}'s Delivery tab.`}
            </span>
            <div className="flex flex-shrink-0 items-center gap-2">
              {noticeCause === "plan" && (
                <Link
                  href={planGateUpgradeUrl(pageNotice.reason)}
                  className="inline-flex items-center rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
                  style={{ border: "1px solid #B36D14", background: "#FFFFFF", color: "#9A5F0A", textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  See plans
                </Link>
              )}
              {noticeCause === "other" && (
                <Link
                  href={`/library/suppliers/${pageNotice.supplierId}?tab=delivery`}
                  className="inline-flex items-center rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
                  style={{ border: "1px solid #B36D14", background: "#FFFFFF", color: "#9A5F0A", textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  Open Delivery tab
                </Link>
              )}
              <button
                onClick={() => setPageNotice(null)}
                aria-label="Dismiss notice"
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px]"
                style={{ border: "1px solid #F0D39A", background: "#FFFFFF", color: "#7A4D0B" }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Billing limit banner — every claim in it comes from `limitCopy` above. */}
        {billing && !billing.canAddSupplier && (
          <div
            id="supplier-limit-banner"
            data-testid="supplier-limit-banner"
            className="mb-4 rounded-[10px] px-4 py-3"
            style={{ border: "1px solid #F0D39A", borderLeft: "3px solid #B36D14", background: "#FFF8EA" }}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: INK }}>
                  {limitCopy.title}
                </p>
                <p className="mt-1 text-[12px] leading-5" style={{ color: "#7A4D0B" }}>
                  {limitCopy.message} Existing {nounLower} flows remain viewable.
                </p>
              </div>
              {/* Label AND destination both follow the ladder. `href` is set only on the
                  no-tier-above branch, where the route is a conversation rather than a
                  checkout; everywhere else the caller's own default is billing. */}
              <button
                onClick={() => router.push(limitCopy.href ?? "/settings")}
                className="h-8 rounded-[6px] px-3 text-[12px] font-semibold"
                style={{ border: "1px solid #B36D14", background: "#FFFFFF", color: "#9A5F0A" }}
              >
                {limitCopy.cta}
              </button>
            </div>
          </div>
        )}

        {/* Billing API unavailable notice */}
        {billingError && (
          <div
            className="mb-4 rounded-[10px] px-4 py-3 text-[12.5px]"
            style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
          >
            {noun} limits could not be checked because the billing API is unavailable.
          </div>
        )}

        {/* New supplier — centered modal (Claude Design v2 anatomy: title + X,
            subtitle, fields, footer divider + Cancel + green primary). Channel and
            format are OPTIONAL real fields stored on the delivery config; the full
            connection details are still configured on the Delivery tab. */}
        {showAddPanel && canAddSupplier && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6"
            onClick={() => setShowAddPanel(false)}
          >
            <div
              ref={addPanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-supplier-title"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] w-full overflow-auto rounded-t-[12px] bg-white shadow-2xl sm:max-w-[520px] sm:rounded-[12px]"
              style={{ border: "1px solid #E5E8EE" }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid #E5E8EE" }}>
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 flex flex-shrink-0 items-center justify-center"
                    style={{ width: 34, height: 34, borderRadius: 8, background: GREEN_SOFT }}
                    aria-hidden
                  >
                    <SupplierGlyph color={GREEN_DEEP} size={17} />
                  </div>
                  <div>
                    <h2 id="new-supplier-title" className="text-[17px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: INK }}>
                      New {nounLower}
                    </h2>
                    <p className="mt-0.5 text-[12.5px] leading-5" style={{ color: TEXT_MUTED }}>
                      Name the {nounLower}. You can configure mappings and delivery after.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowAddPanel(false); setNewName(""); setNewProtocol(null); setNewFormat(null); setAddError(null); }}
                  aria-label="Close add supplier panel"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px]"
                  style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "var(--ink-faint)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-col gap-4 px-5 py-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-semibold" style={{ color: TEXT_MUTED }}>
                    {noun} name <span style={{ color: "#B43838", marginLeft: 3 }}>*</span>
                  </label>
                  <input
                    aria-label={`${noun} name`}
                    placeholder="e.g. Acme Components"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                    className="h-9 rounded-[6px] px-3 text-[12.5px]"
                    style={{ border: "1px solid #CBD0DA", color: INK, transition: "border-color 150ms, box-shadow 150ms" }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#CBD0DA"; e.currentTarget.style.boxShadow = "none"; }}
                    autoFocus
                  />
                </div>

                {/* Delivery channel — optional; stored as the initial protocol */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-semibold" style={{ color: TEXT_MUTED }}>
                    Delivery channel <span style={{ fontWeight: 500, color: "var(--ink-faint)" }}>(optional)</span>
                  </label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Delivery channel">
                    {NEW_SUPPLIER_CHANNELS.map((c) => {
                      const active = newProtocol === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => { setNewProtocol(active ? null : c.id); if (active) setNewFormat(null); }}
                          className="h-8 rounded-[7px] px-3 text-[12px] font-semibold transition-colors"
                          style={{
                            border: `1px solid ${active ? GREEN : "#E5E8EE"}`,
                            background: active ? GREEN_SOFT : "#FFFFFF",
                            color: active ? GREEN_DEEP : TEXT_MUTED,
                            cursor: "pointer",
                          }}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11.5px] leading-4" style={{ color: "var(--ink-faint)" }}>
                    You&rsquo;ll configure the connection details next, on the {nounLower}&rsquo;s Delivery tab.
                  </p>
                </div>

                {/* Output format — optional; saved with the delivery channel */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.5px] font-semibold" style={{ color: TEXT_MUTED }}>
                    Output format <span style={{ fontWeight: 500, color: "var(--ink-faint)" }}>(optional)</span>
                  </label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Output format">
                    {NEW_SUPPLIER_FORMATS.map((f) => {
                      const active = newFormat === f.id;
                      const disabled = newProtocol == null;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={active}
                          disabled={disabled}
                          onClick={() => setNewFormat(active ? null : f.id)}
                          className="h-8 rounded-[7px] px-3 text-[12px] font-semibold transition-colors"
                          style={{
                            border: `1px solid ${active ? GREEN : "#E5E8EE"}`,
                            background: active ? GREEN_SOFT : "#FFFFFF",
                            color: active ? GREEN_DEEP : TEXT_MUTED,
                            opacity: disabled ? 0.45 : 1,
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                  {newProtocol == null && (
                    <p className="text-[11.5px] leading-4" style={{ color: "var(--ink-faint)" }}>
                      The format is saved with the delivery channel — pick a channel first, or set both later on the Delivery tab.
                    </p>
                  )}
                </div>

                <div
                  className="flex items-start gap-2 rounded-[6px] px-3 py-2.5 text-[12px] leading-5"
                  style={{ background: GREEN_SOFT, color: GREEN_DEEP }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                  </svg>
                  Auto-process means orders are sent to this {nounLower} automatically once they pass checks. It stays off until you set up delivery and turn it on.
                </div>

                {/* A plan gate gets the amber upsell; everything else gets the red failure
                    box. The two must not look alike — "you need a bigger plan" and
                    "something broke" have different next steps and only one of them is
                    worth money. */}
                {addFailure?.kind === "plan_gate" && (
                  <PlanGateNotice error={addFailure.reason} capability={`Adding a ${nounLower}`} />
                )}

                {addFailure?.kind === "quota" && (
                  <div
                    role="status"
                    data-testid="add-supplier-quota"
                    className="rounded-[6px] px-3 py-2.5 text-[12px] leading-5"
                    style={{
                      border: "1px solid var(--amber-border, var(--amber-soft))",
                      borderLeft: "3px solid var(--amber)",
                      background: "var(--amber-soft)",
                      color: "var(--amber-text)",
                    }}
                  >
                    <p className="m-0 font-semibold">{addFailure.copy.title}</p>
                    <p className="m-0 mt-0.5">{addFailure.copy.message}</p>
                    {addFailure.copy.href && (
                      <Link
                        href={addFailure.copy.href}
                        className="mt-1 inline-block font-semibold"
                        style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
                      >
                        {addFailure.copy.cta} →
                      </Link>
                    )}
                  </div>
                )}

                {addFailure?.kind === "org_admin" && (
                  <p className="text-[12px]" data-testid="add-supplier-error" style={{ color: "var(--danger)" }}>
                    {orgAdminMessage()}
                  </p>
                )}

                {addFailure?.kind === "other" && (
                  <p className="text-[12px]" data-testid="add-supplier-error" style={{ color: "var(--danger)" }}>
                    {addFailure.message}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end" style={{ borderTop: "1px solid #E5E8EE" }}>
                <button
                  onClick={() => { setShowAddPanel(false); setNewName(""); setNewProtocol(null); setNewFormat(null); setAddError(null); }}
                  className="flex h-9 items-center justify-center rounded-[7px] px-4 text-[12.5px] font-semibold transition-colors hover:bg-[#F6F7FA]"
                  style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: TEXT_MUTED }}
                >
                  Cancel
                </button>
                {/* Confirmation CTA stays green (matches design ctaVariant) */}
                <button
                  onClick={handleSave}
                  disabled={createMutation.isPending}
                  className="inline-flex h-9 items-center justify-center gap-[6px] rounded-[7px] px-4 text-[12.5px] font-semibold transition-colors"
                  style={{
                    border: "none",
                    background: GREEN,
                    color: "#FFFFFF",
                    cursor: createMutation.isPending ? "not-allowed" : "pointer",
                    opacity: createMutation.isPending ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN_DEEP; }}
                  onMouseLeave={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {createMutation.isPending ? "Saving…" : `Add ${nounLower}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            className="overflow-hidden rounded-[10px]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
            role="status"
            aria-busy="true"
          >
            <span className="sr-only">Loading…</span>
            <SupplierTableHeader counterpartyNoun={noun} />
            {[1, 2, 3, 4].map((i, idx) => (
              <div
                key={i}
                className="flex items-center gap-[13px] px-[18px]"
                style={{ height: 44, borderTop: idx === 0 ? "none" : "1px solid #E5E8EE" }}
              >
                <div className="h-8 w-8 flex-shrink-0 rounded-[7px] animate-pulse" style={{ background: "#F1F3F7" }} />
                <div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "#F1F3F7" }} />
              </div>
            ))}
          </div>
        )}

        {/* Fetch error. The old copy ended at "try refreshing" — an instruction
            to reload the browser for something this page can redo in place, and
            the user's only option was to follow it. refetchSuppliers() re-runs
            just this query and leaves the rest of the page standing. Direction-
            aware noun, like every other sentence on this screen. */}
        {suppliersError && !isLoading && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-[13px]"
            style={{ border: "1px solid #F1C9C9", background: "#FEF2F2", color: "#B43838" }}
          >
            <span className="min-w-0 flex-1">Could not load {pluralLower}.</span>
            <button
              type="button"
              onClick={() => refetchSuppliers()}
              className="flex-shrink-0 rounded-[7px] px-3 text-[12px] font-medium"
              style={{ height: 30, border: `1px solid ${BORDER}`, background: "#FFFFFF", color: INK, cursor: "pointer" }}
            >
              ↻ Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !suppliersError && suppliers.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-12 text-center"
            style={{ border: "1px dashed #CBD0DA", background: "#FFFFFF" }}
          >
            <div
              className="mx-auto mb-3 flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
            >
              <SupplierGlyph color={GREEN_DEEP} size={20} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: INK }}>No {pluralLower} configured</p>
            <p className="mx-auto mt-1 max-w-[360px] text-[12.5px] leading-5" style={{ color: TEXT_MUTED }}>
              Add a {nounLower} to start processing purchase orders into the format and channel it requires.
            </p>
            {canAddSupplier && (
              <button
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="mt-4 inline-flex h-[34px] items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold"
                style={{ border: "none", background: BLUE, color: "#FFFFFF", boxShadow: "0 1px 2px rgba(30,102,201,0.30)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5v14" />
                </svg>
                New {nounLower}
              </button>
            )}
          </div>
        )}

        {/* ── Desktop: single table card (sm and up) ─────────────────────── */}
        {hasRows && (
          <div
            className="hidden overflow-hidden rounded-[10px] sm:block"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <colgroup>
                <col />
                <col style={{ width: 160 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 170 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr>
                  {([
                    { label: noun,           align: "left"  },
                    { label: "Format",       align: "left"  },
                    { label: "Channel",      align: "left"  },
                    { label: "Auto-process", align: "left"  },
                    { label: "",             align: "right" },
                    { label: "",             align: "right" },
                  ] as const).map((col, i) => (
                    <th
                      key={i}
                      // v2 full-bleed table: shared listTableV2 header treatment
                      // (tinted surface-2 band, muted uppercase caps, 18px gutter).
                      style={tv2HeaderCell(col.align, i === 0)}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, idx) => (
                  <SupplierTableRow
                    key={s.id}
                    id={s.id}
                    name={s.name}
                    isHover={hoverRow === s.id}
                    isLast={idx === suppliers.length - 1}
                    fetchConfig={queryEnabled && idx < DELIVERY_FETCH_CAP}
                    nounLower={nounLower}
                    connectionId={connectionIdBySupplier.get(s.id) ?? null}
                    onEnter={() => setHoverRow(s.id)}
                    onLeave={() => setHoverRow(null)}
                    onOpen={() => router.push(`/library/suppliers/${s.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Mobile: one rounded card per supplier (below sm) ────────────── */}
        {hasRows && (
          <ul className="flex list-none flex-col gap-3 p-0 sm:hidden">
            {suppliers.map((s, idx) => (
              <SupplierMobileCard
                key={s.id}
                id={s.id}
                name={s.name}
                fetchConfig={queryEnabled && idx < DELIVERY_FETCH_CAP}
                connectionId={connectionIdBySupplier.get(s.id) ?? null}
                onOpen={() => router.push(`/library/suppliers/${s.id}`)}
              />
            ))}
          </ul>
        )}
    </PageShell>
  );
}

/** Column header row — used by the loading skeleton (desktop only). */
function SupplierTableHeader({ counterpartyNoun = "Supplier" }: { counterpartyNoun?: string }) {
  // v2 tinted header band — matches the live table header (surface-2 + muted ink).
  const cls = "text-[10.5px] font-bold uppercase tracking-[0.07em]";
  const color = "var(--ink-muted)";
  return (
    <div
      className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_18px] items-center gap-4 px-[18px] py-[10px] sm:grid"
      style={{ background: "var(--surface-2)", borderBottom: "1px solid #E5E8EE" }}
    >
      <span className={cls} style={{ color }}>{counterpartyNoun}</span>
      <span className={cls} style={{ color }}>Format</span>
      <span className={cls} style={{ color }}>Channel</span>
      <span className={cls} style={{ color }}>Auto-process</span>
      <span />
    </div>
  );
}

/**
 * Per-row delivery-config query. Each visible supplier row owns its own fetch so
 * the list can render immediately while configs stream in. Bounded at the call
 * site (only the first DELIVERY_FETCH_CAP rows pass `enabled`), with a long
 * staleTime so the configs survive navigation without re-hitting the API.
 *
 * Returns null both when no config exists (backend 204 → null) and when the
 * fetch is disabled/still loading — callers must NOT read that null directly.
 * Pass the whole result through `deliveryConfigState` instead.
 */
function useSupplierDeliveryConfig(supplierId: string, enabled: boolean) {
  return useQuery<DeliveryConfig | null>({
    queryKey: deliveryConfigQueryKey(supplierId),
    queryFn: () => getDeliveryConfig(supplierId),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 800,
  });
}

/**
 * What one row actually knows about its delivery config.
 *
 *   "loading"  a read is in flight — shimmer
 *   "present"  a completed read returned a config
 *   "absent"   a completed read returned none (backend 204 → null) — "Not set"
 *   "unknown"  nobody asked, or the asking failed — NOT an absence
 *
 * The last one is the whole reason this function exists. `enabled` is false for
 * every row past DELIVERY_FETCH_CAP, and a disabled TanStack v5 query reports
 * `isLoading === false` with `data === undefined` — byte-for-byte what a settled
 * "this supplier has no config" read looks like at the call site. Deriving the
 * cell from `!config` therefore printed the same verdict for both, and a failed
 * fetch joined them: three different situations, one sentence.
 */
type DeliveryConfigState = "loading" | "present" | "absent" | "unknown";

function deliveryConfigState(
  fetchConfig: boolean,
  config: DeliveryConfig | null | undefined,
  isLoading: boolean,
  isError: boolean,
): DeliveryConfigState {
  if (!fetchConfig) return "unknown";
  if (isLoading) return "loading";
  if (isError) return "unknown";
  return config ? "present" : "absent";
}

/**
 * Hover text on every cell of a row whose delivery config was not loaded.
 *
 * The middle clause is the load-bearing one and is lifted from the treatment
 * DeliverySummaryBody already ships for this same query on the supplier page:
 * the reader has to be told that this is not the "nothing is configured"
 * answer, because that is the reading the cell used to give them.
 */
const NOT_LOADED_TITLE =
  'Not loaded — not the same as "not configured". Open the supplier to see its delivery setup.';
/** The same fact for a screen reader, which cannot hover a title attribute. */
const NOT_LOADED_LABEL = "Not loaded";

/**
 * The cell value for a row whose delivery config was never read, or whose read
 * failed.
 *
 * Deliberately the same faint dash the configured-but-empty cells use: this
 * screen has nothing to report, and inventing a distinct visual state for
 * "we didn't look" would be a second claim on top of the first. The sentence
 * carries the difference, and it names where the answer actually lives.
 */
function NotLoadedValue() {
  return (
    <span className="text-[12.5px]" style={{ color: PLACEHOLDER }} title={NOT_LOADED_TITLE}>
      —<span className="sr-only"> {NOT_LOADED_LABEL}</span>
    </span>
  );
}

/**
 * Auto-process status pill. ON = green (delivery is auto-fired), OFF = neutral
 * "Off", and "Not set" when a completed read established that the supplier has
 * no delivery config yet (the honest empty state — distinct from a
 * configured-but-manual supplier, and from one nobody looked up: see
 * `deliveryConfigState`, whose "unknown" never reaches this component).
 */
function AutoProcessPill({ state, onHoverRow }: { state: "on" | "off" | "unset"; onHoverRow: boolean }) {
  if (state === "unset") return <NotSetPill onHoverRow={onHoverRow} />;
  const isOn = state === "on";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium"
      style={{
        background: isOn ? GREEN_SOFT : (onHoverRow ? "#FFFFFF" : PILL_BG),
        color: isOn ? GREEN_DEEP : TEXT_MUTED,
        transition: "background 150ms",
      }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: isOn ? GREEN : "#CBD0DA" }} />
      {isOn ? "On" : "Off"}
    </span>
  );
}

/** Faint inline placeholder cell value (loading shimmer, "not loaded", or honest "—"). */
function CellValue({
  state,
  value,
}: {
  state: DeliveryConfigState;
  value: string | null;
}) {
  if (state === "loading") {
    return <span className="inline-block h-3 w-12 rounded animate-pulse align-middle" style={{ background: "#F1F3F7" }} />;
  }
  if (state === "unknown") {
    return <NotLoadedValue />;
  }
  if (value == null) {
    return <span className="text-[12.5px]" style={{ color: PLACEHOLDER }}>—</span>;
  }
  return <span className="text-[12.5px]" style={{ color: INK }}>{value}</span>;
}

/**
 * One desktop table row, enriched with its delivery config. Format / Channel are
 * derived from the config (or a faint "—" when unconfigured); Auto-process is a
 * pill driven by `autoDeliver`.
 */
function SupplierTableRow({
  id,
  name,
  isHover,
  isLast,
  fetchConfig,
  nounLower,
  connectionId,
  onEnter,
  onLeave,
  onOpen,
}: {
  id: string;
  name: string;
  isHover: boolean;
  isLast: boolean;
  fetchConfig: boolean;
  nounLower: string;
  /** This supplier's versioned Connection id, or null when none exists yet. */
  connectionId: string | null;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const { data: config, isLoading, isError } = useSupplierDeliveryConfig(id, fetchConfig);
  // Four states, one derivation — see deliveryConfigState. "unknown" is a row
  // that never fetched (past DELIVERY_FETCH_CAP) or whose fetch failed; it must
  // never reach the "Not set" pill, which is a claim about the SERVER's answer.
  const state = deliveryConfigState(fetchConfig, config, isLoading, isError);
  const autoState: "on" | "off" | "unset" = !config ? "unset" : config.autoDeliver ? "on" : "off";
  // v2 row dividers use the faint border (shared listTableV2 token).
  const cellBorder = isLast ? "none" : tv2RowDivider;

  return (
    <tr
      onClick={onOpen}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={`View this ${nounLower}'s delivery configuration and mappings`}
      style={{
        cursor: "pointer",
        transition: "background 150ms",
        background: isHover ? GREEN_SOFT : "transparent",
      }}
    >
      {/* Supplier — leading green entity dot + green tile + single-line name with
          inline muted code suffix (44px single-line row per the v2 design). */}
      <td style={{ ...tv2BodyCell("left", true), borderBottom: cellBorder }}>
        <div className="flex min-w-0 items-center gap-[11px]">
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, flexShrink: 0 }}
          />
          <div
            className="flex flex-shrink-0 items-center justify-center"
            style={{
              width: 32,
              height: 32,
              borderRadius: 7,
              background: isHover ? "#FFFFFF" : GREEN_SOFT,
              transition: "background 150ms",
            }}
          >
            <SupplierGlyph color={GREEN_DEEP} size={16} />
          </div>
          <p className="truncate text-[13.5px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: INK, margin: 0 }}>
            {name}
            <span
              className="text-[10.5px] font-normal tracking-[0.02em]"
              style={{ color: TEXT_FAINT, fontFamily: MONO, marginLeft: 8 }}
            >
              {shortCode(name)}
            </span>
          </p>
        </div>
      </td>

      {/* Format — from delivery config outputFormat */}
      <td style={{ ...tv2BodyCell("left", false), borderBottom: cellBorder }}>
        <CellValue state={state} value={config ? formatLabel(config.outputFormat) : null} />
      </td>

      {/* Channel — from delivery config protocol */}
      <td style={{ ...tv2BodyCell("left", false), borderBottom: cellBorder }}>
        <CellValue state={state} value={config ? channelLabel(config.protocol) : null} />
      </td>

      {/* Auto-process — from delivery config autoDeliver */}
      <td style={{ ...tv2BodyCell("left", false), borderBottom: cellBorder }}>
        {state === "loading" ? (
          <span className="inline-block h-4 w-14 rounded-full animate-pulse align-middle" style={{ background: "#F1F3F7" }} />
        ) : state === "unknown" ? (
          <NotLoadedValue />
        ) : (
          <AutoProcessPill state={autoState} onHoverRow={isHover} />
        )}
      </td>

      {/* History — compact link to this supplier's version-history tab (hidden when
          no connection exists yet). STRUCT-1: the version history now lives on the
          supplier page (?tab=history), not the standalone /connections route. */}
      <td style={{ padding: "0 8px", height: 44, borderBottom: cellBorder, textAlign: "right", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        {connectionId && (
          <Link
            href={`/library/suppliers/${id}?tab=history`}
            onClick={(e) => e.stopPropagation()}
            title={`Open this ${nounLower}'s version history`}
            className="text-[11.5px] font-medium"
            style={{ color: isHover ? GREEN_DEEP : TEXT_MUTED, textDecoration: "none", transition: "color 120ms" }}
          >
            History ›
          </Link>
        )}
      </td>

      {/* Chevron */}
      <td style={{ padding: "0 14px", height: 44, borderBottom: cellBorder, textAlign: "right", verticalAlign: "middle" }}>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={isHover ? GREEN_DEEP : "#A4ADBD"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: "stroke 120ms", display: "inline-block" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </td>
    </tr>
  );
}

/** One mobile supplier card, enriched with its delivery config. */
function SupplierMobileCard({
  id,
  name,
  fetchConfig,
  connectionId,
  onOpen,
}: {
  id: string;
  name: string;
  fetchConfig: boolean;
  /** This supplier's versioned Connection id, or null when none exists yet. */
  connectionId: string | null;
  onOpen: () => void;
}) {
  const { data: config, isLoading, isError } = useSupplierDeliveryConfig(id, fetchConfig);
  // Same four-state derivation as the desktop row — the phone card is the SAME
  // claim in different markup, so it cannot be allowed to drift from it.
  const state = deliveryConfigState(fetchConfig, config, isLoading, isError);
  const autoState: "on" | "off" | "unset" = !config ? "unset" : config.autoDeliver ? "on" : "off";

  return (
    // The card frame (border / white fill / shadow) lives on the <li> so the
    // History link can sit in a real footer row INSIDE the same visual card
    // while staying OUTSIDE the button (no nested interactive elements). This
    // keeps the link tied to its card instead of floating orphaned in the gutter.
    <li
      className="overflow-hidden rounded-[12px]"
      style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full p-4 text-left transition-colors active:opacity-95"
      >
        {/* Card head: badge + name + code, chevron on the right */}
        <div className="flex items-center gap-3">
          <div
            className="flex flex-shrink-0 items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
          >
            <SupplierGlyph color={GREEN_DEEP} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: INK }}>
              {name}
            </p>
            <p className="mt-[2px] truncate text-[11px] leading-tight tracking-[0.02em]" style={{ color: TEXT_FAINT, fontFamily: MONO }}>
              {shortCode(name)}
            </p>
          </div>
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="#A4ADBD" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
            className="flex-shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>

        {/* Card body: label / value rows (Format · Channel · Auto-process) */}
        <dl
          className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3.5"
          style={{ borderColor: "#EEF1F6" }}
        >
          <MobileStat label="Format" state={state} value={config ? formatLabel(config.outputFormat) : null} />
          <MobileStat label="Channel" state={state} value={config ? channelLabel(config.protocol) : null} />
          <div className="col-span-2 flex items-center justify-between">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-faint)" }}>
              Auto-process
            </dt>
            <dd className="m-0">
              {state === "loading" ? (
                <span className="inline-block h-4 w-14 rounded-full animate-pulse" style={{ background: "#F1F3F7" }} />
              ) : state === "unknown" ? (
                <NotLoadedValue />
              ) : (
                <AutoProcessPill state={autoState} onHoverRow={false} />
              )}
            </dd>
          </div>
        </dl>
      </button>
      {/* Version-history link — a card FOOTER row: still OUTSIDE the card button
          (no nested interactive elements), but now inside the shared card frame
          with a hairline top divider so it reads as part of this supplier's card
          rather than floating orphaned in the gutter. Hidden when no connection
          exists yet. STRUCT-1: the history view lives on the supplier page
          (?tab=history). */}
      {connectionId && (
        <Link
          href={`/library/suppliers/${id}?tab=history`}
          className="flex items-center justify-end px-4 py-2.5 text-[12px] font-medium"
          style={{ color: TEXT_MUTED, textDecoration: "none", borderTop: "1px solid #EEF1F6" }}
        >
          History ›
        </Link>
      )}
    </li>
  );
}

/**
 * Neutral "Not set" status pill — mirrors the design's grey scope/status pill
 * (bg #F1F3F7, text #5E6779, leading dot). Turns its fill white on a hovered
 * desktop row so it reads against the green row tint.
 */
function NotSetPill({ onHoverRow }: { onHoverRow: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: onHoverRow ? "#FFFFFF" : PILL_BG, color: TEXT_MUTED, transition: "background 150ms" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#CBD0DA" }} />
      Not set
    </span>
  );
}

/**
 * One label/value stat inside a mobile supplier card. Stacks the uppercase
 * column label above its value so the card stays scannable at 390px. A null
 * value from a completed read renders the honest faint "—"; "loading" shows a
 * shimmer; "unknown" renders the dash that says nobody looked.
 */
function MobileStat({ label, value, state }: { label: string; value: string | null; state: DeliveryConfigState }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-faint)" }}>
        {label}
      </dt>
      <dd className="m-0 text-[13px]" style={{ color: value == null ? PLACEHOLDER : INK }}>
        {state === "loading" ? (
          <span className="inline-block h-3 w-12 rounded animate-pulse" style={{ background: "#F1F3F7" }} />
        ) : state === "unknown" ? (
          <NotLoadedValue />
        ) : (
          value ?? "—"
        )}
      </dd>
    </div>
  );
}
