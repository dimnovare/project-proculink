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
    "Do your item numbers match your supplier's? Map once, reuse next time: ProcuLink remembers the match and reuses it on the next order to that supplier.",
  ogDescription:
    "Do your item numbers match your supplier's? Map once, reuse next time: ProcuLink remembers the match and reuses it on the next order to that supplier.",
});

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
