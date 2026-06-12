// buildChecklistSteps — pure derivation of the onboarding checklist model from
// the GET /api/onboarding/status payload. No React, no fetching — unit-tested
// in buildChecklistSteps.test.ts.
//
// Six server-verified steps (all signals sample-excluded on the backend):
//   1 supplier  — hasSupplier
//   2 catalog   — hasCatalog || hasItemMappings           (locked until 1)
//   3 upload    — hasUpload                               (locked until 1)
//   4 resolve   — hasResolvedMapping                      (locked until 3)
//   5 delivery  — (hasDeliveryConfig && hasTestFired) || hasDelivery (locked until 1)
//   6 send      — hasDelivery                             (locked until 3, 4, 5-config)
//
// Honesty rules:
//   • Extended fields are OPTIONAL (backend may predate them). A step whose
//     done-signal is entirely ABSENT from the payload is OMITTED — treated as
//     "unknown", never rendered as fabricated "not done". A legacy 4-boolean
//     payload therefore yields the legacy 4 steps (supplier/upload/resolve/send).
//   • Step 5 intermediate state: config saved but no successful test-fire →
//     "Configured — send a test to finish" with a "Send a test" CTA. A real
//     delivery counts the step done (no nagging for a redundant test).

import type { OnboardingStatus } from "@/types/procurement";
import { ACCEPTED_UPLOAD_FORMATS } from "@/lib/upload-formats";

export type ChecklistStepId =
  | "supplier"
  | "catalog"
  | "upload"
  | "resolve"
  | "delivery"
  | "send";

export interface ChecklistStep {
  id: ChecklistStepId;
  label: string;
  description: string;
  href: string;
  /** Imperative label for the primary CTA when this is the active step. */
  cta: string;
  done: boolean;
  locked: boolean;
  /** Step 5 only: delivery config saved, but no test-fire success yet. */
  intermediate: boolean;
}

export interface ChecklistModel {
  steps: ChecklistStep[];
  totalDone: number;
  totalSteps: number;
  /** Every derivable step is done. */
  complete: boolean;
  /** First step that is neither done nor locked; null when complete. */
  activeStep: ChecklistStep | null;
}

/**
 * @param status   server onboarding status (extended fields optional)
 * @param nounLower direction-aware counterparty noun, lowercased
 *                  ("supplier" | "customer") — from useOrderDirection().labels
 */
export function buildChecklistSteps(
  status: OnboardingStatus,
  nounLower: string,
): ChecklistModel {
  // ── Signal availability (absent field = unknown → omit the step) ─────────
  const catalogKnown =
    status.hasCatalog !== undefined || status.hasItemMappings !== undefined;
  const deliveryKnown =
    status.hasDeliveryConfig !== undefined || status.hasTestFired !== undefined;

  // ── Done signals ──────────────────────────────────────────────────────────
  const supplierDone = status.hasSupplier === true;
  const catalogDone =
    status.hasCatalog === true || status.hasItemMappings === true;
  const uploadDone = status.hasUpload === true;
  const resolveDone = status.hasResolvedMapping === true;
  const delivered = status.hasDelivery === true;
  const deliveryConfigured = status.hasDeliveryConfig === true;
  const testFired = status.hasTestFired === true;
  const deliveryDone = (deliveryConfigured && testFired) || delivered;
  const deliveryIntermediate =
    !deliveryDone && deliveryConfigured && !testFired;

  // ── Deep links (server-provided ids, honest fallbacks) ───────────────────
  const supplierId = status.firstSupplierId ?? null;
  const orderId = status.firstActionableOrderId ?? null;
  const catalogHref = supplierId
    ? `/library/suppliers/${supplierId}?tab=catalog`
    : "/library/suppliers";
  const deliveryHref = supplierId
    ? `/library/suppliers/${supplierId}?tab=delivery`
    : "/library/suppliers";
  const orderHref = orderId ? `/inbox/${orderId}` : "/inbox";

  const steps: ChecklistStep[] = [];

  steps.push({
    id: "supplier",
    label: `Add your first ${nounLower}`,
    description: `Create a ${nounLower} to hold its delivery setup and item codes.`,
    href: "/library/suppliers",
    cta: `Add a ${nounLower}`,
    done: supplierDone,
    locked: false,
    intermediate: false,
  });

  if (catalogKnown) {
    steps.push({
      id: "catalog",
      label: `Add the ${nounLower}'s item codes`,
      description: `Import their catalog or map the codes their system expects.`,
      href: catalogHref,
      cta: "Add item codes",
      done: catalogDone,
      locked: !supplierDone,
      intermediate: false,
    });
  }

  steps.push({
    id: "upload",
    label: "Upload an order",
    description: `Drop a file in any supported shape: ${ACCEPTED_UPLOAD_FORMATS.humanList}.`,
    href: "/upload",
    cta: "Upload an order",
    done: uploadDone,
    locked: !supplierDone,
    intermediate: false,
  });

  steps.push({
    id: "resolve",
    label: "Match item codes on an order",
    description: `Connect buyer item codes to the ${nounLower}'s own codes on the review screen.`,
    href: orderHref,
    cta: "Match item codes",
    done: resolveDone,
    locked: !uploadDone,
    intermediate: false,
  });

  if (deliveryKnown) {
    steps.push({
      id: "delivery",
      label: "Set up delivery and send a test",
      description: deliveryIntermediate
        ? "Configured — send a test to finish. A successful test means their endpoint answered."
        : `Tell ProcuLink where orders go, then prove the connection with a test.`,
      href: deliveryHref,
      cta: deliveryIntermediate ? "Send a test" : "Set up delivery",
      done: deliveryDone,
      locked: !supplierDone,
      intermediate: deliveryIntermediate,
    });
  }

  steps.push({
    id: "send",
    label: "Send your first order",
    description: `Send a reviewed order to your ${nounLower} for real.`,
    href: orderHref,
    cta: "Open your order",
    done: delivered,
    // Locked until upload (3) + resolve (4) and — when the delivery signals are
    // known — delivery is at least CONFIGURED (5-config; a finished step 5 also
    // counts). Legacy payloads gate on 3 + 4 only.
    locked:
      !uploadDone ||
      !resolveDone ||
      (deliveryKnown && !(deliveryConfigured || deliveryDone)),
    intermediate: false,
  });

  const totalDone = steps.filter((s) => s.done).length;
  const complete = totalDone >= steps.length;
  const activeStep = complete
    ? null
    : (steps.find((s) => !s.done && !s.locked) ??
       steps.find((s) => !s.done) ??
       null);

  return {
    steps,
    totalDone,
    totalSteps: steps.length,
    complete,
    activeStep,
  };
}
