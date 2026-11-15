"use client";

import { Suspense } from "react";
import { DocumentsHome, DocumentsLoading } from "@/components/flows/DocumentsHome";

export default function DocumentsPage() {
  return (
    <Suspense fallback={<DocumentsLoading />}>
      <DocumentsHome />
    </Suspense>
  );
}
