import { PageShell } from "@/components/bridge/layout/PageShell";
import { LoadingPanel } from "@/components/flows/states";

export default function Loading() {
  return (
    <PageShell>
      {/* Holds the page header's place (title and one line), so the list does not drop when the page arrives. */}
      <div aria-hidden="true" className="mb-5 h-[61px]" />
      <LoadingPanel label="Loading the page" />
    </PageShell>
  );
}
