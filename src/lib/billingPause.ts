/**
 * billingPause.ts — what to tell a workspace the SERVER has stopped processing for.
 *
 * Extracted verbatim from BillingSection.tsx (which still re-exports it) because a
 * second surface now needs the same sentences: OrderProblemPanel disables its
 * recovery POSTs for a read-only workspace, and a disabled button whose reason is
 * written somewhere else is how the two drift apart. One definition, two readers.
 *
 * Deliberately dependency-free — no React, no "use client" — so a copy module can
 * import it without pulling a client component graph behind it.
 */

/**
 * What to tell a workspace whose processing is paused.
 *
 * Keyed on `accountStatus` for the headline and the route back, with a fallback arm
 * that names the pause without inventing a cause. The consequence paragraph is shared,
 * because the consequence really is identical across causes — it is `canProcessOrders`
 * that every ingest path checks, not the particular status behind it.
 *
 * ⚠ `read_only` is DELIBERATELY vague about the cause, and must stay that way.
 * StripeBillingMapping.MapStatusToAccountStatus folds THREE different Stripe states into
 * it — `paused`, `canceled`, and (via BillingController's subscription-deleted arm) a
 * deleted subscription. "Your subscription has ended" would be a guess on a paused
 * subscription, and a guess about someone's money is the same class of defect as the
 * silence it replaces. It says the subscription is not active, which is true of all three,
 * and sends them to the portal to see which.
 *
 * The resume promise is per-cause for the same reason. `past_due` really does resume by
 * itself (the recovered-payment webhook flips the org back to active and
 * ReleaseBillingHeldOrdersAsync re-drives every held order); a cancelled subscription
 * does not, and telling that customer to sit and wait would strand them.
 */
/**
 * A short human phrase for an `accountStatus`, or null when this build has no phrase for it.
 *
 * WHY THIS EXISTS. `BillingSection`'s plan card printed the raw value with its underscores
 * swapped for spaces — `status.accountStatus.replaceAll("_", " ")` — and a Pilot workspace on
 * live production read the literal word **trialing** back to its customer. Hiding the line
 * while paused (the previous repair) only covered the statuses that already had a banner
 * saying it in words; every OTHER value still arrived on screen as the database wrote it.
 * `trialing` and `active` are the two a healthy workspace sees, so the raw token was in fact
 * the NORMAL rendering, not the edge case.
 *
 * `pausedCauseCopy` below cannot answer this question. Its `default:` arm says processing is
 * paused, which is the correct thing to say about an unrecognised status ON A WORKSPACE THE
 * SERVER HAS ALREADY REFUSED, and a flat lie about a healthy one — so a healthy `trialing`
 * account routed through it would be told its orders had stopped. Two different questions,
 * two functions; this one is only ever asked about a workspace that is still processing.
 *
 * NULL IS A REAL ANSWER, and it is the one an unknown value gets. The alternatives are both
 * defects this repo has shipped before: printing the token (the bug above) or falling through
 * to a reassuring phrase (`unknown renders as success`). A status this build has never heard
 * of gets no phrase, and the caller renders nothing — the plan name, the price and the usage
 * bars are all still there, so nothing is hidden except a word nobody could act on.
 */
export function accountStatusLabel(accountStatus: string | null | undefined): string | null {
  switch (accountStatus) {
    case "active":
      return "Subscription active";
    case "trialing":
      return "Trial in progress";
    case "past_due":
      return "Payment overdue";
    case "cancelled":
      return "Subscription ended";
    // Deliberately vague, for the same reason pausedCauseCopy's `read_only` arm is:
    // MapStatusToAccountStatus folds `paused`, `canceled` and a deleted subscription into
    // this one value, so naming a cause here would be a guess about someone's money.
    case "read_only":
      return "Subscription not active";
    case "trial_expired":
      return "Trial ended";
    default:
      return null;
  }
}

/**
 * The account statuses whose `pausedCauseCopy` headline names a SUBSCRIPTION-level cause —
 * a payment that failed, a subscription that ended, one that is not active. Kept beside that
 * switch so the two cannot drift: if a status is added there with a subscription sentence, it
 * belongs here too.
 *
 * Exists because a cancelled paid workspace was being told **"Your Pilot has ended."**
 * Cancellation reverts the org to Pilot (`HandleSubscriptionDeletedAsync`), and any workspace
 * whose original 14 days have elapsed reports `isTrialExpired: true` again — so the Pilot
 * limit banner, gated on `plan === "pilot" && isTrialExpired`, claimed nearly every cancelled
 * customer and hid the real reason. Their trial ending months ago is not why processing
 * stopped today.
 *
 * The backend already draws this distinction deliberately and expects the client to honour it:
 * `StripeBillingService.MarkPilotExpiredIfNeededAsync` returns early on ReadOnly with the
 * comment *"ReadOnly is a paid-plan terminal state (e.g. cancelled) — not ours to flip here."*
 *
 * `trial_expired` is NOT here: that one really is the Pilot's own cause, and the Pilot banner
 * should keep speaking for it.
 */
const SUBSCRIPTION_CAUSE_STATUSES = new Set(["past_due", "cancelled", "read_only"]);

/**
 * True when `accountStatus` names a subscription-level pause cause, so a plan-shaped banner
 * must not speak over it.
 */
export function namesSubscriptionCause(accountStatus: string): boolean {
  return SUBSCRIPTION_CAUSE_STATUSES.has(accountStatus);
}

export function pausedCauseCopy(accountStatus: string): {
  headline: string;
  resume: string;
} {
  switch (accountStatus) {
    case "past_due":
      return {
        headline: "Your last payment didn't go through.",
        resume:
          "Update your payment details in Stripe — processing restarts on its own once the payment clears, and any orders waiting on it go out then.",
      };
    case "cancelled":
      return {
        headline: "Your subscription has ended.",
        resume: "Start a plan again in Stripe to resume processing.",
      };
    case "read_only":
      return {
        headline: "Your subscription isn't active.",
        resume:
          "Open the billing portal to see whether it is paused or ended, and to restart it. Processing restarts on its own once the subscription is active again.",
      };
    case "trial_expired":
      return {
        headline: "Your trial has ended.",
        resume: "Choose a plan in Stripe to resume processing.",
      };
    default:
      // An account status this build does not recognise. Say what is certainly true —
      // the server refused processing — and do not narrate a cause or a mechanism.
      return {
        headline: "Order processing is paused on your account.",
        resume: "Open the billing portal to check your subscription, or contact support.",
      };
  }
}
