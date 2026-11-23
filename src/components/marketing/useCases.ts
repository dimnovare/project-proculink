import type { UseCase } from "@/components/marketing/UseCasePage";
import { EXAMPLE_INVOICE } from "@/components/marketing/sitePictures";
import { MAX_DOCUMENTS_PER_FILE, PAGES_PER_DOCUMENT } from "@/lib/plans";

// The use-case pages (kept in components/marketing so publicCopyDrift.test.ts reads them): one search problem each, in the product's own words. Offer ⇔ works: every
// line here is something a workspace does today (see /formats and /help), and each page says
// what the product does NOT do as plainly as what it does.

const UNSENT =
  "Reading is automatic and can be wrong, so anything missing or hard to read is marked and that document waits for you to check it. You can also set a flow to wait on every document.";
const PAGES = `It reads up to ${PAGES_PER_DOCUMENT * MAX_DOCUMENTS_PER_FILE} pages of a file.`;

export const INVOICE_USE_CASE: UseCase = {
  path: "/invoice-data-extraction",
  h1: "Get the data off your invoices without retyping it",
  lead: "ProcuLink reads each invoice you receive, PDF, scan or phone photo, shows what it read beside the original for you to check, and makes the Excel or CSV file your accounting system imports.",
  problem: {
    title: "Retyping invoices is slow, and it is where mistakes get in",
    body: [
      "Most suppliers send a PDF. Someone opens it, types the number, date, supplier, totals and lines into the accounting system, and compares it with the page. Every new supplier brings a new layout.",
      "There is no template to build first. ProcuLink reads the first invoice from any supplier, you correct what it got wrong, and it remembers where that supplier puts each value for the next one.",
    ],
  },
  example: {
    inName: "invoice-1001.pdf",
    inFields: [
      ["Invoice no", EXAMPLE_INVOICE.number],
      ["Date", EXAMPLE_INVOICE.date],
      ["Supplier", EXAMPLE_INVOICE.supplier],
      ["Total EUR", EXAMPLE_INVOICE.total],
    ],
    inTable: {
      head: ["Code", "Item", "Qty", "Price"],
      rows: EXAMPLE_INVOICE.lines.map((l) => [l.code, l.item, String(l.qty), l.price]),
    },
    outName: `invoice-${EXAMPLE_INVOICE.number}.csv`,
    outLines: [
      "invoice_no,date,supplier,code,qty,price",
      ...EXAMPLE_INVOICE.lines.map(
        (l) => `${EXAMPLE_INVOICE.number},${EXAMPLE_INVOICE.date},${EXAMPLE_INVOICE.supplier},${l.code},${l.qty},${l.price}`,
      ),
    ],
  },
  steps: [
    ["Send it in", "Upload the invoice, forward the email it came in, or let us collect it from a mailbox."],
    ["We read it", "The header and the lines are read, scans and phone photos too. Nothing to set up first."],
    ["You check it", "The original stays beside what we read. Anything missing or hard to read is marked."],
    ["You get the file", "Download the Excel or CSV file, or have it sent by email, to Google Drive or Sheets, or to a server."],
  ],
  works: [
    "Reads PDF invoices, scans and phone photos, and Excel or CSV files",
    "Reads the invoice number, date, supplier, VAT number, IBAN, totals and the lines",
    "Marks a value that is missing, in the wrong shape or hard to read",
    "Holds an invoice it has already seen, so nothing goes out twice",
    "Remembers where each supplier puts a value, so the next invoice needs less checking",
    "Splits a file that holds several invoices into one document each",
    "Uses your column names in the file it makes",
  ],
  limits: [
    "It does not post into your accounting software for you. It makes the file that software imports and sends it where you choose.",
    "It does not approve or pay invoices.",
    UNSENT,
    PAGES,
  ],
  links: [
    ["Files we read", "/help/what-we-read"],
    ["Checks", "/help/checks"],
    ["Files we make", "/help/outputs"],
    ["Pricing", "/pricing"],
  ],
};

const PO = {
  number: "PO-4501",
  date: "2026-05-20",
  customer: "Example Buyer GmbH",
  deliverBy: "2026-06-02",
  lines: [
    { theirs: "BX-77", ours: "A-100", item: "Gasket set", qty: 10 },
    { theirs: "BX-91", ours: "B-200", item: "Valve body", qty: 5 },
  ],
} as const;

export const PURCHASE_ORDER_USE_CASE: UseCase = {
  path: "/purchase-order-data-extraction",
  h1: "Stop retyping the purchase orders your customers send",
  lead: "ProcuLink reads each purchase order as it arrives, PDF, Excel or an email attachment, swaps your customer's item codes for yours, and makes the file your order system imports. You check it beside the original first.",
  problem: {
    title: "Every customer sends orders their own way",
    body: [
      "One sends a PDF from their purchasing system, another an Excel sheet, a third a scan. Someone on your team retypes each order into your system and looks up which of your products each customer code means.",
      "Your customers will not change how they order, and they do not have to. ProcuLink reads what they already send.",
    ],
  },
  example: {
    inName: `${PO.number}.pdf`,
    inFields: [
      ["Order no", PO.number],
      ["Date", PO.date],
      ["Customer", PO.customer],
      ["Deliver by", PO.deliverBy],
    ],
    inTable: { head: ["Their code", "Item", "Qty"], rows: PO.lines.map((l) => [l.theirs, l.item, String(l.qty)]) },
    outName: `order-${PO.number}.csv`,
    outLines: ["order_no,deliver_by,item_code,qty", ...PO.lines.map((l) => `${PO.number},${PO.deliverBy},${l.ours},${l.qty}`)],
  },
  steps: [
    ["Send it in", "Forward the email it came in, upload it, or let us collect it from a mailbox or a server."],
    ["We read it", "The order number, dates and every line are read. Nothing to set up first."],
    ["Your codes go in", "A lookup you import swaps each customer's item code for yours."],
    ["Check, then send", "The original stays beside what we read. Then the file goes to the folder, server or inbox your system reads."],
  ],
  works: [
    "Reads PDF and Excel orders, CSV files, emailed attachments, scans and phone photos",
    "Swaps item codes using a list you import from a CSV or Excel file",
    "Makes CSV, Excel, JSON or XML with the column names your system expects",
    "Proposes the file from your system's import documentation or a sample file",
    "Holds an order number it has already seen, so an order is not sent twice",
    "Picks orders up from a mailbox, an SFTP or FTP server or an S3 bucket every five minutes",
  ],
  limits: [
    "It does not enter the order in your ERP for you. It makes the import file and sends it where your system reads from.",
    "It does not check stock, prices or credit.",
    UNSENT,
    PAGES,
  ],
  links: [
    ["Lookups", "/help/lookups"],
    ["Ways to send documents in", "/help/intake-channels"],
    ["Files we make", "/help/outputs"],
    ["Formats", "/formats"],
  ],
};

export const USE_CASES = [INVOICE_USE_CASE, PURCHASE_ORDER_USE_CASE] as const;
