import { SALES } from "@/lib/plans";

/**
 * Early access (founder decision 2026-11-26): the one source of every public sentence that names KSeF, Peppol or
 * B2Brouter. /formats, /pricing and /changelog render it; src/test/publicCopyDrift.test.ts pins the wording and allows
 * those three names nowhere else. Each item's key is the destination's registry key (heldBack.ts reads them).
 * Never claim ProcuLink is certified or approved, and promise no reply time.
 */
export const EARLY_ACCESS = {
  heading: "Early access",
  lead: "Built and tested in each provider's test environment. We switch it on for your workspace when you ask.",
  items: [
    {
      key: "ksef",
      name: "KSeF (Poland)",
      note: "ProcuLink makes the FA(3) invoice file and sends it to KSeF with your own token. We try it with you on KSeF's test environment first.",
    },
    {
      key: "b2brouter",
      name: "Peppol and e-invoicing in France",
      note: "ProcuLink sends your e-invoices through your own B2Brouter account, a Peppol access point that also serves France. We set up the first send with you.",
    },
  ],
  pricingLine: "Early access: KSeF (Poland), and Peppol and France through B2Brouter.",
  cta: { label: "Ask for early access", href: `${SALES}?subject=Early%20access` },
} as const;
