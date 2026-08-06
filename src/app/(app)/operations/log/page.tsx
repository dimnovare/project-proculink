import type { Metadata } from "next";
import { CrossingsLog } from "@/components/bridge/CrossingsLog";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/operations/log"),
};

export default function CrossingsLogPage() {
  return <CrossingsLog />;
}
