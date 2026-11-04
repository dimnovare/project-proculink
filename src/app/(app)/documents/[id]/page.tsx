import type { Metadata } from "next";
import { InvoiceScreen } from "@/components/documents/InvoiceScreen";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/documents/[id]"),
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DocumentPage({ params }: Props) {
  const { id } = await params;
  return <InvoiceScreen orderId={id} />;
}
