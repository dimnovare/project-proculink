import { DOCUMENT_STATUSES, type DocumentStatusRow } from "@/lib/documentStatusManifest";

export type DocumentTab = "needs-you" | "in-progress" | "sent" | "failed" | "all";
export interface DocumentTabDef { id: DocumentTab; label: string; /** null = every status. */ statuses: readonly string[] | null }

const where = (test: (s: DocumentStatusRow) => boolean) => Object.keys(DOCUMENT_STATUSES).filter((k) => test(DOCUMENT_STATUSES[k]));

export const NEEDS_YOU_STATUSES: readonly string[] = where((s) => s.needsYou && s.tone !== "error");

/** In the board's order. Statuses are derived from DOCUMENT_STATUSES, never typed. */
export const DOCUMENT_TABS: readonly DocumentTabDef[] = [
  { id: "needs-you", label: "Needs you", statuses: NEEDS_YOU_STATUSES },
  { id: "in-progress", label: "In progress", statuses: where((s) => s.tone === "working") },
  { id: "sent", label: "Sent", statuses: where((s) => s.tone === "success") },
  { id: "failed", label: "Couldn't send or read", statuses: where((s) => s.tone === "error") },
  { id: "all", label: "All", statuses: null },
];

export const DOCUMENTS_PAGE_SIZE = 50;

/** The one value of `name`, or null when it is missing or repeated: the address is typed by people. */
const only = (params: { getAll(name: string): string[] }, name: string) => {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : null;
};

/** What the address asks for. An unknown `show` is null (the screen then chooses); `page` is a whole number of 1 or more,
 *  written plainly and below a billion (the server's page is a 32-bit int), else 1. */
export function readDocumentsAddress(params: { getAll(name: string): string[] }): { tab: DocumentTab | null; page: number } {
  const show = only(params, "show");
  const page = only(params, "page");
  return {
    tab: DOCUMENT_TABS.find((t) => t.id === show)?.id ?? null,
    page: page && /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

/** "/documents?show=sent", and "&page=2" only above the first page. */
export const documentsAddress = (tab: DocumentTab, page = 1) => `/documents?show=${tab}${page > 1 ? `&page=${page}` : ""}`;

/** Monday 00:00 of `now`'s week, in the local time zone. */
export function startOfWeek(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
}

/** The line under the title. null while the needs-you number is unknown (the caller keeps the plain line). */
export function documentsHelper(needsYou: number | undefined, sentThisWeek: number | undefined): string | null {
  if (needsYou === undefined) return null;
  const needs = needsYou === 0 ? "Nothing needs you." : `${needsYou} ${needsYou === 1 ? "needs" : "need"} you.`;
  if (!sentThisWeek) return needs;
  return `${needs} ${sentThisWeek} ${sentThisWeek === 1 ? "was" : "were"} sent this week.`;
}
