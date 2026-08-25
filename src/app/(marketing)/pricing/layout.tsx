import { pageMetadata } from "@/lib/seo";
import { CHECKOUT_PLAN_IDS, OVERAGE_PER_ORDER_EUR, PLAN_BY_ID } from "@/lib/plans";

// The two ladder numbers this description quotes are DERIVED, not typed.
//
// They were typed, and that is the whole risk: metadata is the one piece of pricing
// copy nobody looks at while repricing, because it never renders on the page. A
// €149 that became €179 in plans.ts would have gone on telling Google and every
// link preview the old entry price indefinitely, and the same for the overage rate
// the /pricing body already derives. The rendered sentence is unchanged — this is
// drift-proofing, not a correction.
//
// "from €X/mo" is the CHEAPEST self-serve tier, so it follows the ladder rather than
// naming Growth by hand: if a cheaper paid tier is ever added below it, or Growth
// stops being self-serve, this sentence moves with the change. Grouping is pinned to
// en-US for the same reason `billingPriceLabelFor` in plans.ts pins it — the string
// must not depend on the build machine's locale.
const CHEAPEST_PAID_MONTHLY_EUR = Math.min(
  ...CHECKOUT_PLAN_IDS.map((id) => PLAN_BY_ID[id].priceMonthly ?? Infinity),
);
const ENTRY_PRICE = `€${CHEAPEST_PAID_MONTHLY_EUR.toLocaleString("en-US")}/mo`;
const OVERAGE_RATE = `€${OVERAGE_PER_ORDER_EUR.toFixed(2)}`;

// The pricing page itself is a Client Component (interactive ROI calculator +
// tier disclosure), so it cannot export `metadata`. This server-component
// layout supplies the page-level SEO metadata + self-canonical for /pricing.
export const metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing — ProcuLink",
  description:
    `Plans for purchase-order automation: a free 14-day pilot, self-serve paid tiers from ${ENTRY_PRICE}, and custom Enterprise. Orders are never blocked — predictable ${OVERAGE_RATE} per-order overage above your plan.`,
  ogDescription:
    "Free pilot, self-serve paid tiers, and custom Enterprise for PO automation. Tell us your order volume and we'll point you at the right plan.",
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
