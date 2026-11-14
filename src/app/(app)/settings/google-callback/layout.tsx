// Title-only layout: the page is a Client Component and cannot export metadata. Its own title, not the
// settings one, because no two routes may share a tab title (src/test/pageTitles.test.ts).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/settings/google-callback"),
};

export default function GoogleCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}
