import type { Metadata } from "next";

// The pricing page itself is a Client Component (interactive ROI calculator +
// tier disclosure), so it cannot export `metadata`. This server-component
// layout supplies the page-level SEO metadata + self-canonical for /pricing.
export const metadata: Metadata = {
  title: "Pricing — ProcuLink",
  description:
    "Plans for purchase-order automation: a free 14-day pilot, self-serve paid tiers from €149/mo, and custom Enterprise. Orders are never blocked — predictable €0.50 per-order overage above your plan.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — ProcuLink",
    description:
      "Free pilot, self-serve paid tiers, and custom Enterprise for PO automation. Tell us your order volume and we'll point you at the right plan.",
    url: "/pricing",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
