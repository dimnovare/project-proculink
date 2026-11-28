import type { Locale } from "@/i18n/locales";
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

/**
 * The early-access steps of the "Send e-invoices" guide (/help/guides/send-e-invoices), kept here because they name KSeF,
 * Peppol and B2Brouter. EInvoiceSteps renders them inside an early-access block with the heading and the way to ask.
 * Each sentence is what the app does today: DestinationForm, OutputEditor's rule check, DocumentScreen's KSeF dialog and
 * the backend's DocumentSender. `**x**` marks a label the app shows.
 */
export const EINVOICE_STEPS = [
  {
    title: "Make a Peppol or KSeF file",
    body: [
      "Once early access is on, **A standard format** also lists Peppol BIS Billing, the European e-invoice standard, the formats for German public bodies and, with its own switch, the KSeF invoice file (FA(3)). Each one says what it is for, and most come with a credit note.",
      "On a document, a Peppol BIS file also says whether the buyer can receive it on Peppol, found from the Receiver Peppol ID or the buyer's VAT number. That line never stops a send.",
      "The KSeF file can also be downloaded and uploaded by you in the free Aplikacja Podatnika KSeF. You are the issuer: check it before you issue it.",
    ],
  },
  {
    title: "Check the file against the rules",
    body: [
      "Open the file with a document in the flow. Where the rule check is on for your workspace, press **Check against Peppol rules** (the button names the rules of the format you chose). We check the file made from that document.",
      "The answer says it passes, passes with warnings, or doesn't meet a number of rules, and lists them. A broken rule also shows as a check on the document. It never stops a send by itself.",
    ],
  },
  {
    title: "Send through B2Brouter (Peppol and France)",
    body: [
      "Add a destination and, under **E-invoice network (early access)**, choose **B2Brouter**. Fill in your **B2Brouter account ID** and your API key. A key that starts with test_ sends to B2Brouter's test system.",
      "B2Brouter is your e-invoice provider, a Peppol access point that also serves France. The seller on your invoices must be the company of your B2Brouter account.",
      "A test checks that B2Brouter accepts your API key and account, and sends no invoice. A passed test says **Connection check passed**.",
      "Sent here means B2Brouter accepted the invoice and didn't report a problem in the first few seconds. Your B2Brouter account shows the buyer's delivery.",
      "For France, open **Sending invoices in France** on the form: your invoices need your SIREN and your buyer's SIREN, and France accepts UBL, CII and Factur-X files.",
    ],
  },
  {
    title: "Send to KSeF: Test first, then Production",
    body: [
      "Add a destination and choose **KSeF**. Fill in the **NIP** (10 digits) and a KSeF token made in Aplikacja Podatnika KSeF for that NIP, with permission to issue invoices. The token is kept encrypted and never shown again.",
      "A new KSeF destination starts on Test: fictitious data, no legal effect. Demo uses your own token, with fictitious invoices and no legal effect. Production is offered only once the destination is saved, so check an invoice on Test or Demo first.",
      "Switching to Production, or changing a Production destination's NIP, needs the tick that confirms your company is the issuer of every invoice sent from it.",
      "A test only signs in to KSeF with your token. It never sends an invoice.",
    ],
  },
  {
    title: "Issue an invoice in KSeF Production",
    body: [
      "In Production, no invoice is issued until a person has seen exactly the file that goes. Send the document, and **Issue this invoice in KSeF?** shows the seller, the buyer, the invoice number, the dates, the VAT and the total. Check them against your document, then press **Issue in KSeF**.",
      "Your yes is for that exact file. If the invoice changes before you confirm, we ask you to check it again. A document the flow would send by itself waits for you instead.",
      "Once KSeF accepts an invoice it is issued: it can't be withdrawn, only corrected with a correcting invoice. A document already issued in KSeF is never sent to Production again.",
      "A KSeF Production destination takes only the KSeF invoice file, one per document. Tokens expire: when yours does, sends stop with a message and you paste a new one. A printed or PDF copy you give your buyer must carry the KSeF QR code, which ProcuLink doesn't add.",
    ],
  },
] as const;

/** The same block in the other languages. It lives here, not in messages/*.json, because this is the one file allowed to name KSeF, Peppol and B2Brouter. */
const TRANSLATED: Partial<Record<Locale, { heading: string; lead: string; items: [string, string][]; pricingLine: string; cta: string }>> = {
  de: {
    heading: "Vorabzugang",
    lead: "In der Testumgebung des jeweiligen Anbieters gebaut und getestet. Wir schalten es für Ihren Arbeitsbereich frei, wenn Sie danach fragen.",
    items: [
      ["KSeF (Polen)", "ProcuLink erstellt die FA(3)-Rechnungsdatei und sendet sie mit Ihrem eigenen Token an KSeF. Wir probieren es zuerst gemeinsam mit Ihnen in der Testumgebung von KSeF aus."],
      ["Peppol und E-Rechnungen in Frankreich", "ProcuLink sendet Ihre E-Rechnungen über Ihr eigenes B2Brouter-Konto, einen Peppol-Zugangspunkt, der auch Frankreich abdeckt. Den ersten Versand richten wir gemeinsam mit Ihnen ein."],
    ],
    pricingLine: "Vorabzugang: KSeF (Polen) sowie Peppol und Frankreich über B2Brouter.",
    cta: "Vorabzugang anfragen",
  },
  fr: {
    heading: "Accès anticipé",
    lead: "Conçu et testé dans l’environnement de test de chaque fournisseur. Nous l’activons pour votre espace de travail sur simple demande.",
    items: [
      ["KSeF (Pologne)", "ProcuLink crée le fichier de facture FA(3) et l’envoie à KSeF avec votre propre jeton. Nous l’essayons d’abord avec vous dans l’environnement de test de KSeF."],
      ["Peppol et facturation électronique en France", "ProcuLink envoie vos factures électroniques via votre propre compte B2Brouter, un point d’accès Peppol qui couvre aussi la France. Nous configurons le premier envoi avec vous."],
    ],
    pricingLine: "Accès anticipé : KSeF (Pologne), ainsi que Peppol et la France via B2Brouter.",
    cta: "Demander un accès anticipé",
  },
  pl: {
    heading: "Wczesny dostęp",
    lead: "Zbudowane i przetestowane w środowisku testowym każdego dostawcy. Włączamy je w Twoim obszarze roboczym, gdy o to poprosisz.",
    items: [
      ["KSeF (Polska)", "ProcuLink tworzy plik faktury FA(3) i wysyła go do KSeF z Twoim własnym tokenem. Najpierw testujemy to razem z Tobą w środowisku testowym KSeF."],
      ["Peppol i e-faktury we Francji", "ProcuLink wysyła Twoje e-faktury przez Twoje własne konto B2Brouter, punkt dostępowy Peppol, który obsługuje też Francję. Pierwszą wysyłkę konfigurujemy razem z Tobą."],
    ],
    pricingLine: "Wczesny dostęp: KSeF (Polska) oraz Peppol i Francja przez B2Brouter.",
    cta: "Poproś o wczesny dostęp",
  },
  et: {
    heading: "Varajane ligipääs",
    lead: "Ehitatud ja testitud iga teenusepakkuja testkeskkonnas. Lülitame selle teie tööruumis sisse, kui seda palute.",
    items: [
      ["KSeF (Poola)", "ProcuLink koostab FA(3) arvefaili ja saadab selle teie enda tokeniga KSeF-i. Proovime seda kõigepealt koos teiega KSeF-i testkeskkonnas."],
      ["Peppol ja e-arved Prantsusmaal", "ProcuLink saadab teie e-arved teie enda B2Brouteri konto kaudu. See on Peppoli juurdepääsupunkt, mis teenindab ka Prantsusmaad. Esimese saatmise seadistame koos teiega."],
    ],
    pricingLine: "Varajane ligipääs: KSeF (Poola) ning Peppol ja Prantsusmaa B2Brouteri kaudu.",
    cta: "Küsi varajast ligipääsu",
  },
};

/** EARLY_ACCESS in the reader's language; English, the pinned source, for English or a language without it. */
export function earlyAccessIn(locale: string) {
  const t = TRANSLATED[locale as Locale];
  if (!t) return EARLY_ACCESS;
  return {
    ...EARLY_ACCESS,
    heading: t.heading,
    lead: t.lead,
    items: EARLY_ACCESS.items.map((item, i) => ({ ...item, name: t.items[i][0], note: t.items[i][1] })),
    pricingLine: t.pricingLine,
    cta: { ...EARLY_ACCESS.cta, label: t.cta },
  };
}
