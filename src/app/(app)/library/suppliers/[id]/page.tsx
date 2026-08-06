import type { Metadata } from "next";
import { SupplierDockProfile } from "@/components/bridge/SupplierDockProfile";
import { appPageTitle } from "@/lib/pageTitles";

// Static, not the supplier's name: resolving the name here would mean a second
// server fetch of data the page already loads on the client, on every
// navigation, to change one line of browser chrome.
export const metadata: Metadata = {
  title: appPageTitle("/library/suppliers/[id]"),
};
export default async function SupplierProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierDockProfile id={id} />;
}
