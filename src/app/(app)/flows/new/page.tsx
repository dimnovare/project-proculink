"use client";

import { Suspense } from "react";
import { FirstRun, FirstRunLoading } from "@/components/flows/FirstRun";

export default function NewFlowPage() {
  return (
    <Suspense fallback={<FirstRunLoading />}>
      <FirstRun />
    </Suspense>
  );
}
