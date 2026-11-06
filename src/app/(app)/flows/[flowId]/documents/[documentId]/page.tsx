"use client";

import { use } from "react";
import { DocumentScreen } from "@/components/flows/DocumentScreen";

export default function FlowDocumentRoute({ params }: { params: Promise<{ flowId: string; documentId: string }> }) {
  const { flowId, documentId } = use(params);
  return <DocumentScreen flowId={flowId} documentId={documentId} />;
}
