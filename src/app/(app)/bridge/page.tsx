import type { Metadata } from "next";
import { BridgeDashboard } from "@/components/bridge/BridgeDashboard";

export const metadata: Metadata = {
  title: "Order topology — ProcuLink",
};

export default function BridgePage() {
  return <BridgeDashboard />;
}
