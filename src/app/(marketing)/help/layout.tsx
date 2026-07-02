import type { Metadata } from "next";

// The help center page itself is a Client Component (live search + category
// filtering), so it cannot export `metadata`. This server-component layout
// supplies the page-level SEO metadata + self-canonical for /help.
export const metadata: Metadata = {
  title: "Help center — ProcuLink",
  description:
    "Guides for ProcuLink: first upload, per-supplier field and item-code mapping, output templates, delivery setup, exceptions, billing, and the REST API.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Help center — ProcuLink",
    description:
      "Guides for uploading, mapping, transforming, and delivering purchase orders with ProcuLink.",
    url: "/help",
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
