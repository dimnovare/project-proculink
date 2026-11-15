import { Suspense } from "react";
import type { Metadata } from "next";
import { ActivityLoading, ActivityPage } from "@/components/activity/ActivityPage";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/operations/log"),
};

export default function ActivityLogPage() {
  return (
    <Suspense fallback={<ActivityLoading />}>
      <ActivityPage />
    </Suspense>
  );
}
