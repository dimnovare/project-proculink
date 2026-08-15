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
