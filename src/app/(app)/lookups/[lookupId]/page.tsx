"use client";

import { use } from "react";
import { LookupPage } from "@/components/lookups/LookupPage";

export default function LookupRoute({ params }: { params: Promise<{ lookupId: string }> }) {
  const { lookupId } = use(params);
  return <LookupPage lookupId={lookupId} />;
}
