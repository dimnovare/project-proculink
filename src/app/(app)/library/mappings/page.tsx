import type { Metadata } from "next";
import { MappingEditor } from "@/components/bridge/MappingEditor";
import { appPageTitle } from "@/lib/pageTitles";

export const metadata: Metadata = {
  title: appPageTitle("/library/mappings"),
};

export default function MappingsPage() {
  return <MappingEditor />;
}
