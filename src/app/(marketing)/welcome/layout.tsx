import { pageMetadata } from "@/lib/seo";

// /welcome is a post-signup onboarding landing (reads the signed-in user + an
// `upgraded` query param), not a public marketing page. It is a Client Component
// so it can't export `metadata`; this server-component layout supplies a title
// and marks it noindex so it never enters search results (it is also absent from
// the sitemap by design).
export const metadata = pageMetadata({
  path: "/welcome",
  title: "Welcome to ProcuLink",
  description: "Your ProcuLink workspace is ready — here's how to send your first order.",
  noindex: true,
});

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
