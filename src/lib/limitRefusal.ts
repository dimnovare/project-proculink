// ─────────────────────────────────────────────────────────────────────────────
// limitRefusal — the quota 429s, turned into copy, in ONE place.
//
// WHY THIS IS A MODULE AND NOT A BLOCK INSIDE ONE SCREEN.
//
// This derivation used to live at the bottom of `UploadWorkbench.tsx`, and it carried a
// carefully-written arm for `supplier_limit_reached` that the workbench could never reach.
// The file said so itself:
//
//     `supplier_limit_reached` is emitted by exactly ONE endpoint — POST /api/suppliers,
//     SuppliersController.cs:126 — which this screen never calls.
//
// The screen that DOES call it, `SupplierDockList`, had no derivation at all: its create
// mutation lifted the `error` field straight out of the refusal and rendered it, so the
// operator was shown the bare token `supplier_limit_reached` inside the add-supplier modal —
// at the exact moment they are deciding whether to spend money. So the correct copy existed,
// in a file where it was unreachable, while the reachable file printed a machine code.
//
// One derivation, imported by both. The plan ladder is read from `plans.ts`; no tier name and
// no allowance is ever typed into a sentence here.
//
// WHAT THE SERVER SENDS (CLAUDE.md §11.5, and the controllers named below):
//
//   POST /api/orders/upload  →  429 { error: "pilot_expired" | "order_limit_reached",
//                                     plan, limit, upgradeUrl }
//                               ProcuLink.Api/Controllers/OrdersController.cs
//   POST /api/suppliers      →  429 { error: "supplier_limit_reached", plan, limit, upgradeUrl }
//                               ProcuLink.Api/Controllers/SuppliersController.cs
//   the global rate limiter  →  429 { error: "Rate limit exceeded. Please slow down and
//                                     retry shortly." }
//                               ProcuLink.Api/Program.cs
//
// Codes are matched WHOLE. A substring test (`rawError.includes("supplier")`) is what this
// module replaced: it could not be reached by the case it was written for, and what it COULD
// match was any other 429 whose prose happens to contain the word.
//
// NOT PLAN GATES. `<capability>_requires_<plan>` bodies are 403s and belong to
// `src/lib/planGate.ts`. `isPlanGateError` is consulted below only so that a gate code
// arriving on a 429 gets the gate sentence rather than a quota banner it is not.
// ─────────────────────────────────────────────────────────────────────────────

import { isPlanGateError, planGateMessage, planGateUpgradeUrl } from "@/lib/planGate";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";

/** The codes the API emits as machine tokens. Matched whole — never by substring. */
export const LIMIT_CODES = new Set(["pilot_expired", "order_limit_reached", "supplier_limit_reached"]);

/**
 * True when a string is one of the quota codes, exactly.
 *
 * Callers that reach this module from a screen where an ARBITRARY failure can arrive (a name
 * clash, a validation 400) must ask this first. `classifyLimitCode` below deliberately falls
 * back to `order_limit_reached` for an unrecognised string, which is the right default on a
 * confirmed 429 and badly wrong on anything else.
 */
export function isLimitCode(value: string | null | undefined): boolean {
  return !!value && LIMIT_CODES.has(value.trim().toLowerCase());
}

export interface LimitRefusal {
  /** A LIMIT_CODES member, or the derived "plan_gate" / "rate_limited". */
  code: string;
  /** The plan the server named, or null when it named none this build knows. */
  plan: PlanId | null;
  /**
   * The EFFECTIVE limit the server enforced for the check that failed — `LimitCheckResult.Limit`,
   * which is `admin override ?? plan default`. Preferred over the `plans.ts` default precisely
   * because of that override: an org whose supplier cap was raised by an admin must not be shown
   * the smaller number its tier ships with.
   */
  limit: number | null;
  /** The raw `error` value, kept only so a plan-gate code can be turned into its sentence. */
  raw: string;
}

/** What a refused quota looks like on screen. A superset is fine; nothing here sets more. */
export interface LimitRefusalCopy {
  code: string;
  title: string;
  message: string;
  /** Label of the route that matches the cause. */
  cta: string;
  /** Where that route goes. Absent = the caller's own default. */
  href?: string;
}

/** A plan id the ladder in plans.ts actually knows, or null. Never a snake_case token. */
export function knownPlanId(value: unknown): PlanId | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return id in PLAN_BY_ID ? (id as PlanId) : null;
}

export function classifyLimitCode(normalized: string): string {
  // Exact code first, so no code can ever be re-read as prose by the sniff below.
  if (LIMIT_CODES.has(normalized)) return normalized;
  // A gate code on a 429 would be a backend change rather than a shape invented here — but
  // if one arrives, the gate sentence is the honest answer, not "you've hit your order limit".
  if (isPlanGateError(normalized)) return "plan_gate";
  // The ONE 429 with no code to match: the global rate limiter writes a SENTENCE, so prose
  // is all there is. A SPEED throttle is not a plan/quota cap — this used to fall through to
  // "order_limit_reached" and was shown as "Plan limit reached", which is alarming and wrong
  // (their plan is fine; they just uploaded too fast).
  if (normalized.includes("rate limit") || normalized.includes("slow down") || normalized.includes("too many"))
    return "rate_limited";
  return "order_limit_reached";
}

/** Read the structured 429 body. `body` may be the parsed object or anything at all. */
export function readLimitRefusal(body: unknown): LimitRefusal {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const raw = record && "error" in record ? String(record.error) : "";
  const limit = typeof record?.limit === "number" && Number.isFinite(record.limit) ? record.limit : null;
  return { code: classifyLimitCode(raw.trim().toLowerCase()), plan: knownPlanId(record?.plan), limit, raw };
}

/**
 * The tier above `plan`, or null when there is none to sell.
 *
 * `next` is the ladder pointer already declared in plans.ts, and it is **null at the top of
 * the self-serve ladder** (Distributor) as well as on Enterprise. That null is the whole
 * point of reading it rather than hardcoding a tier name: a €1,499/mo Distributor org with
 * 30 supplier flows has no cheaper tier to be sent to, and telling it to "upgrade to Growth"
 * — €149, five suppliers — is an offer to pay less for less.
 *
 * Same derivation shape as requiresPlan()/minimumPlanName() in src/lib/gatedCapabilities.ts:
 * the ladder is stated once, in plans.ts, and the copy follows it.
 */
export function nextPlanUp(plan: PlanId | null): { name: string } | null {
  const nextId = plan ? PLAN_BY_ID[plan].next : null;
  return nextId ? PLAN_BY_ID[nextId] : null;
}

/** The sentence for a quota refusal. Never returns the raw code, on any branch. */
export function limitRefusalCopy(refusal: LimitRefusal): LimitRefusalCopy {
  const { code, plan } = refusal;

  if (code === "rate_limited") {
    return {
      code,
      title: "Uploading a little fast.",
      message:
        "To keep processing reliable, ProcuLink paces uploads. Your plan and the other files are unaffected — each one retries automatically in a moment.",
      cta: "Got it",
    };
  }

  // A 403 gate code that arrived on a 429. planGate owns both the sentence and the
  // destination; nothing about the tier is guessed here.
  if (code === "plan_gate") {
    return {
      code: "upload_plan_gate",
      title: "Your plan doesn't include this yet.",
      message: planGateMessage(refusal.raw),
      cta: "Upgrade plan",
      href: planGateUpgradeUrl(refusal.raw),
    };
  }

  if (code === "pilot_expired") {
    // "Upgrade to Growth" was typed here. Only a Pilot org can be trial-expired
    // (LimitCheckResult.PilotExpired is "true only for Pilot accounts past their window"),
    // so the literal was right — and would have stayed right only for as long as
    // pilot.next stayed "growth". Derived, the sentence is identical and stays correct.
    const next = nextPlanUp(plan ?? "pilot");
    return {
      code,
      title: "Your Pilot has ended.",
      message: "You can still view previous orders, but new processing is paused.",
      cta: next ? `Upgrade to ${next.name}` : "See plans",
      href: next ? undefined : "/pricing",
    };
  }

  if (code === "supplier_limit_reached") {
    // The number the SERVER enforced first (it is the effective limit, admin override
    // included); the plan default from plans.ts only as a fallback; and no number at all
    // rather than an invented one when neither is known.
    const allowance = refusal.limit ?? (plan ? PLAN_BY_ID[plan].supplierLimit : null);
    const next = nextPlanUp(plan);
    return {
      code,
      title:
        allowance == null
          ? "You've reached your plan's supplier limit."
          : `Your plan includes ${allowance} ${allowance === 1 ? "supplier" : "suppliers"}.`,
      // No tier above means no upgrade to offer. Enterprise supplier counts are set by
      // agreement (plans.ts gives Enterprise `supplierLimit: null`), so the honest next
      // step is a conversation, not a checkout.
      message: next
        ? `Upgrade to ${next.name} to add more supplier flows.`
        : "Contact us to add more supplier flows.",
      cta: next ? "Upgrade plan" : "Contact support",
      href: next ? undefined : "/support",
    };
  }

  return {
    code,
    title: "You've reached your plan's order limit.",
    message: "Upgrade to continue processing new orders this month.",
    cta: "Upgrade plan",
  };
}
