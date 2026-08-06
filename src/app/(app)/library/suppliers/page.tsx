import type { Metadata } from "next";
import { SupplierDockList } from "@/components/bridge/SupplierDockList";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/library/suppliers"),
};

export default function SuppliersPage() { return <SupplierDockList />; }
