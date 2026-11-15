import { PageShell } from "@/components/bridge/layout/PageShell";
import { LoadingRows } from "@/components/flows/states";

export default function Loading() {
  return (
    <PageShell>
      <LoadingRows label="Loading the page" />
    </PageShell>
  );
}
