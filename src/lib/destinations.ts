/**
 * destinations.ts — the words a destination is shown with, and the Settings › Destinations address.
 *
 * "Where" is built only from the config keys named below. A destination's config is free-form, so
 * a secret typed under any other key must never be read back. A URL keeps only its host: a webhook
 * address often carries its secret in the path. A kind this build does not know prints its protocol word.
 */
import type { Destination, DestinationLastSend, DestinationUse } from "./api/documents";
import { DATE_LOCALE } from "./format-date";

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const parts = (...p: (string | null)[]) => p.filter(Boolean).join(", ");
const folder = (v: unknown) => (text(v) ? `folder ${text(v)}` : null);

function webAddress(v: unknown): string | null {
  try {
    const u = new URL(text(v) ?? "");
    return u.host || null;
  } catch {
    return null;
  }
}

const WHERE: Record<string, (c: Record<string, unknown>) => string> = {
  sftp: (c) => parts("SFTP", text(c.host), folder(c.remotePath)),
  ftps: (c) => parts("FTPS", text(c.host), folder(c.remotePath)),
  email: (c) => (text(c.toAddresses) ? `Email to ${text(c.toAddresses)}` : "Email"),
  http: (c) => parts("Web address", webAddress(c.url)),
  s3: (c) => parts("S3 bucket", text(c.bucket), folder(c.prefix)),
  google_drive: (c) => parts("Google Drive", folder(c.folderName)),
  google_sheets: (c) => parts("Google Sheets", text(c.spreadsheetName), text(c.sheetName) ? `tab ${text(c.sheetName)}` : null),
};

export function destinationWhere(d: Pick<Destination, "protocol" | "config">): string {
  return WHERE[d.protocol]?.(d.config ?? {}) ?? d.protocol;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "at 14:05" (today), "yesterday", "on 12 May", "on 12 November 2025"; null for an unreadable instant. In the viewer's zone. */
export function sendMoment(iso: string, now: Date): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (dayKey(at) === dayKey(now)) return `at ${at.toLocaleTimeString(DATE_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday)) return "yesterday";
  const year = at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const };
  return `on ${at.toLocaleDateString(DATE_LOCALE, { day: "numeric", month: "long", ...year })}`;
}

const LAST_SEND: Record<string, [ok: string, failed: string]> = {
  document: ["Sent", "Couldn't send"],
  test: ["Test arrived", "Test failed"],
};

/** An unknown `kind` reads "Last used", muted: unknown is never a success. */
export function lastSendWords(last: DestinationLastSend | null, now: Date): { text: string; tone: "ok" | "failed" | "never" } {
  if (!last) return { text: "Never sent", tone: "never" };
  const words = LAST_SEND[last.kind];
  const lead = words ? words[last.ok ? 0 : 1] : "Last used";
  const text = [lead, sendMoment(last.at, now)].filter(Boolean).join(" ");
  return { text, tone: words ? (last.ok ? "ok" : "failed") : "never" };
}

/** "Not used", or each file that sends here: "Supplier invoices (Invoice CSV), Delivery notes (Notes PDF)". */
export const usedByWords = (uses: DestinationUse[]) =>
  uses.length ? uses.map((u) => `${u.flowName} (${u.outputName})`).join(", ") : "Not used";

/** "/settings?tab=destinations", and "&open=<id>" when one is open ("new" for the new-destination form). */
export const destinationsAddress = (open?: string) =>
  `/settings?tab=destinations${open ? `&open=${encodeURIComponent(open)}` : ""}`;

const OPEN = /^[A-Za-z0-9-]{1,64}$/;

/** Reads `open` only when exactly one value of 1 to 64 letters, digits or hyphens is present. */
export function readDestinationsAddress(params: { get(name: string): string | null; getAll(name: string): string[] }): { open: string | null } {
  if (params.getAll("open").length !== 1) return { open: null };
  const open = params.get("open");
  return { open: open !== null && OPEN.test(open) ? open : null };
}
