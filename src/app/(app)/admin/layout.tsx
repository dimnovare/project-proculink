// Title-only layout. admin/page.tsx is a Client Component, and Next.js refuses
// a `metadata` export from a "use client" file; a sibling layout is a Server
// Component even when the page it wraps is not. It adds no markup.
//
// This layout also wraps /admin/guides/*, whose pages export their own
// `metadata` — a page-level title wins over a layout's, so the runbooks keep
// their own titles.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/admin"),
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
