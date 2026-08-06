// Title-only layout — see settings/layout.tsx. The page is a Client Component,
// so its title lives here. Adds no markup.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/inbound/asns"),
};

export default function ShippingNoticesLayout({ children }: { children: ReactNode }) {
  return children;
}
