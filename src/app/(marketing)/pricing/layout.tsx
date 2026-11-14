import { pageMetadata } from "@/lib/seo";
import { DOCUMENT_PLANS, TRIAL_DAYS } from "@/lib/plans";

// The two numbers this description quotes are DERIVED from the cheapest document plan, not
// typed: metadata never renders on the page it describes, so a typed price is the copy nobody
// re-reads when the ladder moves. Grouping is pinned to en-US so the string does not depend on
// the build machine's locale.
const [STARTER] = DOCUMENT_PLANS;

// The pricing page itself is a Client Component, so it cannot export `metadata`. This
// server-component layout supplies the page-level SEO metadata + self-canonical for /pricing.
export const metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing — ProcuLink",
  description: `Document processing from €${STARTER.priceMonthly} a month for ${STARTER.orderLimit!.toLocaleString("en-US")} documents. Every channel, output and check on every plan. Free for ${TRIAL_DAYS} days.`,
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
