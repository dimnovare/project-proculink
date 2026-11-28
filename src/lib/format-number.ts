// Fixed-locale NUMBER formatting — the missing half of `format-date.ts`.
//
// That file already says the whole argument, for dates:
//
//   "Passing `undefined` as the locale (the old per-component helpers did)
//    resolves to the host's runtime locale, which differs between the server
//    process and the user's browser — the classic source of hydration drift on
//    dates. Do NOT swap this back to the ambient locale."
//
// Every word of that is equally true of numbers, and it was never applied to
// them: 40 call sites across the app called `n.toLocaleString()` with no locale.
// Grouping separators differ by locale — `1,284` (en-GB/en-IE/en-US) vs `1.284`
// (de-DE) vs `1 284` (fr-FR) — so a number rendered on the server and hydrated in
// a browser with a different locale produces two different strings and React
// throws the SSR tree away.
//
// This is not theoretical. The three-viewport control sweep caught it in the act
// on 2026-08-26, twice, in the same run:
//
//   /library/suppliers/s1 — server "1284", client "1,284"
//   /library/buyers       — server "1820", client "1,820"
//
// Both are hydration failures, both were invisible to every existing test,
// and both are one call each.
//
// Grouping only diverges at 1000 and above, which is why nobody hit it sooner and
// why it will keep being missed by eye: every count under a thousand renders
// identically in every locale. The first PRICE that would show it is Distributor
// at €1,499.
//
// LOCALE CHOICE. "en-GB", the same constant `format-date.ts` picked, so the
// product speaks one locale rather than two. Its grouping is identical to the
// "en-IE" already used explicitly on /pricing and /one-pager, so those pages are
// unaffected and stay consistent with these.
//
// Do NOT swap this back to the ambient locale.

/**
 * Exported so call sites can pass it inline — `n.toLocaleString(NUMBER_LOCALE)` —
 * rather than rewriting every receiver expression into a helper call. A one-token
 * change per site keeps the diff reviewable, and the guard in
 * src/test/ambientLocale.test.ts fails the build if a bare call comes back.
 */
export const NUMBER_LOCALE = "en-GB";

/**
 * A whole number with locale-stable grouping: `1284` → `"1,284"`.
 *
 * Use this instead of `n.toLocaleString()` anywhere the value can reach the
 * server render — which, in an App Router app, is very nearly everywhere.
 */
export function formatCount(n: number): string {
  return n.toLocaleString(NUMBER_LOCALE);
}

/**
 * A number with an explicit fraction range, for the few places that need
 * decimals. Options are spread over the fixed locale rather than replacing it,
 * so a caller cannot accidentally reintroduce the ambient-locale bug by passing
 * only options.
 */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(NUMBER_LOCALE, options);
}

// An optional currency symbol or upper-case ISO code on either side of the digits, as the backend's NumberShape.
const SHAPE = /^(?:[A-Z]{3}|[€$£])?(-?[\d.,]+)(?:[A-Z]{3}|[€$£])?$/;

/**
 * The backend's `FieldValueParser.Number`, rule for rule: the one reading of a number, or null when the text has
 * none or has two. A space or an apostrophe only groups thousands. The right-most separator is the decimal one; a
 * separator that repeats can only be a thousands mark; a lone separator followed by exactly three digits ("1,500",
 * "1.500") is either, so it is not read.
 */
export function numberOf(text: string | null | undefined): number | null {
  return numberParts(text)?.n ?? null;
}

function numberParts(text: string | null | undefined): { n: number; decimals: number } | null {
  const body = SHAPE.exec((text ?? "").replace(/[\s'’]/g, ""))?.[1];
  if (!body || !/\d/.test(body) || /^-?\d{1,3}[.,]\d{3}$/.test(body)) return null;
  let at = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
  if (at >= 0 && body.split(body[at]).length > 2) at = -1;
  const plain = (s: string) => s.replace(/[.,]/g, "");
  const n = Number(at < 0 ? plain(body) : `${plain(body.slice(0, at))}.${body.slice(at + 1)}`);
  return Number.isFinite(n) ? { n, decimals: at < 0 ? 0 : body.length - at - 1 } : null;
}

/** The Intl locale for an app language: English is written the British way, as everywhere else in the product. */
const intlLocale = (locale: string) => (locale === "en" ? "en-GB" : locale);

/** Numbered dates that can be read only one way (the backend's `IsoDate`): a dotted date is day first; 03/04/2026 is refused. */
function dateOf(text: string): Date | null {
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(text);
  const y = iso ? +iso[1] : dmy ? +dmy[4] : 0;
  let [m, d] = iso ? [+iso[2], +iso[3]] : dmy ? [+dmy[3], +dmy[1]] : [0, 0];
  if (dmy && dmy[2] === "/" && m > 12 && d <= 12) [m, d] = [d, m];      // 11/21/2026 can only be month first
  else if (dmy && dmy[2] !== "." && d <= 12 && m <= 12 && d !== m) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * A read value as the reader's language writes it, for SHOWING only: what is saved and sent stays as read.
 * Money and numbers keep their printed decimals and any currency around them ("€ 1303,40" → "€ 1,303.40" in English);
 * dates that can be read one way only are written the reader's way. Anything else, or anything with two readings
 * ("1.500", "03/04/2026"), comes back as it was.
 */
export function formatReadValue(raw: string | null, type: string, meaning: string | null, locale: string): string | null {
  const text = raw?.trim() ?? "";
  if (!text) return raw;
  if (type === "date") {
    const d = dateOf(text);
    return d ? new Intl.DateTimeFormat(intlLocale(locale), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d) : raw;
  }
  if ((type !== "money" && type !== "number") || meaning === "line_number" || meaning === "document_number") return raw;
  const m = /^((?:[A-Z]{3}|[€$£])?\s*)(.*?)(\s*(?:[A-Z]{3}|[€$£])?)$/.exec(text)!;
  const p = /^-?0\d/.test(m[2]) ? null : numberParts(m[2]);
  if (!p) return raw;
  const digits = Math.min(p.decimals, 20);
  return m[1] + new Intl.NumberFormat(intlLocale(locale), { useGrouping: "always", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(p.n) + m[3];
}
