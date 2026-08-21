import { PageShell } from "@/components/bridge/layout/PageShell";
import { requireAdminOrNotFound } from "@/lib/admin-guard";
import { guideMetadata } from "@/lib/seo";
import Content from "./content.mdx";

// The runbook prose lives in content.mdx and is rendered by THIS Server
// Component, after the allowlist check has passed. That ordering is the point:
// a client-side gate would have shipped the text to every signed-in user's
// browser and merely refused to display it.
export const dynamic = "force-dynamic";

export const metadata = guideMetadata({
  slug: "erase-order-data",
  title: "Erase a customer's order data — ProcuLink admin runbook",
  description: "Internal runbook. Visible only to ProcuLink admins.",
});

export default async function EraseOrderDataRunbook() {
  await requireAdminOrNotFound();

  return (
    <PageShell>
      <Content />
    </PageShell>
  );
}
