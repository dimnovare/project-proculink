// The public footer's link groups, shared by the home page and the marketing layout
// so the two footers cannot drift apart.
export const FOOTER_COLS: { h: string; links: [string, string][] }[] = [
  { h: "Product", links: [["How it works", "/how-it-works"], ["Formats", "/formats"], ["Pricing", "/pricing"], ["Security", "/security"], ["Changelog", "/changelog"]] },
  { h: "Help", links: [["Help centre", "/help"], ["Guides", "/help/guides"], ["Support", "/support"]] },
  { h: "Company", links: [["Talk to us", "/book-demo"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["AUP", "/aup"], ["DPA", "/dpa"], ["Subprocessors", "/subprocessors"]] },
];
