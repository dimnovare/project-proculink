// Title-only layout — the page is a Client Component, so its title lives here.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/flows/[flowId]/outputs/[outputId]/advanced"),
};

export default function FlowOutputAdvancedLayout({ children }: { children: ReactNode }) {
  return children;
}
