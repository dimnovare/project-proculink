import type { Metadata } from "next";
import { Suspense } from "react";
import { UploadLoading, UploadToFlow } from "@/components/flows/UploadToFlow";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/upload"),
};

// UploadToFlow reads ?shared=, so the static page needs a Suspense boundary; its fallback is the page's own loading state.
export default function UploadPage() {
  return (
    <Suspense fallback={<UploadLoading />}>
      <UploadToFlow />
    </Suspense>
  );
}
