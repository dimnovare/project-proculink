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
    "Stop reformatting purchase orders by hand. ProcuLink turns any incoming order into the exact format and channel each supplier needs — with a full audit trail behind every order.",
  ogDescription:
    "Stop reformatting purchase orders by hand. ProcuLink turns any incoming order into the exact format and channel each supplier needs — with a full audit trail.",
});

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
