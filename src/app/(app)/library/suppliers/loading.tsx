import { TableSkeleton } from "@/components/bridge/Skeletons";
export default function SuppliersLoading() {
  return (
    <div className="p-5" style={{ background: "#F6F7FA", minHeight: "100%" }}>
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
