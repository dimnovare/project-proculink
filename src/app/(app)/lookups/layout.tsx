// Title-only layout — the pages are Client Components, so their title lives here.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/lookups"),
};

export default function LookupsLayout({ children }: { children: ReactNode }) {
  return children;
}
