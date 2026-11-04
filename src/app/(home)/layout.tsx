import { pageMetadata } from "@/lib/seo";

// The landing page is a Client Component (interactive hero + ROI calculator),
// so it cannot export `metadata` itself. It sits in this route group — which
// adds no path segment, so the route stays "/" — purely so this server-side
// layout can give it a self-canonical and its own og:url. Without them the
// homepage served neither, and every ?utm=… variant looked like a separate URL.
export const metadata = pageMetadata({
  path: "/",
  title: "ProcuLink — Connecting Procurement",
  description:
    "A document comes in. ProcuLink reads it, checks it, turns it into the format you need and sends it on. Purchase orders work today; invoices are in early access.",
  ogDescription:
    "Your documents, read, checked and sent in the format you need. Purchase orders work today; invoices are in early access.",
});

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
