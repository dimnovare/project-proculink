// Title-only layout. settings/page.tsx is a Client Component, and Next.js
// refuses a `metadata` export from a "use client" file; a sibling layout is a
// Server Component even when the page it wraps is not, so this is where the
// browser-tab title has to live. It adds no markup.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/settings"),
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
