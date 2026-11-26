/**
 * What public copy must never claim, because the document engine does not do it (plan 12b, Global Constraints):
 * standard outputs, ERP destinations, plain-FTP destinations, cloud drives other than Google and OneDrive, Peppol validation
 * and approval workflows. Whole-word and case-insensitive.
 *
 * cXML, UBL, EDIFACT and X12 orders had a real send and were taken off on 2026-11-18.
 * S3 and Google Drive/Sheets delivery shipped (plans 9a, 9b) and were taken off this list on 2026-11-14.
 * OneDrive folder delivery shipped (plan 30 Part B) and was taken off this list on 2026-11-25. SharePoint libraries are not
 * confirmed to work with the scope ProcuLink asks for, so SharePoint may appear only in a sentence that says "on request".
 *
 * Intake over FTP is real and may be claimed, so the FTP pattern looks for the store used as a
 * DESTINATION, in three small shapes (see `asDestination`). `SFTP` and `FTPS` never match `FTP`: the word
 * boundary sits inside them.
 *
 * Known limits, on purpose: only the shapes below are caught. Passive phrasing ("S3 receives the file"), a
 * sentence split across lines, or a verb 60 or more characters before the store are not. A sentence that
 * says "in" between the verb and the store ("send documents in by FTP") is treated as intake and skipped.
 * Tests in `src/lib/helpContent.test.ts` pin the exact strings each side must and must not match.
 */
export interface NeverClaim {
  label: string;
  pattern: RegExp;
}

const VERB = String.raw`(?:send\w*|sent|deliver\w*|go(?:es)?|going|post\w*)`;
// Up to `max` characters in the same sentence, never crossing the word "in" (intake: "send documents in by FTP").
const GAP = (max: number) => String.raw`(?:(?!\bin\b)[^.\n]){0,${max}}`;

/** "send ... to/via/over STORE", "STORE destination(s) / delivery", "destination(s) ... STORE". */
const asDestination = (store: string) =>
  new RegExp(
    [
      String.raw`\b${VERB}\b${GAP(60)}\b(?:to|into|via|over)\b${GAP(40)}\b${store}\b`,
      String.raw`\b${store}\s+(?:destinations?|deliver\w*)\b`,
      String.raw`\bdestinations?\b[^.\n]{0,40}\b${store}\b`,
    ].join("|"),
    "i",
  );

export const NEVER_CLAIM: readonly NeverClaim[] = [
  { label: "Peppol (output or validation)", pattern: /\bpeppol\b/i },
  { label: "XRechnung or EN 16931", pattern: /\bxrechnung\b|\ben\s?16931\b/i },
  // The Factur-X invoice is released; its credit note is not (behind the e-invoice switch).
  { label: "Factur-X credit note", pattern: /\bfactur-x\b[^.\n]{0,40}\bcredit notes?\b/i },
  { label: "IDoc", pattern: /\bidoc\b/i },
  { label: "Erply", pattern: /\berply\b/i },
  { label: "Directo", pattern: /\bdirecto\b/i },
  { label: "KSeF (plan 33, decision 7)", pattern: /\bksef\b/i },
  // KSeF, Peppol and B2Brouter appear in public copy only in src/lib/marketing/earlyAccess.ts (founder decision 2026-11-26).
  { label: "B2Brouter (early access only)", pattern: /\bb2brouter\b/i },
  // ProcuLink holds no certification or approval from a tax authority or network. "a French approved platform" is about
  // someone else and does not match; "ProcuLink is approved by …" and "certified for KSeF" do.
  {
    label: "certified or approved (ProcuLink)",
    pattern: /\b(?:proculink|we)\b(?:\s+(?:is|are))?[^.\n]{0,30}\b(?:certified|accredited|approved|authori[sz]ed)\b|\bcertified\s+(?:by|for)\b/i,
  },
  { label: "plain-FTP destination", pattern: asDestination("ftp") },
  { label: "SharePoint (except on request)", pattern: /\bsharepoint\b(?![^.\n]*\bon request\b)/i },
  { label: "Dropbox", pattern: /\bdropbox\b/i },
  { label: "approval workflows", pattern: /\bapproval (?:workflow|flow|chain)s?\b/i },
  // The seven document checks (`DocumentChecks.cs`) include no sum check. A field named "Total" is fine.
  {
    label: "totals check",
    pattern: /\btotals?\s+(?:that\s+)?(?:doesn['’]?t|don['’]?t|does not|do not)\s+add\s+up\b|\btotals?\s+checks?\b|\bchecks?\s+(?:the\s+)?(?:totals?|sums?)\b/i,
  },
];
