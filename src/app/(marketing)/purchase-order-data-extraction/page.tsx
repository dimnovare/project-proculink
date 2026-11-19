import { UseCasePage } from "@/components/marketing/UseCasePage";
import { PURCHASE_ORDER_USE_CASE } from "@/components/marketing/useCases";
import { TRIAL_DAYS } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/purchase-order-data-extraction",
  title: "Purchase order data extraction from PDF and Excel — ProcuLink",
  description: `Read the purchase orders your customers send, swap their item codes for yours, check each order beside the original and send the file your system imports. Free for ${TRIAL_DAYS} days.`,
});

export default function PurchaseOrderDataExtractionPage() {
  return <UseCasePage page={PURCHASE_ORDER_USE_CASE} />;
}
