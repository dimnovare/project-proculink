"use client";

import { Suspense } from "react";
import { DocumentsHome } from "@/components/flows/DocumentsHome";

export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsHome />
    </Suspense>
  );
}
