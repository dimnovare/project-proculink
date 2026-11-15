"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
} from "@/lib/api-client";
import { useState } from "react";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, CHECKOUT_PLAN_IDS, DOCUMENT_PLAN_IDS, nextPlanFor, yearlySavePercent, billingPriceLabelFor } from "@/lib/plans";
import { useDocumentEngine, flowsQuery } from "@/hooks/useDocumentEngine";
import { capture } from "@/lib/analytics";
import { isOrgAdminRefusal, orgAdminMessage } from "@/lib/planGate";
import { BOOK_DEMO_URL, BOOK_DEMO_LINK_ATTRS } from "@/lib/book-demo";
import { accountStatusLabel, pausedCauseCopy, namesSubscriptionCause } from "@/lib/billingPause";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { Quiet } from "@/components/flows/states";
import { isPlanGate, PlanGateNotice } from "@/components/bridge/PlanGateNotice";
import { NUMBER_LOCALE } from "@/lib/format-number";
import { documentsUse, extraLines, flowsUse, planLine, type Use } from "@/lib/billingWords";
import { Check } from "lucide-react";

type BillingInterval = "monthly" | "yearly";

/**
 * What to tell someone whose "Change plan" / "Manage in Stripe" click was refused.
 *
 * Both buttons open the Stripe Billing Portal, which is where a subscription is cancelled, so
 * the backend restricts them to organisation administrators. Every failure here used to resolve
 * to one of two hardcoded sentences and the server's reason was discarded, which meant an
 * ordinary member was told "Please try again" about the one thing retrying can never fix.
 *
 * The role refusal is checked FIRST and never falls through to the retry copy. It is also not a
 * plan problem, so nothing here offers an upgrade: this person's organisation may well be on the
 * right plan already.
 */
function portalErrorCopy(error: unknown): string {
  if (isOrgAdminRefusal(error)) return orgAdminMessage();
  if (error instanceof Error && error.message.toLowerCase().includes("customer")) {
    return "No billing customer on file. Contact support to link your account.";
  }
  return "Could not open billing portal. Please try again or contact support.";
}

/**
 * The same question for the CHECKOUT button, which had no answer at all.
 *
 * Both upgrade blocks below used to render
 *
 *     {(checkoutMutation.error as Error)?.message || "Could not start checkout. Please try again."}
 *
 * and nothing on this path writes a message for a person to read. `readRefusal`
 * (src/lib/api/refusal.ts) puts the body's `error` field into the message verbatim — a machine
 * token — and when the body carries no such field it falls back to the string `billing.ts`
 * passed it, `billing/checkout: <status>`, which is a status line the CLIENT built. So the
 * customer's last screen before paying showed either a snake_case code or an internal label
 * with an HTTP number in it.
 *
 * Nothing server-authored is passed through here, deliberately: there is no branch on this
 * endpoint that produces prose, so a rule like "print it if it looks like a sentence" would be
 * guessing about a string that is never a sentence.
 *
 * A plan gate is handled OUTSIDE this function, by PlanGateNotice, because "your plan does not
 * include this" must not be rendered in the same red box as "something broke" — they have
 * different next steps and only one of them is worth money.
 */
function checkoutErrorCopy(error: unknown): string {
  if (isOrgAdminRefusal(error)) return orgAdminMessage();
  return "Could not start checkout. Please try again, or contact support if it keeps happening.";
}

/** The upgrade block's failure line — amber upsell for a gate, red box for a malfunction. */
function CheckoutFailure({ error }: { error: unknown }) {
  if (isPlanGate(error)) {
    return <PlanGateNotice error={error} capability="This plan change" />;
  }
  return (
    <p role="alert" data-testid="checkout-error" style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
      {checkoutErrorCopy(error)}
    </p>
  );
}

// Derived annual save-% for the upgrade toggle (uniform across the paid ladder
// today; sourced from plans.ts so it self-corrects if a yearly amount is ever
// repriced — see the annual-billing note above ANNUAL_BILLING_ENABLED there,
// which records that `priceYearly` now holds the actual live Stripe yearly list
// prices).
const ANNUAL_SAVE_PERCENT = yearlySavePercent(PLAN_BY_ID.growth);

// Plan presentation is derived from the shared plan ladder (src/lib/plans.ts)
// so the in-app billing card never drifts from the pricing page or ROI tool.
const PLAN_META = Object.fromEntries(
  Object.values(PLAN_BY_ID).map((p) => [
    p.id,
    { label: p.name, color: p.color },
  ]),
) as Record<BillingPlan, { label: string; color: string }>;

const CHECKOUT_PLANS: BillingPlan[] = CHECKOUT_PLAN_IDS;
// Lowercase: it is read mid-sentence ("Your trial has ended.").
const TRIAL_NAME = PLAN_BY_ID.pilot.name.toLowerCase();

/**
 * True when the SERVER says this workspace cannot process orders.
 *
 * Derived from `canProcessOrders` and nothing else. A plan-name check is what caused
 * the defect this replaces: every blocking surface on this screen was written as
 * `status.plan === "pilot" && …`, so a paid workspace whose card was declined saw a
 * healthy plan card and no banner at all — while every ingest path refused.
 *
 * The backend computes the flag (StripeBillingService.GetStatusAsync) as:
 *   • Enterprise → !IsReadOnlyStatus(accountStatus)
 *   • Pilot      → statusAllowsProcessing && !isTrialExpired && !isOrderLimitReached
 *   • paid plan  → statusAllowsProcessing
 * where statusAllowsProcessing is membership of the ALLOWLIST {trialing, active}.
 * That allowlist shape is why this predicate is safe against a status nobody has
 * seen yet: an unrecognised account status is not "fine", it is paused, and it
 * arrives here already false rather than falling through to a healthy render.
 */
function isProcessingPaused(status: BillingStatus): boolean {
  return !status.canProcessOrders;
}

/**
 * What to tell a workspace whose processing is paused.
 *
 * MOVED to `@/lib/billingPause` — it is no longer this screen's private copy. The order
 * review panel disables its recovery POSTs for the same server fact (`canProcessOrders`)
 * and has to name the same cause, and two definitions of "why your account is paused" is
 * how one of them ends up saying "Your Pilot has ended" to a past-due Operations org.
 *
 * Re-exported here so this screen's existing importers keep their import path.
 */
export { pausedCauseCopy };

/**
 * The consequence, shared by every cause and deliberately identical in substance to the
 * cancellation disclosure further down this file and to the /pricing copy: name the
 * channels, and say what happens to each: refused, or paused with the files left in place. A customer who thinks the
 * documents are queueing up somewhere will not tell their senders.
 */
const PAUSED_CONSEQUENCE =
  "New documents aren't being accepted — uploads, emailed documents and the file API all refuse, and mailbox, SFTP, FTP, FTPS and S3 pickups pause and leave your files where they are. Tell your senders if this will take a while. Everything already processed stays readable and exportable.";

/**
 * The two conditions under which LimitBanner below prints Pilot's own paused copy.
 *
 * Exists so the hand-off between the two banners is ONE expression instead of an
 * assumption. Writing the hand-off as a bare `plan === "pilot"` would re-open the defect
 * rotated 90°: a Pilot workspace set `read_only` by an administrator BEFORE its trial
 * expires has `canProcessOrders: false` with `isTrialExpired` and `isOrderLimitReached`
 * both false — LimitBanner has nothing to say about it, and a plain plan check would have
 * sent it away from the only banner that did.
 */
function pilotLimitBannerCovers(status: BillingStatus): boolean {
  // A status that names a subscription cause is ProcessingPausedBanner's, never LimitBanner's.
  // Cancellation reverts the org to Pilot and an elapsed original trial makes `isTrialExpired`
  // true again, so without this nearly every cancelled paid customer was handed off to a banner
  // that said "Your Pilot has ended." — true months ago, and not why processing stopped today.
  // LimitBanner carries the mirror of this guard; the two must stay in lock-step or a paused
  // workspace gets two banners or none.
  if (namesSubscriptionCause(status.accountStatus)) return false;
  return status.plan === "pilot" && (status.isTrialExpired || status.isOrderLimitReached);
}

/**
 * Blocking banner for a paused workspace.
 *
 * The gate is `!canProcessOrders`. The only thing skipped is a workspace LimitBanner is
 * already speaking for — never a plan, and never a status — so a paused workspace always
 * gets exactly one banner. BillingSection.paused.test.tsx walks every plan × every account
 * status to keep that true.
 */
function ProcessingPausedBanner({
  status,
  onManage,
  managePending,
  manageError,
}: {
  status: BillingStatus;
  onManage: () => void;
  managePending: boolean;
  manageError: unknown;
}) {
  if (!isProcessingPaused(status)) return null;
  if (pilotLimitBannerCovers(status)) return null; // LimitBanner owns those two.

  const { headline, resume } = pausedCauseCopy(status.accountStatus);
  // Which route back exists for THIS workspace — a control is only offered where it
  // can do something. Enterprise is a manual agreement with no self-serve portal;
  // Pilot has no Stripe customer at all, so "Manage in Stripe" would open nothing
  // (its route is the upgrade block further down this page).
  const route =
    status.plan === "enterprise" ? "support" : status.plan === "pilot" ? "upgrade" : "stripe";
  const resumeLine =
    route === "support"
      ? "Contact support to restore processing on your agreement."
      : route === "upgrade"
        ? "Choose a plan below to resume processing."
        : resume;

  return (
    <div role="alert" style={pausedBannerStyle}>
      <strong>{headline}</strong>
      <span>{PAUSED_CONSEQUENCE}</span>
      <span>{resumeLine}</span>
      {route === "support" ? (
        <a
          href="mailto:sales@proculink.eu"
          style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "var(--danger)" }}
        >
          Contact support
        </a>
      ) : route === "upgrade" ? null : (
        <button type="button" onClick={onManage} disabled={managePending} style={pausedActionButton(managePending)}>
          {managePending ? "Opening..." : "Manage in Stripe"}
        </button>
      )}
      {/* The refusal belongs next to the control that was pressed — same rule as the
          "Change plan" button below. A member who is not an org admin cannot open the
          portal at all, and being told to "try again" about that is its own dead end. */}
      {manageError != null && (
        <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--danger)" }}>
          {portalErrorCopy(manageError)}
        </p>
      )}
    </div>
  );
}

/**
 * "Upgrade to <tier> to <do the thing>." — derived from the ladder, never typed.
 *
 * The sentence next to "You've used all 20 Pilot orders" read `Upgrade to Growth` as a literal,
 * one line below an order limit that was already being read out of `PLAN_BY_ID.pilot.orderLimit`.
 * Half a sentence derived and half hand-typed is how the two halves come to disagree — and this
 * is the same shape as the supplier-limit banner that told a 30-supplier Distributor org it had
 * one and offered it the €149 tier (CLAUDE.md §11.5).
 *
 * `next` is NULL at the top of the self-serve ladder (Distributor) and on Enterprise, and that
 * null is a real branch rather than a missing value: there is no upgrade to sell, so the copy
 * asks them to talk to us. Naming a tier there would be naming a CHEAPER one.
 */
function upgradeSentence(plan: BillingPlan, outcome: string, documentLadder: boolean): string {
  const next = nextPlanFor(plan, documentLadder);
  return next ? `Upgrade to ${PLAN_BY_ID[next].name} to ${outcome}.` : `Contact us to ${outcome}.`;
}

// Blocking banner — ONLY for Pilot, whose trial/limit really does pause
// processing (Pilot becomes read-only). A PAID plan's over-limit state is
// non-blocking and said in the plan panel's documents line — but a paid plan IS blocked
// by a non-processing account status (past_due / read_only / cancelled), which is
// ProcessingPausedBanner above. This comment used to read "Paid plans are NEVER
// blocked", which contradicted StripeBillingService's own comment and left a
// declined card entirely unreported.
//
// ── Why the second arm below is kept even though nothing can reach it ────────
// On a Pilot org the server derives the two flags from the SAME number
// (StripeBillingService.GetStatusAsync):
//     isTrialExpired      = pilot && (now > trialEndsAt || ordersUsed >= pilotOrderCap)
//     isOrderLimitReached = ordersUsed >= orderLimit
// and for a Pilot org `orderLimit` and `pilotOrderCap` are the same call —
// `GetEffectiveOrderLimit(pilot, org.OrderLimitOverride)` — so `isOrderLimitReached`
// on Pilot IMPLIES `isTrialExpired`, and the first arm always claims the workspace.
// Deleting the second arm anyway would open a hole rather than close one:
// `pilotLimitBannerCovers` hands that payload to LimitBanner and sends
// ProcessingPausedBanner away, so a paused workspace would get NO banner instead of
// exactly one — the failure the two guards are written in lock-step to prevent. It
// stays, and it states the effective allowance rather than a plan-default literal.
function LimitBanner({ status, documentLadder }: { status: BillingStatus; documentLadder: boolean }) {
  // Mirror of the guard in pilotLimitBannerCovers above. Both arms below are Pilot-shaped and
  // would speak over a subscription-level cause that ProcessingPausedBanner states correctly.
  if (namesSubscriptionCause(status.accountStatus)) return null;

  if (status.plan === "pilot" && status.isTrialExpired) {
    return (
      <div style={bannerStyle}>
        <strong>Your {TRIAL_NAME} has ended.</strong>
        <span>You can still view previous documents, but new processing is paused.</span>
      </div>
    );
  }

  // The order-cap arm. No payload the server can build reaches it today, and it is kept
  // deliberately rather than deleted — see the note above `LimitBanner`. The allowance it
  // prints is `status.orderLimit`, the EFFECTIVE limit the server already computed
  // (`admin override ?? plan default`), never `PLAN_BY_ID.pilot.orderLimit`. It used to
  // print the plan default, which is wrong in exactly the case that would make this arm
  // reachable at all: a per-org override moves the cap AND the trigger together, so an org
  // granted 100 Pilot orders would have been told it had used all 20.
  if (status.plan === "pilot" && status.isOrderLimitReached) {
    return (
      <div style={bannerStyle}>
        <strong>You&apos;ve used all {status.orderLimit.toLocaleString(NUMBER_LOCALE)} {TRIAL_NAME} documents.</strong>
        <span>{upgradeSentence(status.plan, "continue processing new documents", documentLadder)}</span>
      </div>
    );
  }

  return null;
}

const bannerStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "14px 18px",
  background: "var(--amber-soft)",
  border: "1px solid var(--amber)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--amber-text)",
};

/**
 * Danger, not amber. The Pilot banner above is amber because a trial ending is expected
 * and the workspace is doing what it said it would; this one fires when a workspace that
 * is PAYING has stopped being able to work, which is the loudest thing this screen can
 * have to say. Amber alongside an amber "approaching your limit" heads-up would read as
 * the same weight of news.
 */
const pausedBannerStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "14px 18px",
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--danger)",
};

//** One use (documents or flows): the label, "{used} of {limit}", an 8px blue bar and its sentence. */
function UseRow({ use }: { use: Use }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex justify-between gap-3">
        <span className="font-semibold">{use.label}</span>
        <span>
          <strong className="font-semibold">{use.used.toLocaleString(NUMBER_LOCALE)}</strong>
          {use.limit != null && <> of {use.limit.toLocaleString(NUMBER_LOCALE)}</>}
        </span>
      </div>
      {use.limit != null && use.barLabel && (
        <div role="img" aria-label={use.barLabel} className="h-2 overflow-hidden rounded bg-surface-2">
          <div className="h-full rounded bg-brand-blue" style={{ width: `${Math.min(100, (use.used / Math.max(1, use.limit)) * 100)}%` }} />
        </div>
      )}
      {use.sub && <p className="m-0 text-[13px] text-ink-muted">{use.sub}</p>}
    </div>
  );
}

/** Two short lines: a bold one and a muted one under it. */
function Lines({ lead, sub }: { lead: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-semibold">{lead}</p>
      <p className="m-0 text-[13px] text-ink-muted">{sub}</p>
    </div>
  );
}

const USE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-10";

/**
 * The plan panel: the plan's name as the heading, the account phrase beside it while processing,
 * the price line, what is used in words, the extra-document rate and how documents are counted.
 *
 * The heading and the tag are driven by the SERVER's `canProcessOrders`, never by the plan name.
 * `isExpired` is kept only for the one label CLAUDE.md §11.5 pins verbatim; every other paused
 * workspace, including a paid plan whose payment failed, carries "· Processing paused".
 * `accountStatusLabel` returns null for a status this build does not know, so an unknown status
 * draws no tag rather than the raw token or a reassuring guess.
 */
function PlanPanel({ status, flows }: { status: BillingStatus; flows: Use | null }) {
  const name = PLAN_BY_ID[status.plan].name;
  const isPaused = isProcessingPaused(status);
  const heading =
    status.plan === "pilot" && status.isTrialExpired
      ? `${name} ended · Processing paused`
      : isPaused
        ? `${name} · Processing paused`
        : name;
  const label = isPaused ? null : accountStatusLabel(status.accountStatus);
  const price = planLine(status, new Date());
  const extra = extraLines(status.plan);
  const uses = flows ? [documentsUse(status), flows] : [documentsUse(status)];

  return (
    <Card as="section" flush radius={12} aria-labelledby="b-plan" data-testid="plan-card">
      <div className="flex flex-col gap-5 p-6 text-[14px] text-ink max-[560px]:px-4 max-[560px]:py-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 id="b-plan" className="m-0 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.01em]">{heading}</h2>
            {label && (
              <Pill
                tone={label === "Subscription active" ? "green" : "neutral"}
                icon={label === "Subscription active" ? <Check aria-hidden size={13} strokeWidth={3} /> : undefined}
                data-testid="account-status-line"
              >
                {label}
              </Pill>
            )}
          </div>
          {price && <p className="m-0 text-[15px] text-ink-muted">{price}</p>}
        </div>
        <div className={`${USE_GRID} gap-y-5`}>
          {uses.map((u) => <UseRow key={u.label} use={u} />)}
        </div>
        <div className={`${USE_GRID} gap-y-4 border-t border-border pt-4`}>
          {extra && <Lines lead={extra[0]} sub={extra[1]} />}
          <Lines
            lead="A document counts once it has been read."
            sub={`One we couldn't read is not counted.${status.stripeCustomerId != null ? " This is a running count: your Stripe invoice is the final amount." : ""}`}
          />
        </div>
      </div>
    </Card>
  );
}

export function BillingSection() {
  const { data: status, isLoading, refetch } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    staleTime: 60_000,
    retry: false,
  });

  // Billing cadence for NEW checkouts (upgrades). Yearly is real self-serve:
  // the backend maps plan+interval to the Stripe `*YearlyPriceId`s.
  const [checkoutInterval, setCheckoutInterval] = useState<BillingInterval>("monthly");
  const engine = useDocumentEngine();
  const documentLadder = engine === "on";
  const { data: flows } = useQuery({ ...flowsQuery, enabled: documentLadder });
  // A paid plan's upgrade changes the live subscription and charges the card on file at once —
  // there is no Stripe page in between to confirm on — so it asks here first.
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);

  const checkoutMutation = useMutation({
    mutationFn: ({ plan, interval }: { plan: BillingPlan; interval: BillingInterval }) =>
      createCheckoutSession(plan, interval),
    onSuccess: (url) => { if (url) window.location.href = url; },
  });

  const portalMutation = useMutation({
    mutationFn: createPortalSession,
    onSuccess: (url) => { window.location.href = url; },
  });

  if (isLoading) return <Quiet>Loading your plan…</Quiet>;

  // A failed refresh keeps what is drawn: the failure is shown only when there is nothing to draw.
  if (!status) {
    return (
      <StatusNotice tone="error" action={<Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>}>
        We couldn&apos;t load your plan. Your documents and flows are not affected.
      </StatusNotice>
    );
  }

  const isPilot      = status.plan === "pilot";
  const isEnterprise = status.plan === "enterprise";
  const isPaid       = [...CHECKOUT_PLANS, ...DOCUMENT_PLAN_IDS].includes(status.plan);
  const nextPlan     = nextPlanFor(status.plan, documentLadder);
  // The Pilot upgrade block's ladder: the document plans with the engine, else today's legacy one.
  const ladder       = documentLadder ? DOCUMENT_PLAN_IDS : CHECKOUT_PLANS;
  // The legacy ladder is on sale only on an explicit "off"; until the engine answers, neither is.
  const pilotCheckoutDisabled = checkoutMutation.isPending || engine === "unknown";
  /**
   * Whether the Stripe Billing Portal exists for THIS workspace.
   *
   * Every "Change plan" / "Manage in Stripe" / "Edit billing email" control on this screen
   * opens `POST /api/billing/portal`, which needs a Stripe customer. The whole Payment method
   * card and the "Change plan" button were gated on `isPaid || isEnterprise` instead — a plan
   * name — so an Enterprise workspace on a manual agreement was offered a card manager, a
   * billing-email editor and a Stripe cancellation disclosure five lines below the sentence
   * "Enterprise plans use a manual agreement. Contact support to adjust volume, suppliers, SLA,
   * or connector scope." The customer found out which of the two was true by pressing the
   * button and reading "No billing customer on file."
   *
   * `stripeCustomerId` was on the payload the whole time and this component never read it. It
   * is the fact these controls depend on, so it is the fact they are gated on — an Enterprise
   * org that IS billed through Stripe keeps its portal, and a paid plan that somehow has no
   * customer record stops being sent to one.
   */
  const hasStripePortal = status.stripeCustomerId != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* First thing on the screen, because it is the reason nothing is working.
          This is the sentence the old system-status page's "Go to billing" link
          used to promise ("Sending resumes automatically once your billing is up
          to date"). */}
      <ProcessingPausedBanner
        status={status}
        onManage={() => portalMutation.mutate()}
        managePending={portalMutation.isPending}
        manageError={portalMutation.isError ? portalMutation.error : null}
      />
      <LimitBanner status={status} documentLadder={documentLadder} />
      <PlanPanel
        status={status}
        flows={documentLadder && flows ? flowsUse(flows.length, PLAN_BY_ID[status.plan].flowLimit) : null}
      />

      {/* ── Upgrade / change plan actions ── */}
      {isPilot && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ borderRadius: 10, padding: "13px 15px", background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand-green)", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
            <strong style={{ color: "var(--ink)" }}>{documentLadder ? "Upgrade when this is ready for daily use." : "Upgrade when this is ready for daily orders."}</strong>{" "}
            {documentLadder
              ? "Every paid plan includes every channel, output and check. Plans differ by documents per month and number of flows."
              : "Growth keeps the same workflow but raises your monthly document allowance, adds more suppliers, and keeps processing open after your trial ends."}
          </div>
          <IntervalToggle value={checkoutInterval} onChange={setCheckoutInterval} disabled={checkoutMutation.isPending} />
          <button
            onClick={() => checkoutMutation.mutate({ plan: ladder[0], interval: checkoutInterval })}
            disabled={pilotCheckoutDisabled}
            style={primaryButton("var(--brand-green-btn)", pilotCheckoutDisabled)}
          >
            {status.isTrialExpired || status.isOrderLimitReached ? "Upgrade to continue" : `Upgrade to ${PLAN_META[ladder[0]].label}`}
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ladder.slice(1).map((plan) => (
              <button
                key={plan}
                onClick={() => checkoutMutation.mutate({ plan, interval: checkoutInterval })}
                disabled={pilotCheckoutDisabled}
                style={secondaryButton(PLAN_META[plan].color, pilotCheckoutDisabled)}
              >
                {PLAN_META[plan].label}
              </button>
            ))}
          </div>
          {checkoutMutation.isError && <CheckoutFailure error={checkoutMutation.error} />}
          <a href="mailto:sales@proculink.eu" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
            Need Enterprise? Contact sales
          </a>
          <a
            href={BOOK_DEMO_URL}
            {...BOOK_DEMO_LINK_ATTRS}
            onClick={() => capture("book_demo_clicked", { from_route: "/settings", plan: "pilot" })}
            style={{
              marginTop: 4,
              alignSelf: "flex-start",
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--border-strong)",
              borderLeft: "3px solid var(--brand-green)",
              borderRadius: 8,
              padding: "9px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Book a demo →
          </a>
        </div>
      )}

      {isPaid && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ borderRadius: 10, padding: "13px 15px", background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
            Plan changes update order and supplier limits immediately after Stripe confirms the subscription. Existing orders, mappings, and delivery logs stay available.
          </div>
          {nextPlan && (
            <>
              <IntervalToggle value={checkoutInterval} onChange={setCheckoutInterval} disabled={checkoutMutation.isPending} />
              {confirmingUpgrade ? (
                <Card pad="13px 15px" radius={10} role="group" aria-label={`Confirm upgrade to ${PLAN_META[nextPlan].label}`} style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
                  <span>
                    <strong style={{ color: "var(--ink)" }}>
                      Upgrade to {PLAN_META[nextPlan].label} at {billingPriceLabelFor(PLAN_BY_ID[nextPlan], checkoutInterval)}?
                    </strong>{" "}
                    Your card on file is charged today. A new billing period starts today, and the unused part of your current plan is credited on that charge.
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => checkoutMutation.mutate({ plan: nextPlan, interval: checkoutInterval })}
                      disabled={checkoutMutation.isPending}
                      style={secondaryButton(PLAN_META[nextPlan].color, checkoutMutation.isPending)}
                    >
                      {checkoutMutation.isPending ? "Upgrading..." : "Upgrade now"}
                    </button>
                    <button
                      onClick={() => setConfirmingUpgrade(false)}
                      disabled={checkoutMutation.isPending}
                      style={{ ...secondaryButton(PLAN_META[nextPlan].color, checkoutMutation.isPending), border: "1px solid var(--border-strong)", color: "var(--ink)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </Card>
              ) : (
              <button
                onClick={() => setConfirmingUpgrade(true)}
                style={secondaryButton(PLAN_META[nextPlan].color, false)}
              >
                {/* PLAN_META[nextPlan].label, not the wire value with its first letter forced
                    upper. That capitalise-the-id trick is the pattern plans.ts:437-453 records
                    as the bug that printed `Acme · distributor` to a €1,499/month customer: it
                    agrees with the ladder only by coincidence of today's six names, and the
                    tier's own name is already in scope one line above. */}
                Need more volume? Upgrade to {PLAN_META[nextPlan].label}.
              </button>
              )}
            </>
          )}
          {checkoutMutation.isError && <CheckoutFailure error={checkoutMutation.error} />}
        </div>
      )}

      {isEnterprise && (
        <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>
          Enterprise plans use a manual agreement. Contact support to adjust volume, suppliers, SLA, or connector scope.
        </p>
      )}

      {/* A paid plan with no Stripe customer has no portal either, and unlike Enterprise it has
          no sentence of its own saying where to go. Without this it would simply lose the whole
          Payment method card and be left with nothing. */}
      {isPaid && !isEnterprise && !hasStripePortal && (
        <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>
          Billing for this workspace isn&apos;t linked to a self-serve Stripe account, so card and
          invoice details are handled by us.{" "}
          <a href="mailto:sales@proculink.eu" style={{ color: "inherit", fontWeight: 600 }}>
            Contact support
          </a>{" "}
          to change your plan or payment details.
        </p>
      )}

      {/* ── Payment method — managed in Stripe (canonical structure, real binding) ── */}
      {hasStripePortal && (
        <Card flush radius="var(--radius-md)">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em", color: "var(--ink)" }}>Payment method</div>
          </div>
          <div style={{ padding: "0 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Card &amp; billing details</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Managed in Stripe</div>
              </div>
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 34, padding: "0 14px", border: "1px solid var(--border-strong)",
                  borderRadius: 8, background: "var(--surface)", color: "var(--ink)",
                  fontSize: 12.5, fontWeight: 600, cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                  opacity: portalMutation.isPending ? 0.6 : 1, flexShrink: 0,
                }}
              >
                {portalMutation.isPending ? "Opening..." : "Manage in Stripe"}
              </button>
            </div>
            {/* Billing email row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 0" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Billing email</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Update via the Stripe portal</div>
              </div>
              <button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                style={{
                  height: 27, padding: "0 10px",
                  background: "transparent", border: "none",
                  color: "var(--ink-muted)", fontSize: 12, fontWeight: 600,
                  cursor: portalMutation.isPending ? "not-allowed" : "pointer",
                }}
              >
                Edit
              </button>
            </div>
          </div>
          {portalMutation.isError && (
            <div style={{ padding: "0 16px 12px" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {portalErrorCopy(portalMutation.error)}
              </p>
            </div>
          )}
          {/*
            Cancelling happens THROUGH this button — the Stripe portal is where a paid customer
            ends their subscription, and Stripe cannot tell them what it does to their ProcuLink
            workspace. /pricing carries this disclosure, but a customer cancelling is in Settings,
            not on the marketing site, so the warning has to be at the point of action too. The
            wording deliberately matches the /pricing copy and, like it, names the channels and
            avoids the internal status name.
          */}
          <div style={{ padding: "0 18px 14px" }}>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.55 }}>
              If you cancel in Stripe, new documents stop arriving once the subscription ends — uploads,
              emailed documents and the file API all stop, and mailbox, SFTP, FTP, FTPS and S3 pickups pause and
              leave your files where they are, so tell your senders first. Everything already processed stays
              readable and exportable.
            </p>
          </div>
        </Card>
      )}

      {/* Pilot: no payment method section (not yet a customer) */}
    </div>
  );
}

// Monthly/Annual cadence picker for new checkouts. The chosen interval is
// passed straight through createCheckoutSession → POST /api/billing/checkout
// { plan, billingInterval } → the Stripe `*YearlyPriceId` on "yearly".
function IntervalToggle({ value, onChange, disabled }: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  disabled: boolean;
}) {
  const options: Array<{ id: BillingInterval; label: string }> = [
    { id: "monthly", label: "Monthly" },
    { id: "yearly",  label: `Annual${ANNUAL_SAVE_PERCENT != null ? ` · save ${ANNUAL_SAVE_PERCENT}%` : ""}` },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div role="group" aria-label="Billing period" style={{ display: "inline-flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              disabled={disabled}
              style={{
                border: "none", borderRadius: 6, padding: "6px 13px",
                fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--ink)" : "var(--ink-muted)",
                boxShadow: on ? "0 1px 2px rgba(11,26,47,0.08)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {value === "yearly" && (
        <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Billed once per year</span>
      )}
    </div>
  );
}

function primaryButton(background: string, disabled: boolean): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background,
    color: "var(--surface)",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 2px rgba(11,26,47,0.06)",
  };
}

/**
 * The paused banner's route back. A helper rather than an inline object so the button
 * carries no `style={{ background: … }}` of its own — check-tokens' inline-button-bg
 * rule, which this file is already at its baseline for.
 */
function pausedActionButton(disabled: boolean): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    marginTop: 4,
    minHeight: 34,
    padding: "0 14px",
    borderRadius: 8,
    border: "1px solid var(--danger)",
    background: "var(--surface)",
    color: "var(--danger)",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryButton(color: string, disabled: boolean): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    background: `${color}12`,
    border: `1px solid ${color}35`,
    borderRadius: 7,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
