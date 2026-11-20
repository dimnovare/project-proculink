// Title-only layout — the page is a Client Component, so its title lives here.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/flows/[flowId]/change-file"),
};

export default function ChangeFileLayout({ children }: { children: ReactNode }) {
  return children;
}
