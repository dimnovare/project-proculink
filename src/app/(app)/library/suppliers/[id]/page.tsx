import { SupplierDockProfile } from "@/components/bridge/SupplierDockProfile";
export default async function SupplierProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierDockProfile id={id} />;
}
