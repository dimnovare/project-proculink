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
    "Help for ProcuLink: how it works, the files it reads, flows, ways to send documents in, outputs and destinations, lookups, billing, and the API.",
  ogDescription:
    "Help for reading, checking and sending documents with ProcuLink.",
});

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
