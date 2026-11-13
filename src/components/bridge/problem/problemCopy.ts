// problemCopy — the badge each stuck order status wears.
//
// This file used to be the five-question contract (headline, attribution, automatic,
// actions, consequence) behind the order screen's problem panel, the inbox row and the
// health page. Those surfaces went with the order pipeline (plan 13b, 2026-11-13), and
// the panel copy went with them. What is left is what is still read: ContactForm prefills
// a support request from `/support?…&problem=<status>` and shows that status's badge.

export const PROBLEM_STATUSES = [
  "failed", // couldn't read the file
  "unrouted", // no supplier known
  "transform_failed", // couldn't build the supplier's file
  "delivery_failed", // couldn't reach the supplier, retrying
  "delivery_dead_letter", // stopped retrying
  "rejected_by_supplier", // supplier refused it
  "delivery_unconfirmed", // sent, no confirmation
  "delivery_held", // paused by plan
] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const PROBLEM_COPY: Record<ProblemStatus, { badge: string }> = {
  failed: { badge: "Couldn't read file" },
  unrouted: { badge: "Needs supplier" },
  transform_failed: { badge: "Couldn't build output" },
  delivery_failed: { badge: "Couldn't send" },
  delivery_dead_letter: { badge: "Out of retries" },
  rejected_by_supplier: { badge: "Supplier rejected" },
  delivery_unconfirmed: { badge: "Delivery unknown" },
  delivery_held: { badge: "Delivery paused" },
};

export function isProblemStatus(status: string | null | undefined): status is ProblemStatus {
  return (PROBLEM_STATUSES as readonly string[]).includes(status ?? "");
}
