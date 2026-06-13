import type { Metadata } from "next";

// The watch page itself is a Client Component (video element + analytics
// capture), so it cannot export `metadata`. This server-component layout
// supplies the page-level SEO metadata + self-canonical for /watch.
//
// NOTE (offer⇔works): the walkthrough copy is duration-free on purpose — do
// not re-add a "N-minute" claim here or on the page.
export const metadata: Metadata = {
  title: "Watch the walkthrough — ProcuLink",
  description:
    "See how a single upload becomes a delivered supplier order — parsed, mapped, validated against the supplier's rules, and sent.",
  alternates: { canonical: "/watch" },
  openGraph: {
    title: "Watch the walkthrough — ProcuLink",
    description:
      "Watch a single upload become a delivered supplier order — parsed, mapped, validated, and sent.",
    url: "/watch",
  },
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
