"use client";

import { Suspense } from "react";
import { NewFlowGuide } from "@/components/flows/NewFlowGuide";

export default function NewFlowPage() {
  return (
    <Suspense>
      <NewFlowGuide />
    </Suspense>
  );
}
