"use client";

import { use } from "react";
import { ChooseFile } from "@/components/flows/ChooseFile";

export default function ChangeFileRoute({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = use(params);
  return <ChooseFile flowId={flowId} />;
}
