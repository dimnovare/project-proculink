/**
 * What public copy must never claim, because the document engine does not do it (plan 12b, Global Constraints):
 * standard outputs, ERP destinations, S3 or plain-FTP destinations, cloud-drive destinations, Peppol validation
 * and approval workflows. Whole-word and case-insensitive.
 *
 * Intake over S3 or FTP is real and may be claimed, so the S3 and FTP patterns look for the store used as a
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
  { label: "cXML", pattern: /\bcxml\b/i },
  { label: "UBL", pattern: /\bubl\b/i },
  { label: "Peppol (output or validation)", pattern: /\bpeppol\b/i },
  { label: "X12", pattern: /\bx12\b/i },
  { label: "EDIFACT", pattern: /\bedifact\b/i },
  { label: "IDoc", pattern: /\bidoc\b/i },
  { label: "Erply", pattern: /\berply\b/i },
  { label: "Directo", pattern: /\bdirecto\b/i },
  { label: "S3 destination", pattern: asDestination("s3") },
  { label: "plain-FTP destination", pattern: asDestination("ftp") },
  { label: "Google Drive", pattern: /\bgoogle drive\b/i },
  { label: "OneDrive", pattern: /\bonedrive\b/i },
  { label: "Dropbox", pattern: /\bdropbox\b/i },
  { label: "approval workflows", pattern: /\bapproval (?:workflow|flow|chain)s?\b/i },
];
