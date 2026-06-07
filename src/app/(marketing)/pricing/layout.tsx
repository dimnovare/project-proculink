import type { Metadata } from "next";

// The pricing page itself is a Client Component (interactive ROI calculator +
// tier disclosure), so it cannot export `metadata`. This server-component
// layout supplies the page-level SEO metadata + self-canonical for /pricing.
export const metadata: Metadata = {
  title: "Pricing — ProcuLink",
  description:
    "Plans for outbound purchase-order automation: a free pilot, an Operations anchor, and contact-sales tiers. Orders are never blocked — predictable per-order overage above your plan.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — ProcuLink",
    description:
      "Free pilot, Operations anchor, and contact-sales tiers for outbound PO automation. Pick the plan that fits your order volume.",
    url: "/pricing",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
