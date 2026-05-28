export interface HelpArticle {
  slug: string;
  title: string;
  blurb: string;
  category: "Getting started" | "Mapping" | "Delivery" | "AI" | "Billing" | "Email" | "Troubleshooting";
}

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: "first-upload",     title: "Your first purchase order upload",   blurb: "Walk through uploading a CSV, XLSX, or PDF and getting it parsed.",   category: "Getting started" },
  { slug: "mapping-basics",   title: "PO field mapping basics",            blurb: "Map your CSV columns to the canonical purchase-order fields ProcuLink expects.", category: "Mapping" },
  { slug: "delivery-config",  title: "Configuring supplier delivery",      blurb: "Set up HTTP webhook delivery with credentials and test-fire.",         category: "Delivery" },
  { slug: "ai-suggestions",   title: "How AI mapping suggestions work",    blurb: "When OpenAI runs, what confidence means, and how to confirm or clear suggestions.", category: "AI" },
  { slug: "billing-faq",      title: "Billing and plans FAQ",              blurb: "Pilot, Growth, Operations, Integration, Enterprise — what's included and what happens at quota.", category: "Billing" },
  { slug: "email-polling",    title: "Email polling (IMAP) setup",         blurb: "Receive POs as email attachments — only on Integration and above.",   category: "Email" },
  { slug: "troubleshooting",  title: "Troubleshooting common parse errors",blurb: "Date format mismatches, missing columns, encoding issues — what to fix.", category: "Troubleshooting" },
];
