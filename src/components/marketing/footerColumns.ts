// The public footer's link groups (SiteFooter). Kept as [label, path] tuples: the route
// reachability guard reads them as the only links to /changelog, /aup and /dpa.
export const FOOTER_COLS: { h: "Product" | "Help" | "Company"; links: [string, string][] }[] = [
  { h: "Product", links: [["How it works", "/how-it-works"], ["Formats", "/formats"], ["Pricing", "/pricing"], ["How ProcuLink compares", "/compare"], ["Security", "/security"], ["Invoice data extraction", "/invoice-data-extraction"], ["Purchase order data extraction", "/purchase-order-data-extraction"], ["Changelog", "/changelog"]] },
  { h: "Help", links: [["Help centre", "/help"], ["Step-by-step guides", "/help/guides"], ["Support", "/support"], ["Talk to us", "/book-demo"]] },
  { h: "Company", links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["Acceptable use", "/aup"], ["Data processing addendum", "/dpa"], ["Subprocessors", "/subprocessors"]] },
];
