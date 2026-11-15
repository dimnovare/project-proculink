"use client";

import { use } from "react";
import { LookupsHome } from "@/components/lookups/LookupsHome";

export default function LookupRoute({ params }: { params: Promise<{ lookupId: string }> }) {
  const { lookupId } = use(params);
  return <LookupsHome lookupId={lookupId} />;
}
