import type { Metadata } from "next";
import { UploadEntry } from "@/components/flows/UploadToFlow";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/upload"),
};

export default function UploadPage() {
  return <UploadEntry />;
}
