"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
} from "@/lib/api-client";
import { useRef, useState } from "react";
import type { BillingPlan, BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID, CHECKOUT_PLAN_IDS, DOCUMENT_PLAN_IDS, nextPlanFor } from "@/lib/plans";
import { useDocumentEngine, flowsQuery } from "@/hooks/useDocumentEngine";
import { isOrgAdminRefusal } from "@/lib/planGate";
import { COPY } from "@/lib/documentRefusals";
import { accountStatusLabel, pausedCauseCopy, namesSubscriptionCause } from "@/lib/billingPause";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, Pill, buttonClass } from "@/components/bridge/DSPrimitives";
import { Quiet } from "@/components/flows/states";
import { SettingsPanel } from "@/components/settings/SettingsPrimitives";
import { isPlanGate, PlanGateNotice } from "@/components/bridge/PlanGateNotice";
import { NUMBER_LOCALE } from "@/lib/format-number";
import {
  changePlanRows, documentsUse, euro, extraLines, flowsUse, monthsFree, planLine, priceWords, type Use,
} from "@/lib/billingWords";
import { Check } from "lucide-react";

type BillingInterval = "monthly" | "yearly";

/**
 * What to tell someone whose "Manage in Stripe" click was refused.
 *
 * The button opens the Stripe Billing Portal, which is where a subscription is cancelled, so
 * the backend restricts it to organisation administrators. Every failure here used to resolve
 * to one of two hardcoded sentences and the server's reason was discarded, which meant an
 * ordinary member was told "Please try again" about the one thing retrying can never fix.
 *
 * The role refusal is checked FIRST and never falls through to the retry copy, and it says the
 * one sentence Settings uses for that refusal everywhere (14.7a R14). It is also not a plan
 * problem, so nothing here offers an upgrade: this person's organisation may well be on the
 * right plan already.
 */
function portalErrorCopy(error: unknown): string {
  if (isOrgAdminRefusal(error)) return COPY.requires_org_admin;
  if (error instanceof Error && error.message.toLowerCase().includes("customer")) {
    return "No billing customer on file. Contact support to link your account.";
  }
  return "Could not open billing portal. Please try again or contact support.";
}

/**
 * The same question for the CHECKOUT button, which had no answer at all.
 *
 * The upgrade blocks used to render
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
  if (isOrgAdminRefusal(error)) return COPY.requires_org_admin;
  return "Could not start checkout. Please try again, or contact support if it keeps happening.";
}

/** The upgrade block's failure line — amber upsell for a gate, red box for a malfunction. */
function CheckoutFailure({ error }: { error: unknown }) {
  if (isPlanGate(error)) {
    return <PlanGateNotice error={error} capability="This plan change" />;
  }
  return (
    <p role="alert" data-testid="checkout-error" style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>
      {checkoutErrorCopy(error)}
    </p>
  );
}

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
      {/* The way back is the one filled control on a paused screen. */}
      {route === "support" ? (
        <a href="mailto:sales@proculink.eu" className={`${buttonClass("primary")} mt-1 self-start`}>
          Contact support
        </a>
      ) : route === "upgrade" ? null : (
        <Button variant="primary" className="mt-1 self-start" onClick={onManage} disabled={managePending}>
          {managePending ? "Opening..." : "Manage in Stripe"}
        </Button>
      )}
      {/* The refusal belongs next to the control that was pressed — same rule as the
          "Manage in Stripe" button below. A member who is not an org admin cannot open the
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
      {use.sub && <p className={`m-0 text-[13px] ${use.warn ? "font-semibold text-amber-text" : "text-ink-muted"}`}>{use.sub}</p>}
    </div>
  );
}

/** Two short lines: a bold one and a muted one under it. */
function Lines({ lead, sub }: { lead: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-semibold">{lead}</p>
      {sub && <p className="m-0 text-[13px] text-ink-muted">{sub}</p>}
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
  const extra = extraLines(status.plan, !status.canProcessOrders);
  const uses = flows ? [documentsUse(status), flows] : [documentsUse(status)];

  return (
    <Card as="section" flush radius={12} aria-labelledby="b-plan" data-testid="plan-card">
      <div className="flex flex-col gap-5 p-6 text-[14px] text-ink max-[560px]:px-4 max-[560px]:py-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 id="b-plan" className="m-0 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.01em]">{heading}</h2>
            {label && (
              <Pill
                tone={status.accountStatus === "active" ? "green" : "neutral"}
                icon={status.accountStatus === "active" ? <Check aria-hidden size={13} strokeWidth={3} /> : undefined}
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
  const { data: status, isLoading, isFetching, refetch } = useQuery<BillingStatus>({
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
  const [confirming, setConfirming] = useState<BillingPlan | null>(null);
  const sending = useRef(false);
  const opening = useRef(false);

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
      <StatusNotice tone="error" action={<Button variant="secondary" size="sm" loading={isFetching} onClick={() => refetch()}>Retry</Button>}>
        We couldn&apos;t load your plan. Your documents and flows are not affected.
      </StatusNotice>
    );
  }

  const isTrial      = status.plan === "pilot";
  const isEnterprise = status.plan === "enterprise";
  const isPaid       = [...CHECKOUT_PLAN_IDS, ...DOCUMENT_PLAN_IDS].includes(status.plan);
  const rows         = changePlanRows(status.plan, engine);
  const upgrades     = rows.filter((r) => r.state === "upgrade");
  // A paid plan is sold only the next plan up, as on main; a trial is sold any plan on Stripe's page.
  const offered      = nextPlanFor(status.plan, documentLadder);
  // The one filled button: the upgrade on offer, unless processing is paused on a paid plan,
  // where the way back to payment (in the banner) is the filled one.
  const main         = isTrial || status.canProcessOrders ? offered : null;
  const months       = upgrades.length ? monthsFree((upgrades.find((r) => r.plan.id === offered) ?? upgrades[0]).plan) : null;
  const top          = rows.at(-1)?.plan.orderLimit;
  /**
   * Whether the Stripe Billing Portal exists for THIS workspace.
   *
   * "Manage in Stripe" opens `POST /api/billing/portal`, which needs a Stripe customer. These
   * controls used to be gated on a plan name, so an Enterprise workspace on a manual agreement
   * was offered a card manager and a Stripe cancellation disclosure beside the sentence saying
   * its plan was a manual agreement, and found out which was true by pressing the button and
   * reading "No billing customer on file." `stripeCustomerId` is the fact these controls depend
   * on, so it is the fact they are gated on: an Enterprise org that IS billed through Stripe
   * keeps its portal, and a paid plan that has no customer record is not sent to one.
   */
  const hasStripePortal = status.stripeCustomerId != null;

  // One request per press: the mutation's pending state reaches the button a render later.
  const send = (plan: BillingPlan) => {
    if (sending.current) return;
    sending.current = true;
    checkoutMutation.mutate({ plan, interval: checkoutInterval }, { onSettled: () => { sending.current = false; } });
  };
  const openPortal = () => {
    if (opening.current) return;
    opening.current = true;
    portalMutation.mutate(undefined, { onSettled: () => { opening.current = false; } });
  };

  const confirmPlan = confirming ? PLAN_BY_ID[confirming] : null;
  const confirmPrice = confirmPlan ? priceWords(confirmPlan, checkoutInterval) : null;
  // Main's conditions: a trial always, a paid plan when it has a next plan to buy.
  const showPeriod = isTrial || (isPaid && offered != null);
  const showPay = hasStripePortal || isEnterprise || isPaid;

  return (
    <div className="flex flex-col gap-5 text-[14px] text-ink">
      {/* First thing on the screen, because it is the reason nothing is working.
          This is the sentence the old system-status page's "Go to billing" link
          used to promise ("Sending resumes automatically once your billing is up
          to date"). */}
      <ProcessingPausedBanner
        status={status}
        onManage={openPortal}
        managePending={portalMutation.isPending}
        manageError={portalMutation.isError ? portalMutation.error : null}
      />
      <LimitBanner status={status} documentLadder={documentLadder} />

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_868px] flex-col gap-4">
          <PlanPanel
            status={status}
            flows={documentLadder && flows ? flowsUse(flows.length, PLAN_BY_ID[status.plan].flowLimit) : null}
          />

          {(rows.length > 0 || isTrial) && (
            <SettingsPanel
              id="b-change"
              title="Change plan"
              sub={rows[0] && DOCUMENT_PLAN_IDS.includes(rows[0].plan.id)
                ? "Every paid plan has every way in, every output and every check. Plans differ only by documents a month and flows."
                : undefined}
            >
              {rows.length === 0 ? (
                // The legacy ladder is on sale only on an explicit "off"; until the engine answers, neither is.
                <Quiet>Loading plans…</Quiet>
              ) : (
                <>
                  <div className="border-b border-border">
                    {rows.map(({ plan, state }) => (
                      <div key={plan.id} className={ROW}>
                        <span className={`col-start-1 row-start-1 text-[15px] font-semibold ${CELL}`}>{plan.name}</span>
                        {/* "Your plan" is priced by the period the server bills; the others by the toggle. */}
                        <span className={`col-start-2 row-start-1 justify-self-end font-semibold ${CELL}`}>
                          {priceWords(plan, state === "current" ? status.billingInterval ?? "monthly" : checkoutInterval)}
                        </span>
                        <span className={`col-span-2 row-start-2 ${CELL}`}>{plan.orderLimit?.toLocaleString(NUMBER_LOCALE)} documents a month</span>
                        <span className={`col-start-1 row-start-3 ${CELL}`}>{plan.flowLimit == null ? "Unlimited flows" : `${plan.flowLimit.toLocaleString(NUMBER_LOCALE)} flows`}</span>
                        <span className={`col-start-2 row-start-3 justify-self-end ${CELL}`}>{plan.overageEur != null && `${euro(plan.overageEur)} each extra`}</span>
                        {(state === "current" || (state === "upgrade" && (isTrial || plan.id === offered))) && (
                          <span className={`col-span-2 row-start-4 mt-2 min-[940px]:mt-0 ${CELL}`}>
                            {state === "current" ? (
                              <Pill tone="neutral">Your plan</Pill>
                            ) : (
                              <Button
                                // While a confirm is open, its "Upgrade now" is the filled one.
                                variant={plan.id === main && !confirming ? "primary" : "secondary"}
                                className="w-full"
                                disabled={checkoutMutation.isPending}
                                // A trial confirms on Stripe's page; a paid plan's upgrade changes the live
                                // subscription and charges the card on file at once, so it asks here first.
                                onClick={() => (isTrial ? send(plan.id) : setConfirming(plan.id))}
                              >
                                Upgrade to {plan.name}
                              </Button>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {confirmPlan && (
                    <Card pad="13px 15px" radius={10} role="group" aria-label={`Confirm upgrade to ${confirmPlan.name}`} className="flex flex-col gap-2.5 text-[13px] text-ink-muted">
                      <span>
                        <strong className="text-ink">Upgrade to {confirmPlan.name}{confirmPrice && ` at ${confirmPrice}`}?</strong>{" "}
                        Your card on file is charged today. A new billing period starts today, and the unused part of your current plan is credited on that charge.
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button variant={main ? "primary" : "secondary"} autoFocus onClick={() => send(confirmPlan.id)} disabled={checkoutMutation.isPending}>
                          {checkoutMutation.isPending ? "Upgrading..." : "Upgrade now"}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)} disabled={checkoutMutation.isPending}>Cancel</Button>
                      </div>
                    </Card>
                  )}
                  {checkoutMutation.isError && <CheckoutFailure error={checkoutMutation.error} />}
                  {top != null && (
                    <p className="m-0 text-[13px] text-ink-muted">
                      {status.stripeSubscriptionId != null && "An upgrade starts straight away: a new billing period begins that day, and the unused part of your current plan is credited. "}
                      {isTrial ? "Need" : "Moving to a smaller plan, or need"} more than {top.toLocaleString(NUMBER_LOCALE)} documents a month?{" "}
                      <a href="mailto:sales@proculink.eu" className="font-semibold">Contact us</a>.
                    </p>
                  )}
                </>
              )}
            </SettingsPanel>
          )}
        </div>

        {(showPay || showPeriod) && (
          <aside className="flex min-w-0 max-w-[420px] flex-[1_1_320px] flex-col gap-4">
            {showPay && (
              <SettingsPanel id="b-pay" title="Payment and invoices" sub={hasStripePortal ? "Your card, billing email and invoices are kept in Stripe." : undefined}>
                {isEnterprise && (
                  <p className="m-0 text-[14px] text-ink-muted">
                    Your plan is a manual agreement. <a href="mailto:sales@proculink.eu" className="font-semibold">Contact support</a> to change it.
                  </p>
                )}
                {hasStripePortal ? (
                  <>
                    <Button variant="secondary" className="self-start" onClick={openPortal} disabled={portalMutation.isPending}>
                      {portalMutation.isPending ? "Opening..." : "Manage in Stripe"}
                    </Button>
                    {portalMutation.isError && (
                      <p role="status" className="m-0 text-[13px] text-danger-text">{portalErrorCopy(portalMutation.error)}</p>
                    )}
                  </>
                ) : isPaid && !isEnterprise && (
                  // A paid plan with no Stripe customer has no portal, so it is told where to go instead.
                  <p className="m-0 text-[14px] text-ink-muted">
                    Billing for this workspace isn&apos;t linked to a self-serve Stripe account, so card and
                    invoice details are handled by us.{" "}
                    <a href="mailto:sales@proculink.eu" className="font-semibold">Contact support</a>{" "}
                    to change your plan or payment details.
                  </p>
                )}
              </SettingsPanel>
            )}
            {showPeriod && (
              // R12: the period for a plan change only; it feeds the upgrade buttons and the row prices.
              // Switching the current subscription between monthly and annual is not offered here.
              <SettingsPanel id="b-period" title="Billing period">
                <div role="radiogroup" aria-labelledby="b-period" className="inline-flex self-start rounded-[10px] bg-surface-2 p-[3px]">
                  {(["monthly", "yearly"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={checkoutInterval === id}
                      disabled={checkoutMutation.isPending}
                      onClick={() => setCheckoutInterval(id)}
                      className={`h-10 rounded-lg px-4 text-[14px] disabled:cursor-not-allowed ${checkoutInterval === id ? "bg-surface font-semibold text-ink shadow-[var(--shadow-card)]" : "bg-transparent font-medium text-ink-muted"}`}
                    >
                      {id === "monthly" ? "Monthly" : "Annual"}
                    </button>
                  ))}
                </div>
                {months != null && <p className="m-0 text-[13px] text-ink-muted">Annual gives you {months} months free, billed once a year.</p>}
              </SettingsPanel>
            )}
          </aside>
        )}
      </div>

      {/* Cancelling happens in the Stripe portal, and Stripe cannot tell a customer what it does to
          their ProcuLink workspace, so the warning is at the point of action as well as on /pricing.
          It names the channels and avoids the internal status name. */}
      {hasStripePortal && (
        <section aria-labelledby="b-cancel" className="flex flex-wrap gap-x-12 gap-y-2 border-t border-border pt-5">
          <h2 id="b-cancel" className="m-0 flex-[0_1_200px] text-[16px] font-semibold leading-[1.3]">If you cancel</h2>
          <div className="flex min-w-0 max-w-[800px] flex-[1_1_420px] flex-col gap-1.5 text-[13.5px] text-ink-muted">
            <p className="m-0">If you cancel in Stripe, new documents stop arriving once the subscription ends.</p>
            <p className="m-0">Uploads, emailed documents and the file API all stop. Mailbox, SFTP, FTP, FTPS and S3 pickups pause and leave your files where they are, so tell your senders first.</p>
            <p className="m-0">Everything already processed stays readable and exportable.</p>
          </div>
        </section>
      )}
    </div>
  );
}

/** A "Change plan" row: one grid line from 940px, the board's four-line stack below it. */
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border py-4 " +
  "min-[940px]:min-h-16 min-[940px]:grid-cols-[minmax(72px,0.8fr)_minmax(104px,1fr)_minmax(188px,1.6fr)_minmax(104px,1fr)_minmax(116px,1.1fr)_176px] min-[940px]:gap-y-1 min-[940px]:py-2";
/** Each cell takes its place in the stack, and its own column again from 940px. */
const CELL = "min-w-0 min-[940px]:col-auto min-[940px]:row-auto min-[940px]:justify-self-auto";

