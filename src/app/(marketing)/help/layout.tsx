import { pageMetadata } from "@/lib/seo";

// The help center page itself is a Client Component (live search + category
// filtering), so it cannot export `metadata`. This server-component layout
// supplies the page-level SEO metadata + self-canonical for /help.
//
// Every article under /help/* declares its own canonical and Open Graph block
// via helpArticleMetadata() — a child that declared none would inherit the
// /help canonical below and tell search engines it was a duplicate of this
// index page.
export const metadata = pageMetadata({
  path: "/help",
  title: "Help center — ProcuLink",
  description:
    "Guides for ProcuLink: first upload, per-supplier field and item-code mapping, output templates, delivery setup, exceptions, billing, and the REST API.",
  ogDescription:
    "Guides for uploading, mapping, transforming, and delivering purchase orders with ProcuLink.",
});

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
