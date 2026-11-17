import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { UploadToFlow } from "@/components/flows/UploadToFlow";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/upload"),
};

// UploadToFlow reads ?shared=, so the static page needs a Suspense boundary.
export default function UploadPage() {
  return (
    <Suspense fallback={<PageShell variant="narrow"><PageHeader title="Add documents" /></PageShell>}>
      <UploadToFlow />
    </Suspense>
  );
}
