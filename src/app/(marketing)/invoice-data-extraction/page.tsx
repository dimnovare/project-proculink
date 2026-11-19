import { UseCasePage } from "@/components/marketing/UseCasePage";
import { INVOICE_USE_CASE } from "@/components/marketing/useCases";
import { TRIAL_DAYS } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/invoice-data-extraction",
  title: "Invoice data extraction: PDF to Excel or CSV — ProcuLink",
  description: `Read the invoices you receive, scans included, check each value beside the original, and get the Excel or CSV file your accounting system imports. Free for ${TRIAL_DAYS} days.`,
});

export default function InvoiceDataExtractionPage() {
  return <UseCasePage page={INVOICE_USE_CASE} />;
}
