import { EARLY_ACCESS_KEYS, HELD_BACK } from "@/lib/marketing/heldBack";
// The id, not the words: a standard's id carries a name the public-copy guards ban for the outputs still held back.
import { FACTUR_X } from "@/lib/standardOutputs";

// The rows /formats lists. Each row names the registry keys it stands for, and
// formatsRows.test.ts fails when a registry holds a key that is neither a row nor held back
// below, or when a row names a key the registry does not hold:
//   read      file extensions in FILE_KINDS (src/lib/fileKinds.ts)
//   outputs   keys of FORMATS (src/components/flows/OutputEditor.tsx) and STANDARD_OUTPUTS (src/lib/standardOutputs.ts)
//   ways in   "upload" plus the keys of WAY_IN_WORDS (src/lib/flowSentences.ts)
//   ways out  keys of CHANNELS (src/lib/channels.ts; "" is Download)
// Kept under components/marketing so the public-copy guards read these words.

export interface FormatRow { name: string; note: string; keys: readonly string[] }

export const READ_ROWS: readonly FormatRow[] = [
  { name: "PDF (with a text layer)", note: "The usual PDF: one made by a system or saved from an email, where you can select the text.", keys: ["pdf"] },
  { name: "Scans and phone photos", note: "A scanned page or a photo of one, as a PDF, PNG or JPG.", keys: ["png", "jpg", "jpeg"] },
  { name: "CSV", note: "A table saved as plain text, the way most systems export it.", keys: ["csv"] },
  { name: "Excel", note: "An .xlsx workbook.", keys: ["xlsx"] },
  { name: "Word", note: "A .docx document.", keys: ["docx"] },
  { name: "Text", note: "A plain .txt file.", keys: ["txt"] },
  { name: "XML", note: "A structured .xml file exported by another system.", keys: ["xml"] },
  { name: "JSON", note: "A structured .json file exported by another system.", keys: ["json"] },
  // A PDF too (its key is on the PDF row): the invoice data built into it is used when the page shows the same values.
  { name: "ZUGFeRD and Factur-X invoices", note: "A PDF invoice with its data built in. We use that data when the page shows the same values.", keys: [] },
];

export const OUTPUT_ROWS: readonly FormatRow[] = [
  { name: "CSV", note: "Your columns and your names, separated by a comma, a semicolon or a tab.", keys: ["csv"] },
  { name: "Excel", note: "An .xlsx file with your columns and your names.", keys: ["xlsx"] },
  { name: "JSON", note: "For systems that take structured data, with the names your system expects.", keys: ["json"] },
  { name: "XML", note: "Structured data as XML, with the names your system expects.", keys: ["xml"] },
  { name: "PDF", note: "A clean page with your title, your own text at the top and bottom, and your logo.", keys: ["pdf"] },
  { name: "Text", note: "A plain text file with a title and the values.", keys: ["txt"] },
  { name: "Fixed-width", note: "Every value at a set width, for systems that read by position.", keys: ["fixed"] },
  { name: "cXML", note: "A purchase order as cXML 1.2, for suppliers and procurement networks that take it.", keys: ["cxml-1-2"] },
  { name: "UBL Order", note: "A purchase order as UBL 2.1, the XML order many European systems take.", keys: ["ubl-2-1-order"] },
  { name: "EDIFACT ORDERS", note: "A purchase order as an EDIFACT ORDERS message (D.96A).", keys: ["edifact-orders"] },
  { name: "ANSI X12 850", note: "A purchase order as an X12 850 (version 4010), for EDI partners in North America.", keys: ["x12-850"] },
  { name: "ZUGFeRD / Factur-X invoice", note: "A PDF invoice people can read, with the invoice data built in for the buyer's system.", keys: [FACTUR_X] },
];

export const WAYS_IN_ROWS: readonly FormatRow[] = [
  { name: "Upload", note: "Drag a file into ProcuLink, or choose one.", keys: ["upload"] },
  { name: "A flow's own email address", note: "Forward or send documents to it. Each attached file we can read becomes a document.", keys: ["email"] },
  { name: "A mailbox", note: "We collect new mail from a mailbox you already use.", keys: ["imap"] },
  { name: "SFTP, FTP or FTPS", note: "We collect new files from a folder on your server.", keys: ["sftp", "ftp", "ftps"] },
  { name: "An S3 bucket", note: "We collect new files from a bucket, or from S3-compatible storage.", keys: ["s3"] },
  { name: "Our API", note: "Your own system posts a file to a flow and fetches the result.", keys: ["api"] },
];

export const WAYS_OUT_ROWS: readonly FormatRow[] = [
  { name: "Email", note: "The file as an attachment, to one address or several.", keys: ["email"] },
  { name: "A web address", note: "We post the file to an address your system gives you.", keys: ["http"] },
  { name: "SFTP or FTPS", note: "Into a folder on your server.", keys: ["sftp", "ftps"] },
  { name: "An S3 bucket", note: "Into a bucket, or S3-compatible storage.", keys: ["s3"] },
  { name: "Google Drive", note: "Into a folder you choose.", keys: ["google_drive"] },
  { name: "Google Sheets", note: "As new rows at the end of a sheet you choose.", keys: ["google_sheets"] },
  { name: "OneDrive", note: "Into a folder you choose.", keys: ["microsoft_onedrive"] },
  { name: "Download", note: "Download the file and send it on yourself.", keys: [""] },
];

/** What a registry holds that the page does not list, and why (kept out of this folder: its keys name standards). */
export { EARLY_ACCESS_KEYS, HELD_BACK };

/** Registry keys neither listed, held back nor in early access, and listed keys the registry lacks. Empty both ways means in step. */
export function outOfStep(registry: readonly string[], rows: readonly FormatRow[]): { unlisted: string[]; unknown: string[] } {
  const listed = rows.flatMap((r) => r.keys);
  return {
    unlisted: registry.filter((k) => !listed.includes(k) && !Object.hasOwn(HELD_BACK, k) && !EARLY_ACCESS_KEYS.has(k)),
    unknown: listed.filter((k) => !registry.includes(k)),
  };
}
