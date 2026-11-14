import { pageMetadata } from "@/lib/seo";

// The landing page sits in this route group — which
// adds no path segment, so the route stays "/" — purely so this server-side
// layout can give it a self-canonical and its own og:url. Without them the
// homepage served neither, and every ?utm=… variant looked like a separate URL.
export const metadata = pageMetadata({
  path: "/",
  title: "ProcuLink — Connecting Procurement",
  description:
    "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
  ogDescription:
    "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
});

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
