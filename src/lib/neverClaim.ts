/**
 * What public copy must never claim, because the document engine does not do it (plan 12b, Global Constraints):
 * standard outputs, ERP destinations, S3 or plain-FTP destinations, cloud-drive destinations, Peppol validation
 * and approval workflows. Whole-word and case-insensitive.
 *
 * Intake over S3 or FTP is real and may be claimed, so those two patterns match destination phrasing only
 * ("send to an S3 bucket"), never "collect from an S3 bucket". `SFTP` and `FTPS` never match `FTP`:
 * the word boundary sits inside them.
 */
export interface NeverClaim {
  label: string;
  pattern: RegExp;
}

const SEND = String.raw`(?:send|sends|sending|sent|deliver\w*|push\w*|upload\w*|write\w*|save\w*)`;

/** Phrasing that makes `store` a destination: "send ... to an S3", "S3 destination", "destination ... S3". */
const asDestination = (store: string) =>
  new RegExp(
    String.raw`\b${SEND}\b[^.\n]{0,60}\b(?:to|into)\s+(?:an?\s+|your\s+|the\s+)?${store}\b|\b${store}\s+destinations?\b|\bdestinations?\b[^.\n]{0,40}\b${store}\b`,
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
