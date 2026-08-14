import { pageMetadata } from "@/lib/seo";

// The watch page itself is a Client Component (video element + analytics
// capture), so it cannot export `metadata`. This server-component layout
// supplies the page-level SEO metadata + self-canonical for /watch.
//
// NOTE (offer⇔works): the walkthrough copy is duration-free on purpose — do
// not re-add a "N-minute" claim here or on the page.
//
// NOTE (offer⇔works): "validated against the supplier's rules" was the SERP
// description for this page. "A supplier's own rules" is the name this product
// gives the CONFIGURABLE acceptance profile, and authoring or activating one is
// gated at Enterprise (BillingFeature.CustomSupplierRules) — so the sentence a
// prospect met in search results described a capability their plan would refuse.
// It is now the bare verb, which is honest on every plan: the built-in checks
// really do run for everyone, Pilot included, with no profile configured. Do not
// re-attach the rules to a supplier here; a meta description has no room for the
// tier, and the walkthrough does not show the acceptance tab.
export const metadata = pageMetadata({
  path: "/watch",
  title: "Watch the walkthrough — ProcuLink",
  description:
    "See how a single upload becomes a delivered supplier order — parsed, mapped, validated, and sent.",
  ogDescription:
    "Watch a single upload become a delivered supplier order — parsed, mapped, validated, and sent.",
});

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
