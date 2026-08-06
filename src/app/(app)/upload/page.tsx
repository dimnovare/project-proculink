import type { Metadata } from "next";
import { UploadWorkbench } from "@/components/bridge/UploadWorkbench";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/upload"),
};

export default function UploadPage() {
  return <UploadWorkbench />;
}
